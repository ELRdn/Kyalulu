"""Initial OpenRouter routing; no cross-provider failure fallback.

Published Go token rates measure subscription allowance consumption, not cash
API cost. Permission and accepted cost attribution are required before hosting.
"""

from dataclasses import replace
from decimal import Decimal
from python.providers.deepseek import DeepSeekProvider
from python.providers.opencode_go import OpenCodeGoProvider, DEEPSEEK, MIMO, MUSE
from python.providers import openrouter as or_provider
from .contracts import ROUTES, Tariff
from .store import CloudError

GO_TARIFFS = {
    DEEPSEEK: Tariff(version="go-deepseek-v4.1-flash-peak-2026-10-03"),
    MIMO: Tariff(version="go-mimo-v2.6-flash-2026-10-03", input_miss=140,
                 input_hit=Decimal("2.8"), output=280),
    MUSE: Tariff(version="go-muse-spark-1.3-contributor-2026-10-03",
                 input_miss=100, input_hit=2, output=200),
}


class OpenRouterTariff(Tariff):
    # Output/counter validation can fail while the cash bill remains verifiable.
    known_cost = staticmethod(or_provider.billed_nano)

    def cost(self, usage):
        # Validate token counters too; the charge is the actual OpenRouter cost.
        super().cost(usage)
        return or_provider.billed_nano(usage)


OPENROUTER_TARIFFS = {
    or_provider.DEEPSEEK: OpenRouterTariff(version="or-inferencenet-ds-v4.1-flash-2026-10-04",
        input_miss=20, input_hit=20, output=450),
}


def safety_tariff(config):
    if config.operator_backend == "opencode-go":
        return GO_TARIFFS[DEEPSEEK]
    if config.operator_backend == "openrouter":
        return OPENROUTER_TARIFFS[or_provider.DEEPSEEK]
    return Tariff()


def backend_block(config):
    if config.operator_backend == "opencode-go":
        if not config.go_hosting_permission_reference.strip():
            return "opencode_go_hosting_permission_required"
        if not config.go_accounting_approved:
            return "opencode_go_cost_attribution_not_accepted"
    if config.operator_backend == "openrouter" and not config.openrouter_approved:
        return "openrouter_not_accepted"
    if not config.inference_enabled:
        return "inference_awaiting_acceptance"
    key = {"opencode-go": config.opencode_go_key, "openrouter": config.openrouter_key,
           "deepseek": config.deepseek_key}[config.operator_backend]
    if not key:
        return "provider_key_not_configured"
    return None


def select_model(profile="auto", *, context_bytes=0, training_consent=False,
                 region_approved=False):
    if profile == "contributor":
        if not training_consent:
            raise CloudError("muse_training_consent_required", 403)
        if not region_approved:
            raise CloudError("muse_geographic_use_not_accepted", 503)
        return MUSE
    if profile not in {"auto", "structured"}:
        raise CloudError("invalid_cloud_route_profile")
    return DEEPSEEK if profile == "structured" or context_bytes >= 16_000 else MIMO


def operator_provider(config, *, session, model=DEEPSEEK, transport=None,
                      training_consent=False):
    error = backend_block(config)
    if error:
        raise CloudError(error, 503)
    if config.operator_backend == "deepseek":
        return DeepSeekProvider(api_key=config.deepseek_key, transport=transport)
    if config.operator_backend == "openrouter":
        # The shared default is the safety model; never accidentally send a Go ID.
        if model == DEEPSEEK:
            model = or_provider.DEEPSEEK
        return or_provider.OpenRouterProvider(api_key=config.openrouter_key,
                                             model=model, transport=transport)
    return OpenCodeGoProvider(api_key=config.opencode_go_key, model=model, session=session,
                              contributor_consent=training_consent, transport=transport)


def require_current_consent(store, owner):
    from .auth import provider_consent_version

    if store.account(owner)["consent_version"] != provider_consent_version(store.config):
        # Keep read/export access; only new external-provider sends need renewed consent.
        raise CloudError("provider_consent_renewal_required", 403)


def public_route(config, model=None):
    route = ROUTES["cloud-standard"]
    if config.operator_backend == "deepseek":
        return {**route.public(), "available": backend_block(config) is None,
                "unavailable_reason": backend_block(config)}
    if config.operator_backend == "openrouter":
        result = replace(route, provider="openrouter", model=model or or_provider.DEEPSEEK).public()
        result.update(available=backend_block(config) is None,
            unavailable_reason=backend_block(config), transport="OpenRouter",
            upstream=or_provider.UPSTREAM, upstream_tag=or_provider.UPSTREAM_TAG,
            cost_basis="reported_billed_cost", acceptance="pending",
            routing={"conversation": or_provider.DEEPSEEK, "structured_or_large_context": or_provider.DEEPSEEK,
                     "safety": or_provider.DEEPSEEK}, contributor_available=False)
        return result
    result = replace(route, provider="opencode-go", model=model or "auto").public()
    result["capabilities"].update(thinking_disabled=model != MUSE, supports_cache_usage=True)
    result.update(
        available=backend_block(config) is None, unavailable_reason=backend_block(config),
        transport="OpenCode Go", cost_basis="subscription_allowance_reference",
        routing={"conversation": MIMO, "structured_or_large_context": DEEPSEEK,
                 "safety": DEEPSEEK, "creative_with_training_consent": MUSE},
        models=[{"id": candidate, "vision": True, "training": candidate == MUSE,
                 "endpoint": "responses" if candidate == MUSE else "chat/completions",
                 "acceptance": "pending"} for candidate in GO_TARIFFS],
        contributor_opt_in_required=True,
        contributor_available=backend_block(config) is None and config.go_muse_region_approved,
    )
    return result
