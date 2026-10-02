import pytest

from api.services.telephony.providers.twilio.provider import to_dial_address


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("+972765324207", "+972765324207"),
        ("972 (765) 324-207", "+972765324207"),
        # Local number typed after picking Israel keeps its trunk 0.
        ("+9720765324207", "+972765324207"),
        ("+1 415 555 0100", "+14155550100"),
        ("+20 10 1234 5678", "+201012345678"),
        # Italy keeps the leading 0 internationally.
        ("+39 06 1234 5678", "+390612345678"),
    ],
)
def test_pstn_destinations_are_dialed_as_e164(raw, expected):
    assert to_dial_address(raw) == expected


@pytest.mark.parametrize("raw", ["sip:bob@example.com", "PJSIP/1234"])
def test_non_pstn_destinations_pass_through(raw):
    assert to_dial_address(raw) == raw
