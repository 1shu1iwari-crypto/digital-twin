from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import json
import time
from fastapi.testclient import TestClient
from cardiotwin.api import create_app

ACTION = {"X-CardioTwin-Action": "1"}


def post(client, path, body=None):
    return client.post("/api/care"+path, json=body or {}, headers=ACTION)


def enroll(client, pid="HF-0004", metrics=None):
    assert post(client, "/login", {"access_key": "demo-clinician"}).status_code == 200
    invite = post(client, "/invitations", {"patient_id": pid})
    assert invite.status_code == 201, invite.text
    invitation = invite.json()
    assert post(client, "/member/exchange", {"token": invitation["token"]}).status_code == 200
    assert post(client, "/member/consent", {"metrics": metrics or ["weight", "resting_hr"], "acknowledged": True}).status_code == 200
    return invitation


def summary(client, count=1):
    start = date.fromisoformat(client.get("/api/care/member").json()["next_date"])
    return {"days": [{"source": "manual", "timestamp": str(start+timedelta(days=i)),
                      "readings": [{"metric": "weight", "value": 70+i/10, "unit": "kg"},
                                   {"metric": "resting_hr", "value": 72, "unit": "bpm"}]} for i in range(count)]}


def test_role_boundaries_action_header_and_private_responses(client):
    assert client.get("/api/care/workspace").status_code == 401
    assert client.get("/api/care/member").status_code == 401
    assert client.post("/api/care/login", json={"access_key": "demo-clinician"}).status_code == 403
    assert post(client, "/login", {"access_key": "incorrect"}).status_code == 401
    result = post(client, "/login", {"access_key": "demo-clinician"})
    assert "httponly" in result.headers["set-cookie"].lower()
    assert "samesite=strict" in result.headers["set-cookie"].lower()
    assert result.headers["cache-control"] == "no-store"
    assert client.get("/api/care/member").status_code == 401
    post(client, "/logout")
    assert client.get("/api/care/workspace").status_code == 401


def test_invitation_is_hashed_single_use_and_consent_is_required(client):
    post(client, "/login", {"access_key": "demo-clinician"})
    invitation = post(client, "/invitations", {"patient_id": "HF-0004"}).json()
    with client.app.state.store.connect() as conn:
        saved = conn.execute("SELECT token_hash FROM care_enrollments WHERE id=?", (invitation["id"],)).fetchone()[0]
    assert saved != invitation["token"]
    assert post(client, "/invitations", {"patient_id": "HF-0004"}).status_code == 409
    assert post(client, "/member/exchange", {"token": invitation["token"]}).status_code == 200
    assert post(client, "/member/exchange", {"token": invitation["token"]}).status_code == 410
    assert post(client, "/member/preview", summary(client)).status_code == 403
    assert post(client, "/member/consent", {"metrics": ["weight"], "acknowledged": False}).status_code == 422
    assert post(client, "/member/consent", {"metrics": ["unknown"], "acknowledged": True}).status_code == 422
    assert post(client, "/member/consent", {"metrics": ["weight"], "acknowledged": True}).status_code == 200
    assert post(client, "/member/submissions", summary(client)).status_code == 422  # pulse is not shared


def test_preview_queue_review_and_concurrent_accept_are_atomic(client):
    enroll(client)
    before = client.app.state.store.history("HF-0004").to_json()
    payload = summary(client, 2)
    preview = post(client, "/member/preview", payload)
    assert preview.status_code == 200, preview.text
    assert preview.json()["persisted"] is False
    assert preview.json()["days"][0]["coverage"] == 2/9
    receipt = post(client, "/member/submissions", payload).json()
    sid = receipt["submission"]["id"]
    assert receipt["submission"]["status"] == "pending"
    assert client.app.state.store.history("HF-0004").to_json() == before
    assert post(client, "/member/submissions", payload).json()["duplicate"] is True
    changed = json.loads(json.dumps(payload)); changed["days"][0]["readings"][0]["value"] = 71
    assert post(client, "/member/submissions", changed).status_code == 409
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: post(client, f"/submissions/{sid}/review", {"decision": "accept"}), range(2)))
    assert sorted(r.status_code for r in responses) == [200, 409]
    rows = client.app.state.store.history("HF-0004")
    assert rows.iloc[-1].timestamp == payload["days"][-1]["timestamp"]
    assert rows.iloc[-1].submission_id == sid
    assert rows.iloc[-1].source == "manual"
    assert rows.iloc[-1].weight == 70.1
    assert client.get("/api/patients/HF-0004/twin").json()["risk"] is None
    assert post(client, "/member/submissions", payload).json()["duplicate"] is True


