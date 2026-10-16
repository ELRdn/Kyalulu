"""Integer-only sandbox: no wallet changes, payout, sales or policy defaults."""


def simulate(*, gross_nano, inference_nano, processing_nano, creator_share_bps):
    values = (gross_nano,inference_nano,processing_nano,creator_share_bps)
    if any(type(v) is not int or v<0 for v in values) or creator_share_bps>10_000:
        raise ValueError("nonnegative integer costs and 0..10000 share required")
    margin = gross_nano-inference_nano-processing_nano
    profit = max(0,margin)
    creator = profit*creator_share_bps//10_000
    return {"mode":"simulation_only","gross_nano":gross_nano,"inference_nano":inference_nano,
        "processing_nano":processing_nano,"profit_nano":profit,"loss_nano":max(0,-margin),
        "creator_nano":creator,"operator_profit_nano":profit-creator,
        "creator_share_bps":creator_share_bps,"basis":"profit_after_declared_costs",
        "limitations":"Taxes, safety, storage, refunds and moderation must be included explicitly in costs; no commercial policy is selected."}
