import pytest
from python.cloud.community import Community
from python.cloud.store import CloudError


def test_publication_is_fixed_scrubbed_and_reaction_is_idempotent(tmp_path):
    community = Community(tmp_path/"shared.db")
    document = {"kind":"character","name":"Original world","nsfw":False,
        "data":{"description":"public","tags":["fantasy"],"secret":"private"},
        "profile":{"api_key":"private"},"histories":[{"content":"private"}],"assets":[{"uri":"private"}]}
    work = community.publish("owner-a","Author","lib-1",1,document)
    assert "private" not in str(work)
    assert work["author_id"] != "owner-a"
    assert community.publish("owner-a","Author","lib-1",1,document)["id"] == work["id"]
    community.reaction("owner-b",work["id"],"like",True)
    assert community.reaction("owner-b",work["id"],"like",True)["likes"]==1
    assert community.list("owner-b",tag="fantasy")["works"]
    with pytest.raises(CloudError,match="not_owned"):
        community.withdraw("owner-b",work["id"])
    community.withdraw("owner-a",work["id"])
    assert community.list("owner-b")["works"]==[]


def test_block_hides_both_directions_and_comments(tmp_path):
    community = Community(tmp_path/"shared.db")
    doc={"kind":"character","name":"Original","nsfw":False,"data":{}}
    a=community.publish("a","Author A","lib-a",1,doc)
    b=community.publish("b","Author B","lib-b",1,doc)
    community.comment("b",a["id"],"hello")
    assert len(community.comment("a",a["id"])["comments"])==1
    community.relation("a",b["author_id"],True,block=True)
    assert community.comment("a",a["id"])["comments"]==[]
    assert all(r["author_id"]!=b["author_id"] for r in community.list("a")["works"])
    with pytest.raises(CloudError,match="not_found"):
        community.comment("b",a["id"],"blocked")


def test_public_safety_and_input_limits(tmp_path):
    community=Community(tmp_path/"shared.db")
    with pytest.raises(CloudError,match="sfw"):
        community.publish("a","A","x",1,{"kind":"character","name":"x","nsfw":True})
    work=community.publish("a","A","x",1,{"kind":"character","name":"x","nsfw":False,"data":{}})
    with pytest.raises(CloudError,match="invalid_reaction"):
        community.reaction("a",work["id"],"like",1)
    with pytest.raises(CloudError,match="invalid_comment"):
        community.comment("a",work["id"]," "*2001)


def test_comment_retry_does_not_duplicate_and_block_removes_follow(tmp_path):
    community=Community(tmp_path/"shared.db")
    work=community.publish("a","A","x",1,{"kind":"character","name":"x","data":{}})
    community.register("b","B")
    community.relation("b",work["author_id"],True)
    community.comment("b",work["id"],"original","request-1")
    assert community.comment_replay("b",work["id"],"original","request-1")
    assert len(community.comment("b",work["id"],"original","request-1")["comments"])==1
    with pytest.raises(CloudError,match="conflict"):
        community.comment("b",work["id"],"edited","request-1")
    community.relation("a",community.author_id("b"),True,block=True)
    with pytest.raises(CloudError,match="not_found"):
        community.author("b",work["author_id"])
    with pytest.raises(CloudError,match="not_found"):
        community.relation("b",work["author_id"],True)
