import pytest
from python.cloud.creator_economics import simulate


def test_profit_share_is_not_revenue_share_and_has_no_negative_payout():
    value=simulate(gross_nano=10000,inference_nano=7700,processing_nano=0,creator_share_bps=2500)
    assert value["creator_nano"]==575 and value["operator_profit_nano"]==1725
    value=simulate(gross_nano=100,inference_nano=150,processing_nano=10,creator_share_bps=2500)
    assert value["creator_nano"]==0 and value["loss_nano"]==60


@pytest.mark.parametrize("share",[-1,10001,True,0.25])
def test_invalid_share_rejected(share):
    with pytest.raises(ValueError):
        simulate(gross_nano=100,inference_nano=70,processing_nano=0,creator_share_bps=share)
