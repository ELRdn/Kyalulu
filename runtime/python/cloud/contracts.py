"""Hosted plans and execution routes are independent of Character Intelligence."""

from dataclasses import asdict, dataclass
from decimal import Decimal, ROUND_CEILING
from typing import Literal


@dataclass(frozen=True)
class PlanEntitlements:
    id: str
    monthly_usd: int
    monthly_credits: int
    storage_bytes: int
    restore_days: int
    queue_weight: int


PLANS = {
    "free": PlanEntitlements("free", 0, 0, 25_000_000, 0, 1),
    "plus": PlanEntitlements("plus", 5, 12_500, 250_000_000, 7, 1),
    "pro": PlanEntitlements("pro", 10, 25_000, 1_000_000_000, 30, 2),
}
PACKS = {"credits_5": (5, 50_000), "credits_10": (10, 100_000)}


@dataclass(frozen=True)
class ProviderCapabilities:
    structured_format: str = "json_object"
    thinking_disabled: bool = True
    reports_usage: bool = True
    supports_cache_usage: bool = True
    supports_vision: bool = True


@dataclass(frozen=True)
class ExecutionRoute:
    id: str
    display_name: str
    payer: Literal["operator", "byok"]
    provider: str = "deepseek"
    model: str = "deepseek-flash"
    safety: str = "sfw"
    version: str = "2026-10-03"

    def public(self):
        return {**asdict(self), "capabilities": asdict(ProviderCapabilities())}


ROUTES = {
    "cloud-standard": ExecutionRoute("cloud-standard", "Kyalulu Cloud Standard", "operator"),
    "byok-deepseek": ExecutionRoute("byok-deepseek", "DeepSeek · BYOK", "byok"),
}


@dataclass(frozen=True)
class Tariff:
    version: str = "deepseek-flash-2026-10-03"
    # Integer nanodollars/token, peak rates. No cache savings assumed for admission.
    input_miss: int = 300
    input_hit: int | Decimal = 6
    output: int = 1200
    markup: int = 6

    def credits(self, cost_nano: int, success: bool = True) -> int:
        if not success:
            return 0
        return max(
            1,
            int(
                (Decimal(cost_nano) * self.markup / 100_000).to_integral_value(
                    rounding=ROUND_CEILING
                )
            ),
        )

    def cost(self, usage: dict) -> int:
        def count(key):
            value = usage.get(key)
            if type(value) is not int or value < 0:
                raise ValueError("provider_usage_missing")
            return value

        total = count("prompt_tokens")
        completion = count("completion_tokens")
        hit = usage.get("prompt_cache_hit_tokens", 0)
        if type(hit) is not int or not 0 <= hit <= total:
            raise ValueError("provider_usage_invalid")
        miss = usage.get("prompt_cache_miss_tokens", total - hit)
        if type(miss) is not int or miss < 0 or miss + hit != total:
            raise ValueError("provider_usage_invalid")
        return int((Decimal(hit) * self.input_hit + (total - hit) * self.input_miss
                    + completion * self.output).to_integral_value(rounding=ROUND_CEILING))


TARIFF = Tariff()
