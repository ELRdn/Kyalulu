"""Read private configuration and report readiness without sending requests."""

import argparse
from decimal import Decimal, ROUND_CEILING
import hashlib
import json
import os
from pathlib import Path
import sys
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))


def inspect(file, prior_summary):
    from python.cloud.config import CloudConfig

    if not file.is_file():
        return {"ready": False, "error": "private configuration file is missing", "network_requests": 0}
    values = dotenv_values(file, interpolate=False)
    required = ("KYALULU_CLOUD_ORIGIN", "KYALULU_CLOUD_SECRET", "KYALULU_CLOUD_DATA_DIR",
                "KYALULU_SUPABASE_URL", "KYALULU_SUPABASE_ANON_KEY")
    missing = [name for name in required if not values.get(name)]
    if missing:
        return {"ready": False, "missing": missing, "network_requests": 0}
    # This CLI has its own process. Do not echo values or place keys in arguments.
    for key, value in values.items():
        if key.startswith("KYALULU_") and value is not None:
            os.environ[key] = value
    try:
        config = CloudConfig.from_env()
        errors = []
        if config.private_test:
            if any("replace-with" in email for email in config.allowed_emails):
                errors.append("replace the invited-email placeholder")
            if not prior_summary.is_file():
                errors.append("prior verified benchmark summary is missing")
            else:
                summary = json.loads(prior_summary.read_text(encoding="utf-8"))
                evidence = prior_summary.with_name("evidence.json")
                if not evidence.is_file() or hashlib.sha256(evidence.read_bytes()).hexdigest() != summary["evidence_sha256"]:
                    errors.append("prior benchmark evidence does not match its verified summary")
                amount = int((Decimal(summary["cumulative_accounted_usd"]) * 1_000_000_000)
                             .to_integral_value(rounding=ROUND_CEILING))
                if config.test_prior_cost_nano < amount:
                    errors.append("prior benchmark costs and reservations must be carried forward")
        return {"ready": not errors and (config.legal_approved or config.private_test),
                "private_test": config.private_test, "allowed_email_count": len(config.allowed_emails),
                "callback": config.origin + "/auth/callback", "billing_enabled": config.billing_enabled,
                "inference_enabled": config.inference_enabled, "errors": errors,
                "live_google_login_verified": False, "network_requests": 0}
    except (ValueError, KeyError):
        return {"ready": False, "error": "configuration is invalid; check the Web auth setup guide",
                "network_requests": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.cloud.local")
    parser.add_argument("--prior-summary", type=Path,
                        default=ROOT / ".artifacts/openrouter-quality-2026-10-04/summary-verified.json")
    args = parser.parse_args()
    report = inspect(args.env_file, args.prior_summary)
    print(json.dumps(report, ensure_ascii=False))
    raise SystemExit(0 if report["ready"] else 1)


if __name__ == "__main__":
    main()
