from datetime import date, timedelta
import pytest
from cardiotwin.ingestion import aggregate_samples, ingest_telemetry_batch
from cardiotwin.store import Store

def test_multi_sample_aggregation():
    samples = [
        {"timestamp": "2026-08-01", "steps": 2500, "sleep_hours": 3.5, "resting_hr": 78, "spo2": 96, "respiratory_rate": 18},
        {"timestamp": "2026-08-01", "steps": 3500, "sleep_hours": 4.0, "resting_hr": 64, "spo2": 94, "respiratory_rate": 20},
    ]
    agg = aggregate_samples(samples)
    # Steps and sleep summed
    assert agg["steps"] == 6000
    assert agg["sleep_hours"] == 7.5
    # Resting heart rate is minimum valid sample (true basal resting rate)
    assert agg["resting_hr"] == 64
    # SpO2 and respiratory rate are averaged
    assert agg["spo2"] == 95.0
    assert agg["respiratory_rate"] == 19.0

def test_aggregation_filters_out_of_bounds():
    samples = [
        {"timestamp": "2026-08-01", "resting_hr": 65, "spo2": 95},
        {"timestamp": "2026-08-01", "resting_hr": 300, "spo2": 40},  # Out of physiological bounds
    ]
    agg = aggregate_samples(samples)
    assert agg["resting_hr"] == 65
    assert agg["spo2"] == 95

def test_batch_ingestion_backfill_and_deduplication(tmp_path):
    store = Store(tmp_path / "test_ingest.sqlite")
    p = store.patients()[0]
    pid = p["patient_id"]
    history = store.history(pid)
    initial_len = len(history)
    initial_last_day = int(history.day.max())

    # 1. Deduplication test: re-sending identical readings for existing day
    last_row = history.iloc[-1].to_dict()
    batch_dup = [{
        "timestamp": str(last_row["timestamp"]),
        "resting_hr": last_row["resting_hr"],
        "steps": last_row["steps"]
    }]
    res = ingest_telemetry_batch(store, pid, batch_dup)
    assert res["deduplicated"] == 1
    assert res["inserted"] == 0
    assert res["updated"] == 0

    # 2. Backfill test: updating a past day (e.g. day 10) with newly synced sensor data
    past_row = history[history.day == 10].iloc[0].to_dict()
    batch_backfill = [{
        "timestamp": str(past_row["timestamp"]),
        "steps": 8500.0,
        "resting_hr": 62.0
    }]
    res_backfill = ingest_telemetry_batch(store, pid, batch_backfill, allow_backfill=True)
    assert res_backfill["updated"] == 1
    assert 10 in res_backfill["affected_days"]

    # Verify past day updated in history
    updated_history = store.history(pid)
    day_10 = updated_history[updated_history.day == 10].iloc[0]
    assert day_10["steps"] == 8500.0
    assert day_10["resting_hr"] == 62.0

    # 3. Next calendar day insertion
    next_date = date.fromisoformat(str(last_row["timestamp"])) + timedelta(days=1)
    batch_next = [
        {"timestamp": str(next_date), "steps": 3000, "resting_hr": 68, "spo2": 96},
        {"timestamp": str(next_date), "steps": 2500, "resting_hr": 65, "spo2": 94}
    ]
    res_next = ingest_telemetry_batch(store, pid, batch_next)
    assert res_next["inserted"] == 1
    assert initial_last_day + 1 in res_next["affected_days"]
    final_history = store.history(pid)
    assert len(final_history) == initial_len + 1
    new_day = final_history.iloc[-1]
    assert new_day["steps"] == 5500
    assert new_day["resting_hr"] == 65

def test_companion_endpoint(client):
    patients = client.get("/api/patients").json()["patients"]
    pid = patients[0]["patient_id"]
    res = client.get(f"/api/patients/{pid}/companion")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["patient_id"] == pid
    assert "patient_name" in data
    assert "status" in data
    assert "today_vitals" in data
    assert "sync_quality" in data
    assert "clinical_review" in data
    assert "disclaimer" in data
    assert "Synthetic demonstration" in data["disclaimer"]

def test_batch_api_endpoint(client):
    patients = client.get("/api/patients").json()["patients"]
    pid = patients[0]["patient_id"]
    twin = client.get(f"/api/patients/{pid}/twin").json()
    next_ts = str(date.fromisoformat(twin["timestamp"]) + timedelta(days=1))

    payload = {
        "items": [
            {"timestamp": next_ts, "steps": 1200, "resting_hr": 74},
            {"timestamp": next_ts, "steps": 2200, "resting_hr": 68, "spo2": 97}
        ]
    }
    res = client.post(f"/api/patients/{pid}/telemetry/batch", json=payload)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["summary"]["inserted"] == 1
    assert body["twin"]["last_day"] == twin["last_day"] + 1