def test_member_cannot_review_or_change_patient_and_history_is_scoped(client):
    first = enroll(client)
    sid = post(client, "/member/submissions", summary(client)).json()["submission"]["id"]
    client.cookies.delete("ct_care_clinician")
    assert post(client, f"/submissions/{sid}/review", {"decision": "accept"}).status_code == 401
    assert client.get("/api/care/workspace").status_code == 401
    assert post(client, "/member/submissions", {**summary(client), "patient_id": "HF-0006"}).status_code == 422
    enroll(client, "HF-0006")
    home = client.get("/api/care/member").json()
    assert home["patient"]["patient_id"] == "HF-0006"
    assert home["submissions"] == []
    with client.app.state.store.connect() as conn:
        assert conn.execute("SELECT status FROM care_enrollments WHERE id=?", (first["id"],)).fetchone()[0] == "active"


def test_correction_note_and_withdrawal_leave_ledger_untouched(client):
    enroll(client)
    before = client.app.state.store.history("HF-0004").to_json()
    payload = summary(client)
    sid = post(client, "/member/submissions", payload).json()["submission"]["id"]
    assert post(client, f"/submissions/{sid}/review", {"decision": "reject"}).status_code == 422
    assert post(client, f"/submissions/{sid}/review", {"decision": "reject", "note": "Please verify the weight."}).status_code == 200
    assert client.get("/api/care/member").json()["submissions"][0]["review_note"] == "Please verify the weight."
    payload["days"][0]["readings"][0]["value"] = 71
    second = post(client, "/member/submissions", payload).json()["submission"]["id"]
    assert post(client, "/member/revoke").status_code == 200
    assert client.get("/api/care/member").json()["submissions"][0]["status"] == "withdrawn"
    assert post(client, f"/submissions/{second}/review", {"decision": "accept"}).status_code == 409
    assert post(client, "/member/submissions", payload).status_code == 403
    assert client.app.state.store.history("HF-0004").to_json() == before


def test_validation_dates_bounds_aliases_and_replay_conflict(client):
    enroll(client)
    payload = summary(client, 2)
    invalid = json.loads(json.dumps(payload)); invalid["days"][1]["timestamp"] = "2099-01-01"
    assert post(client, "/member/preview", invalid).status_code == 422
    invalid = json.loads(json.dumps(payload)); invalid["days"][0]["readings"][0]["value"] = 999
    assert post(client, "/member/preview", invalid).status_code == 422
    invalid = json.loads(json.dumps(payload)); invalid["days"][0]["readings"].append({"metric": "body_weight", "value": 70})
    assert post(client, "/member/preview", invalid).status_code == 422
    invalid = json.loads(json.dumps(payload)); invalid["days"][0]["source"] = "unknown"
    assert post(client, "/member/preview", invalid).status_code == 422
    sid = post(client, "/member/submissions", payload).json()["submission"]["id"]
    # A legacy append or replay after submission must never be overwritten.
    response = client.post("/api/patients/HF-0004/telemetry", json={"timestamp": payload["days"][0]["timestamp"], "weight": 73})
    assert response.status_code == 201
    before = client.app.state.store.history("HF-0004").to_json()
    assert post(client, f"/submissions/{sid}/review", {"decision": "accept"}).status_code == 409
    assert client.app.state.store.history("HF-0004").to_json() == before


def test_expired_invitation_and_clinician_ended_connection(client):
    post(client, "/login", {"access_key": "demo-clinician"})
    invitation = post(client, "/invitations", {"patient_id": "HF-0004"}).json()
    with client.app.state.store.connect() as conn:
        conn.execute("UPDATE care_enrollments SET expires=? WHERE id=?", (time.time()-1, invitation["id"]))
    assert post(client, "/member/exchange", {"token": invitation["token"]}).status_code == 410
    assert client.get("/api/care/workspace").json()["enrollments"][0]["status"] == "expired"
    active = enroll(client)
    assert post(client, f"/enrollments/{active['id']}/revoke").status_code == 200
    assert client.get("/api/care/member").json()["status"] == "revoked"
    assert post(client, "/member/consent", {"metrics": ["weight"], "acknowledged": True}).status_code == 409


def test_workflow_survives_restart_and_demo_reset_clears_sessions(client, model_dir):
    enroll(client)
    sid = post(client, "/member/submissions", summary(client)).json()["submission"]["id"]
    with TestClient(create_app(client.app.state.store.path, model_dir)) as restarted:
        restarted.cookies.update(client.cookies)
        assert restarted.get("/api/care/member").json()["submissions"][0]["id"] == sid
        assert len(restarted.get("/api/care/workspace").json()["events"]) == 4
        assert restarted.post("/api/demo/reset", json={}).status_code == 200
        assert restarted.get("/api/care/member").status_code == 401


def test_configured_key_replaces_demo_login_and_rate_limit(client, monkeypatch):
    monkeypatch.setenv("CARDIOTWIN_CLINICIAN_KEY", "local-test-key")
    assert client.get("/api/care/config").json()["demo_access"] is False
    assert post(client, "/login", {"access_key": "demo-clinician"}).status_code == 401
    assert post(client, "/login", {"access_key": "local-test-key"}).status_code == 200
    for _ in range(8):
        post(client, "/login", {"access_key": "wrong"})
    assert post(client, "/login", {"access_key": "local-test-key"}).status_code == 429
