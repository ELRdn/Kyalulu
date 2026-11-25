import json

import pytest

from scripts.sync_online_route_groups import DEDICATED, GROUPS, ROOT, check_routes, read_groups, sync


def test_next_pages_and_caddy_use_shared_delivery_groups():
    sync(ROOT)


def test_new_next_page_requires_a_rollout_group():
    groups = read_groups(ROOT)
    app_paths = DEDICATED | {path for group in groups.values() for path in group}
    with pytest.raises(ValueError, match="Missing:.*authors/:authorId/credits"):
        check_routes(groups, app_paths | {"/authors/[authorId]/credits"})


def test_rollout_groups_cannot_overlap(tmp_path):
    groups = read_groups(ROOT)
    groups["browse"].append("/profile/new")
    target = tmp_path / GROUPS
    target.parent.mkdir(parents=True)
    target.write_text(json.dumps(groups), encoding="utf-8")
    with pytest.raises(ValueError, match="Overlapping rollout groups"):
        read_groups(tmp_path)
