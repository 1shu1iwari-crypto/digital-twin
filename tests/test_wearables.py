import pytest

from cardiotwin.wearables import normalize_daily, normalize_metric, source_catalog, validate_source


def test_source_catalog_has_phone_first_integrations():
    ids = {source["id"] for source in source_catalog()}
    assert {"apple_health", "health_connect", "samsung_health", "google_health"} <= ids


@pytest.mark.parametrize(
    ("metric", "value", "unit", "expected"),
    [
        ("heart_rate", 72, "bpm", ("resting_hr", 72.0)),
        ("sleep_minutes", 450, "min", ("sleep_hours", 7.5)),
        ("oxygen_saturation", 0.97, "fraction", ("spo2", 97.0)),
        ("body_weight", 154.324, "lb", ("weight", pytest.approx(70.0, abs=0.02))),
    ],
)
def test_metric_normalization(metric, value, unit, expected):
    key, normalized = normalize_metric(metric, value, unit)
    assert key == expected[0]
    assert normalized == expected[1]


def test_daily_normalization_uses_single_canonical_contract():
    readings = [
        {"metric": "heart_rate", "value": 68, "unit": "bpm"},
        {"metric": "sleep_minutes", "value": 420, "unit": "min"},
        {"metric": "steps", "value": 6240, "unit": "steps"},
    ]
    assert normalize_daily(readings) == {
        "resting_hr": 68.0,
        "sleep_hours": 7.0,
        "steps": 6240.0,
    }


def test_unknown_sources_and_metrics_are_rejected():
    with pytest.raises(ValueError):
        validate_source("mystery_watch")
    with pytest.raises(ValueError):
        normalize_metric("magic_score", 42)
