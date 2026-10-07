"""Conservative per-call accounting. Missing usage consumes its reserved bound."""

import asyncio
import json
import httpx
from .contracts import TARIFF
from .store import CloudError

MAX_OUTPUT = 1024
MAX_PROMPT_BYTES = 56_000


def call_bound(messages, output=MAX_OUTPUT, tariff=TARIFF):
    size = len(json.dumps(messages, ensure_ascii=False).encode()) + 512
    if size > MAX_PROMPT_BYTES:
        raise CloudError("cloud_context_too_large", 413)
    # UTF-8 bytes dominate tokenizer count; extra message framing has its own margin.
    return size * tariff.input_miss + output * tariff.output


class CostMeter:
    def __init__(self, maximum):
        self.maximum, self.total, self.pending = maximum, 0, None
        self.uncertain = False

    def begin(self, bound, tariff=TARIFF):
        self.close_pending()
        if self.uncertain:
            raise CloudError("provider_usage_unavailable", 503)
        if self.total + bound > self.maximum:
            raise CloudError("reservation_bound_exceeded", 503)
        self.pending = bound
        self.pending_tariff = tariff

    def finish(self, usage, *, minimum_cost=0):
        if self.pending is None:
            raise CloudError("unexpected_provider_usage", 503)
        try:
            actual = self.pending_tariff.cost(usage)
        except ValueError:
            self.uncertain = True
            try:
                actual = self.pending_tariff.known_cost(usage)
            except (AttributeError, ValueError):
                # Unknown final cost retains the reservation and any earlier known bill.
                actual = self.pending
        if actual < minimum_cost:
            self.uncertain = True
            actual = minimum_cost
        if actual > self.pending:
            # Stop subsequent calls, but retain the known bill even above the
            # estimate. Settlement must record excess as an operator liability.
            self.uncertain = True
            self.total += actual
            self.pending = None
            raise CloudError("provider_usage_exceeded_bound", 503)
        self.total += actual
        self.pending = None

    def close_pending(self):
        if self.pending is not None:
            self.total += self.pending
            self.pending = None
            self.uncertain = True


class MeteredProvider:
    def __init__(self, provider, meter, billable=True, tariff=TARIFF):
        self.provider, self.meter, self.billable = provider, meter, billable
        self.tariff = tariff

    def generation_config(self, requested):
        return self.provider.generation_config({**requested, "max_tokens": MAX_OUTPUT})

    async def stream_events(self, prompt="", **kwargs):
        if self.billable:
            self.meter.begin(call_bound(kwargs["messages"], tariff=self.tariff), self.tariff)
        try:
            async for event in self.provider.stream_events(prompt, **kwargs):
                if self.billable and event["type"] == "usage":
                    self.meter.finish(event["usage"], minimum_cost=event.get("minimum_cost", 0))
                yield event
        except (RuntimeError, httpx.HTTPError, asyncio.CancelledError) as exc:
            usage = getattr(exc, "openrouter_usage", None)
            if self.billable and self.meter.pending is not None and usage is not None:
                try:
                    self.meter.finish(usage,
                        minimum_cost=getattr(exc, "openrouter_minimum_cost", 0))
                except CloudError:
                    if not isinstance(exc, asyncio.CancelledError):
                        raise
                    # finish retained an overrun; keep cancellation as the terminal status.
            raise
        finally:
            if self.billable:
                self.meter.close_pending()
