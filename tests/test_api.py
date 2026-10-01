from datetime import date, timedelta
import json
from fastapi.testclient import TestClient
from cardiotwin.api import create_app

def ready_patient(client):
    population=client.get("/api/patients").json()["patients"]
    return next(p for p in population if p["risk"] is not None)

def next_reading(client,pid):
    twin=client.get(f"/api/patients/{pid}/twin").json()
    return {"timestamp":str(date.fromisoformat(twin["timestamp"])+timedelta(days=1)),
            **{s["key"]:s["value"] for s in twin["signals"]}}

def test_population_sorted_and_endpoints_agree(client):
    assert client.get("/api/health").json()["status"]=="ok"
    population=client.get("/api/patients").json()
    assert len(population["patients"])==32
    values=[p["risk"] for p in population["patients"] if p["risk"] is not None]
    assert values==sorted(values,reverse=True)
    pid=ready_patient(client)["patient_id"]
    twin=client.get(f"/api/patients/{pid}/twin").json()
    assert client.get(f"/api/patients/{pid}/risk").json()==twin["risk"]
    assert client.get(f"/api/patients/{pid}/explanation").json()==twin["risk"]["explanation"]
    assert client.get("/api/patients/unknown").status_code==404
    assert len(client.get("/api/evaluation").json()["models"])==6

def test_replay_hides_future_and_advances_one_day(client):
    pid=ready_patient(client)["patient_id"]
    before=client.get(f"/api/patients/{pid}/timeline?days=90").json()["observations"]
    assert max(r["day"] for r in before)<=35
    advance=client.post("/api/demo/advance",json={}).json()
    assert advance["day"]==36
    after=client.get(f"/api/patients/{pid}/timeline?days=90").json()["observations"]
    assert len(after) in [len(before),len(before)+1]
    assert max(r["day"] for r in after)<=36

def test_scenario_is_non_mutating_and_zero_matches(client):
    pid=ready_patient(client)["patient_id"]
    before=client.get(f"/api/patients/{pid}/timeline").json()
    result=client.post(f"/api/patients/{pid}/simulate",json={}).json()
    assert result["simulated"]["risk"]["probability"]==result["current"]["risk"]["probability"]
    assert result["persisted"] is False
    assert client.get(f"/api/patients/{pid}/timeline").json()==before

def test_scenario_changes_features_without_persistence(client):
    pid=ready_patient(client)["patient_id"]
    twin=client.get(f"/api/patients/{pid}/twin").json()
    if next(s for s in twin["signals"] if s["key"]=="weight")["value"] is None:
        return
    result=client.post(f"/api/patients/{pid}/simulate",json={"weight_delta":2}).json()
    original=next(s for s in result["current"]["signals"] if s["key"]=="weight")["value"]
    changed=next(s for s in result["simulated"]["signals"] if s["key"]=="weight")["value"]
    assert changed==original+2
    assert client.get(f"/api/patients/{pid}/twin").json()==twin

def test_ingest_persists_and_duplicate_is_rejected(client):
    pid=ready_patient(client)["patient_id"]
    payload=next_reading(client,pid)
    before=client.get(f"/api/patients/{pid}/twin").json()["last_day"]
    response=client.post(f"/api/patients/{pid}/telemetry",json=payload)
    assert response.status_code==201,response.text
    assert response.json()["last_day"]==before+1
    assert client.post(f"/api/patients/{pid}/telemetry",json=payload).status_code==409

def test_input_validation_and_unknown_fields(client):
    pid=ready_patient(client)["patient_id"]
    payload=next_reading(client,pid)
    assert client.post(f"/api/patients/{pid}/telemetry",json={**payload,"spo2":120}).status_code==422
    assert client.post(f"/api/patients/{pid}/simulate",json={"treatment_dose":40}).status_code==422
    assert client.post(f"/api/patients/{pid}/simulate",json={"weight_delta":99}).status_code==422
    assert client.post(f"/api/patients/{pid}/telemetry",json={"timestamp":payload["timestamp"]}).status_code==422
    assert client.get(f"/api/patients/{pid}/timeline?days=10000").status_code==422

def test_missing_data_abstains_instead_of_inventing_risk(client):
    pid=ready_patient(client)["patient_id"]
    payload=next_reading(client,pid)
    response=client.post(f"/api/patients/{pid}/telemetry",json={"timestamp":payload["timestamp"],"weight":75})
    assert response.status_code==201
    assert response.json()["risk"] is None
    assert response.json()["status"]=="Insufficient data"
    assert all(i["value"] is None for i in response.json()["indices"])

def test_individual_missing_sensor_does_not_invent_stable_index(client):
    pid=ready_patient(client)["patient_id"]
    payload=next_reading(client,pid)
    payload["spo2"]=None
    response=client.post(f"/api/patients/{pid}/telemetry",json=payload)
    assert response.status_code==201
    assert next(i for i in response.json()["indices"] if i["name"]=="Oxygenation stability")["value"] is None

def test_sqlite_survives_app_restart(tmp_path,model_dir):
    path=tmp_path/"persistent.sqlite"
    with TestClient(create_app(path,model_dir)) as first:
        pid=ready_patient(first)["patient_id"]
        response=first.post(f"/api/patients/{pid}/telemetry",json=next_reading(first,pid))
        expected=response.json()["last_day"]
    with TestClient(create_app(path,model_dir)) as second:
        assert second.get(f"/api/patients/{pid}/twin").json()["last_day"]==expected

def test_new_patient_abstains_and_duplicate_is_rejected(client):
    patient=ready_patient(client)
    allowed=["name","age","sex","lvef","nyha","creatinine","egfr","sodium","hemoglobin","previous_admissions","diabetes","ckd","copd"]
    payload={k:patient[k] for k in allowed}
    payload["patient_id"]="HF-NEW"
    assert client.post("/api/patients",json=payload).status_code==201
    assert client.get("/api/patients/HF-NEW/twin").json()["risk"] is None
    assert client.post("/api/patients",json=payload).status_code==409

def test_reset_returns_deterministic_original_state(client):
    original=client.get("/api/patients").json()
    client.post("/api/demo/advance",json={})
    client.post("/api/demo/reset",json={})
    assert client.get("/api/patients").json()==original
