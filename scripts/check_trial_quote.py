"""No inference: verify first-turn maximum reservation fits the trial grant."""

import asyncio
from pathlib import Path
import sys
import tempfile
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime"))
from python.cloud.app import create_app
from python.cloud.config import CloudConfig
from python.cloud.auth import provider_consent_version
from python.cloud.generation import CloudChat
from python.storage.context import CloudStorageContext, storage_context
from python.storage.db import init_db


async def main():
    with tempfile.TemporaryDirectory() as tmp:
        config = CloudConfig(
            Path(tmp),
            "https://cloud.test",
            "x" * 32,
            inference_enabled=True,
            openrouter_approved=True,
            openrouter_key="mock-key",
        )
        app = create_app(config)
        owner = str(uuid4())
        app.state.store.account(owner, consent=provider_consent_version(config))
        app.state.store.trial(owner)
        with storage_context(
            CloudStorageContext.for_owner(config.root / "tenants", owner)
        ):
            await init_db()
            quote = await app.state.jobs.quote(
                owner,
                CloudChat(
                    model_id="cloud-standard",
                    messages=[{"role": "user", "content": "こんにちは"}],
                ),
            )
            print(
                {
                    "max_credits": quote["max_credits"],
                    "trial_credits": 1000,
                    "inference_attempts": 0,
                }
            )
            assert quote["max_credits"] <= 1000, (
                "Initial trial cannot reserve even a first turn"
            )


if __name__ == "__main__":
    asyncio.run(main())
