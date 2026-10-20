import pytest
from datetime import date, timedelta

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


@pytest.mark.parametrize("metric,value,unit", [
    ("weight", 70, "oz"), ("hrv", 42, "seconds"),
    ("sleep_minutes", 450, "h"), ("spo2", 97, "fraction"),
    ("heart_rate", float("nan"), "bpm"), ("steps", float("inf"), "steps"),
])
def test_invalid_units_and_nonfinite_values_are_rejected(metric, value, unit):
    with pytest.raises(ValueError):
        normalize_metric(metric, value, unit)


def summary(client, pid="HF-0004"):
    twin = client.get(f"/api/patients/{pid}/twin").json()
    return {"source": "apple_health",
            "timestamp": str(date.fromisoformat(twin["timestamp"]) + timedelta(days=1)),
            "readings": [{"metric": "body_weight", "value": 154.324, "unit": "lb"},
                         {"metric": "sleep_minutes", "value": 450, "unit": "min"},
                         {"metric": "oxygen_saturation", "value": .97, "unit": "fraction"}]}


def test_preview_converts_and_reports_missing_without_writing(client):
    path = "/api/patients/HF-0004"
    before = client.get(f"{path}/timeline?days=90").json()
    twin_before = client.get(f"{path}/twin").json()
    response = client.post(f"{path}/wearables/preview", json=summary(client))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["normalized"]["weight"] == pytest.approx(70, abs=.02)
    assert result["normalized"]["sleep_hours"] == 7.5
    assert result["normalized"]["spo2"] == 97
    assert result["units"] == {"weight": "kg", "sleep_hours": "h", "spo2": "%"}
    assert len(result["missing_metrics"]) == 6
    assert result["coverage"] == pytest.approx(1/3)
    assert result["persisted"] is False
    assert result["patient_id"] == "HF-0004"
    assert client.get(f"{path}/timeline?days=90").json() == before
    assert client.get(f"{path}/twin").json() == twin_before


def test_commit_persists_normalized_values_and_source_and_rejects_retry(client, model_dir):
    from fastapi.testclient import TestClient
    from cardiotwin.api import create_app
    path = "/api/patients/HF-0004"
    payload = summary(client)
    response = client.post(f"{path}/wearables/ingest", json=payload)
    assert response.status_code == 201, response.text
    assert response.json()["twin"]["risk"] is None  # Three signals cannot invent a complete day.
    rows = client.get(f"{path}/timeline?days=90").json()["observations"]
    assert rows[-1]["source"] == "apple_health"
    assert rows[-1]["weight"] == pytest.approx(70, abs=.02)
    assert rows[-1]["sleep_hours"] == 7.5
    with TestClient(create_app(client.app.state.store.path, model_dir)) as restarted:
        assert restarted.get(f"{path}/timeline?days=90").json()["observations"] == rows
    assert client.post(f"{path}/wearables/ingest", json=payload).status_code == 409
    assert client.post(f"{path}/wearables/preview", json=payload).status_code == 409


@pytest.mark.parametrize("endpoint", ["preview", "ingest"])
def test_both_paths_validate_and_reject_unknown_patient(client, endpoint):
    payload = summary(client)
    path = f"/api/patients/HF-0004/wearables/{endpoint}"
    before = client.get("/api/patients/HF-0004/timeline").json()
    for invalid in [
        {**payload, "source": "unknown"},
        {**payload, "readings": []},
        {**payload, "readings": [{"metric": "weight", "value": 999, "unit": "kg"}]},
        {**payload, "readings": [{"metric": "weight", "value": 70, "unit": "oz"}]},
        {**payload, "readings": [{"metric": "magic", "value": 1}]},
        {**payload, "token": "must-not-be-accepted"},
    ]:
        assert client.post(path, json=invalid).status_code == 422
    assert client.post(path, json={**payload, "timestamp": "2099-01-01"}).status_code == 409
    assert client.post(f"/api/patients/unknown/wearables/{endpoint}", json=payload).status_code == 404
    assert client.get("/api/patients/HF-0004/timeline").json() == before
