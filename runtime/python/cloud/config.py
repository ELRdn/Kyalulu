"""Opt-in configuration; commercial features are disabled until their gates pass."""

from dataclasses import dataclass
import os
from pathlib import Path
from urllib.parse import urlsplit


@dataclass(frozen=True)
class CloudConfig:
    root: Path
    origin: str
    secret: str
    supabase_url: str = ""
    supabase_key: str = ""
    deepseek_key: str = ""
    operator_backend: str = "openrouter"
    opencode_go_key: str = ""
    go_hosting_permission_reference: str = ""
    go_accounting_approved: bool = False
    go_muse_region_approved: bool = False
    openrouter_key: str = ""
    openrouter_approved: bool = False
    signup_limit: int = 10
    stripe_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_prices: tuple = ()
    billing_enabled: bool = False
    legal_approved: bool = False
    inference_enabled: bool = False
    image_storage_enabled: bool = False
    ads_enabled: bool = False
    ad_webhook_secret: str = ""
    monthly_subsidy_jpy: int = 3000
    usd_jpy: int = 200
    web_dist: Path | None = None
    backup_root: Path | None = None
    private_test: bool = False
    allowed_emails: tuple[str, ...] = ()
    trial_credits: int = 1000
    test_budget_nano: int = 0
    test_prior_cost_nano: int = 0

    def __post_init__(self):
        origin = urlsplit(self.origin)
        if (
            origin.scheme != "https"
            or not origin.hostname
            or origin.username
            or origin.password
            or self.origin != f"https://{origin.netloc}"
            or origin.query
            or origin.fragment
        ):
            raise ValueError("cloud requires an exact HTTPS origin")
        if len(self.secret) < 32:
            raise ValueError("cloud master secret must contain at least 32 characters")
        if self.operator_backend not in {"deepseek", "opencode-go", "openrouter"}:
            raise ValueError("invalid operator backend")
        operator_key = {"opencode-go": self.opencode_go_key, "openrouter": self.openrouter_key,
                        "deepseek": self.deepseek_key}[self.operator_backend]
        if type(self.signup_limit) is not int or not 0 <= self.signup_limit <= 10_000:
            raise ValueError("invalid cloud signup limit")
        if type(self.trial_credits) is not int or not 0 <= self.trial_credits <= 1000:
            raise ValueError("invalid cloud trial credits")
        if self.private_test:
            if (len(self.allowed_emails) != 1 or self.signup_limit != 1 or self.trial_credits
                    or self.billing_enabled or self.ads_enabled or self.operator_backend != "openrouter"
                    or self.stripe_key or self.stripe_webhook_secret or any(price for _, price in self.stripe_prices)):
                raise ValueError("private test requires one allowed email and disables trials, sales and ads")
            if (type(self.test_budget_nano) is not int or type(self.test_prior_cost_nano) is not int
                    or not 0 <= self.test_prior_cost_nano <= self.test_budget_nano <= 100_000_000):
                raise ValueError("invalid private test budget")
        if any(not isinstance(email, str) or "@" not in email or len(email) > 254
               or email != email.strip().casefold() for email in self.allowed_emails):
            raise ValueError("invalid cloud email allowlist")
        if self.image_storage_enabled and (not self.inference_enabled or not operator_key):
            raise ValueError("image storage requires accepted operator inference")
        if not 0 <= self.monthly_subsidy_jpy <= 3000 or self.usd_jpy < 1:
            raise ValueError("invalid cloud budget")
        if self.supabase_url:
            parsed = urlsplit(self.supabase_url)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("invalid Supabase HTTPS endpoint")

    @classmethod
    def from_env(cls):
        if os.getenv("KYALULU_CLOUD_MODE") != "1":
            raise ValueError("set KYALULU_CLOUD_MODE=1 to start the separate hosted service")
        flag = lambda key: os.getenv(key, "0") == "1"
        return cls(
            root=Path(os.environ["KYALULU_CLOUD_DATA_DIR"]).resolve(),
            origin=os.environ["KYALULU_CLOUD_ORIGIN"],
            secret=os.environ["KYALULU_CLOUD_SECRET"],
            supabase_url=os.getenv("KYALULU_SUPABASE_URL", "").rstrip("/"),
            supabase_key=os.getenv("KYALULU_SUPABASE_ANON_KEY", ""),
            deepseek_key=os.getenv("KYALULU_DEEPSEEK_API_KEY", ""),
            # Initial hosted backend. Other transports require explicit selection.
            operator_backend=os.getenv("KYALULU_OPERATOR_BACKEND", "openrouter"),
            opencode_go_key=os.getenv("KYALULU_OPENCODE_GO_API_KEY", ""),
            go_hosting_permission_reference=os.getenv("KYALULU_GO_HOSTING_PERMISSION_REFERENCE", ""),
            go_accounting_approved=flag("KYALULU_GO_ACCOUNTING_APPROVED"),
            go_muse_region_approved=flag("KYALULU_GO_MUSE_REGION_APPROVED"),
            openrouter_key=os.getenv("KYALULU_OPENROUTER_API_KEY", ""),
            openrouter_approved=flag("KYALULU_OPENROUTER_APPROVED"),
            signup_limit=int(os.getenv("KYALULU_CLOUD_SIGNUP_LIMIT", "10")),
            stripe_key=os.getenv("KYALULU_STRIPE_SECRET_KEY", ""),
            stripe_webhook_secret=os.getenv("KYALULU_STRIPE_WEBHOOK_SECRET", ""),
            stripe_prices=tuple(
                (sku, os.getenv("KYALULU_STRIPE_PRICE_" + sku.upper(), ""))
                for sku in ("plus", "pro", "credits_5", "credits_10")
            ),
            billing_enabled=flag("KYALULU_BILLING_APPROVED"),
            legal_approved=flag("KYALULU_LEGAL_APPROVED"),
            inference_enabled=flag("KYALULU_INFERENCE_APPROVED"),
            image_storage_enabled=flag("KYALULU_IMAGES_APPROVED"),
            # The candidate's browser callback is insufficient. An independently verified
            # signed server integration must be configured before setting this flag.
            ads_enabled=flag("KYALULU_ADS_APPROVED"),
            ad_webhook_secret=os.getenv("KYALULU_AD_WEBHOOK_SECRET", ""),
            monthly_subsidy_jpy=int(os.getenv("KYALULU_MONTHLY_SUBSIDY_JPY", "3000")),
            usd_jpy=int(os.getenv("KYALULU_BUDGET_USD_JPY", "200")),
            web_dist=Path(os.environ["KYALULU_WEB_DIST"]).resolve()
            if os.getenv("KYALULU_WEB_DIST")
            else None,
            backup_root=Path(os.environ["KYALULU_CLOUD_BACKUP_DIR"]).resolve()
            if os.getenv("KYALULU_CLOUD_BACKUP_DIR")
            else None,
            private_test=flag("KYALULU_PRIVATE_TEST"),
            allowed_emails=tuple(email.strip().casefold() for email in
                os.getenv("KYALULU_CLOUD_ALLOWED_EMAILS", "").split(",") if email.strip()),
            trial_credits=int(os.getenv("KYALULU_CLOUD_TRIAL_CREDITS", "1000")),
            test_budget_nano=int(os.getenv("KYALULU_TEST_BUDGET_NANO_USD", "0")),
            test_prior_cost_nano=int(os.getenv("KYALULU_TEST_PRIOR_COST_NANO_USD", "0")),
        )
