import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("parity",Path(__file__).parents[1]/"scripts/competitor_parity.py")
parity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parity)


def test_original_fixtures_and_unverified_baseline():
    data = parity.fixtures()
    assert len(data["short"])==12
    assert [r["family"] for r in data["short"]].count("story")==6
    assert len(data["long"])==12 and {r["length"] for r in data["long"]}=={30,50,100}
    assert {r["split"] for r in data["short"]}=={"development"}
    assert len(data["held_out_short"]) == len(data["held_out_long"]) == 12
    assert {r["split"] for r in data["held_out_short"] + data["held_out_long"]} == {"acceptance"}
    assert not {r['id'] for r in data['short']} & {r['id'] for r in data['held_out_short']}
    assert all(a['turns'] != b['turns'] for a,b in zip(data['short'], data['held_out_short']))
    assert len(parity.ledger()["entries"])==60
    assert parity.report([],[])["overall_parity"]=="unverified"


def test_small_sample_and_missing_humans_never_certify_quality():
    ratings = [{"competitor":"zeta","status":"completed","split":"acceptance","rater":"one","character_id":str(i),
        "kyalulu":dict.fromkeys(parity.AXES,5),"reference":dict.fromkeys(parity.AXES,1)} for i in range(12)]
    assert all(r["status"]=="pending" for r in parity.quality(ratings,"zeta").values())
    ratings = [{**row,"rater":str(j)} for row in ratings for j in range(3)]
    assert all(r["status"]=="passed" for r in parity.quality(ratings,"zeta").values())
    for row in ratings:
        row["kyalulu"]=dict.fromkeys(parity.AXES,1)
        row["reference"]=dict.fromkeys(parity.AXES,5)
    assert all(r["status"]=="failed" for r in parity.quality(ratings,"zeta").values())


def test_latency_requires_100_observations_and_keeps_failures():
    rows = [{"product":p,"plan":"free","setting":"default","split":"acceptance","status":"completed",
        "first_body_ms":100 if p=="zeta" else 121,"completion_ms":200} for p in ("kyalulu","zeta") for _ in range(99)]
    result = parity.report(rows,[])["comparisons"]["zeta"]["free/default"]
    assert result["latency_gates"]["first_body_ms"]=="pending"
    rows += [dict(rows[0]),dict(rows[-1]),{"product":"kyalulu","plan":"free","setting":"default","split":"acceptance","status":"failed"}]
    result = parity.report(rows,[])["comparisons"]["zeta"]["free/default"]
    assert result["latency_gates"]["first_body_ms"]=="failed"
    assert result["arms"]["kyalulu"]["attempts"]==101
    assert result["arms"]["kyalulu"]["failure_rate"]>0


def test_missing_paid_track_cannot_borrow_free_measurements():
    rows = [{"product":"zeta","plan":"paid","setting":"default","status":"completed","first_body_ms":10}]
    result = parity.report(rows,[])["comparisons"]["zeta"]["paid/default"]
    assert result["arms"]["kyalulu"]["attempts"]==0
    assert result["latency_gates"]["first_body_ms"]=="pending"


def test_mock_replay_and_rater_coverage_cannot_certify_parity():
    rows=[{"product":p,"plan":"free","setting":"daily-cloud","status":"completed","mock":True,
           "first_body_ms":1,"completion_ms":2,"operator_cost_nano":0,"user_cost_minor":0,"currency":"JPY"}
          for p in ("kyalulu","zeta") for _ in range(120)]
    arms=parity.report(rows,[])["comparisons"]["zeta"]["free/daily-cloud"]["arms"]
    assert arms["kyalulu"]["attempts"]==0 and arms["kyalulu"]["excluded_mock_or_replay"]==120
    assert parity.failure_gate(0,100)["status"]=="pending"
    assert parity.failure_gate(0,500)["status"]=="passed"
    assert parity.failure_gate(30,500)["status"]=="failed"
    ratings=[{"competitor":"zeta","status":"completed","rater":str(i%3),"character_id":str(i),
              "kyalulu":dict.fromkeys(parity.AXES,5),"reference":dict.fromkeys(parity.AXES,1)} for i in range(12)]
    assert all(r["status"]=="pending" for r in parity.quality(ratings,"zeta").values())


def test_development_and_unmarked_records_never_accept_formal_quality_or_latency():
    ratings = [{"competitor":"zeta","status":"completed","rater":str(j),"character_id":str(i),
        "split":"development","kyalulu":dict.fromkeys(parity.AXES,5),"reference":dict.fromkeys(parity.AXES,1)}
        for i in range(12) for j in range(3)]
    assert all(r["status"] == "pending" for r in parity.quality(ratings,"zeta").values())
    rows = [{"product":p,"plan":"free","setting":"default","status":"completed","first_body_ms":10,"completion_ms":20}
            for p in ('kyalulu','zeta') for _ in range(120)]
    result = parity.report(rows, [])["comparisons"]["zeta"]["free/default"]
    assert result["latency_gates"]["first_body_ms"] == "pending"
    assert result["arms"]["kyalulu"]["excluded_development_or_unknown_split"] == 120
