import pytest

from scripts.prepare_online_pwa import check_relay_origin


RELAY = "https://relay.example"
WORKER = f'const BUILD_RELAY_ORIGIN = "{RELAY}";\nconst VERSION = "test";\n'


def test_matching_web_next_and_destination():
    assert check_relay_origin(WORKER, next_origin=RELAY, expected=RELAY) == RELAY


@pytest.mark.parametrize("next_origin", ["https://other.example", ""])
def test_mixed_web_and_next_are_rejected(next_origin):
    with pytest.raises(ValueError, match="different Relay origins"):
        check_relay_origin(WORKER, next_origin=next_origin)


def test_worker_without_relay_metadata_requires_legacy_mode():
    worker = 'const VERSION = "test";\n'
    assert check_relay_origin(worker, next_origin=RELAY) is None
    with pytest.raises(ValueError, match="expected Relay origin"):
        check_relay_origin(worker, next_origin=RELAY, expected=RELAY)


def test_recovery_worker_must_match_destination():
    with pytest.raises(ValueError, match="expected Relay origin"):
        check_relay_origin(WORKER, expected="https://other.example")
