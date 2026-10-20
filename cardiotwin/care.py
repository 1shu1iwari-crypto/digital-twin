"""Local synthetic member-to-clinician workflow, separate from provider authorization.

An invitation binds a member session to one patient. Submissions stay quarantined
until a clinician accepts them in the same transaction as the ledger append.
"""
from datetime import date, timedelta
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from fastapi import HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from .config import load_config
from .twin import SIGNAL_NAMES
from .wearables import normalize_daily, validate_source


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Login(StrictModel):
    access_key: str = Field(min_length=1, max_length=256)


class Invite(StrictModel):
    patient_id: str = Field(min_length=1, max_length=40)


class Exchange(StrictModel):
    token: str = Field(min_length=20, max_length=100)


class Consent(StrictModel):
    metrics: list[str] = Field(min_length=1, max_length=9)
    acknowledged: bool


class Reading(StrictModel):
    metric: str = Field(min_length=1, max_length=80)
    value: float
    unit: str | None = Field(None, max_length=30)


class DailySummary(StrictModel):
    source: str = Field(min_length=1, max_length=40)
    timestamp: date
    readings: list[Reading] = Field(min_length=1, max_length=9)


class Submission(StrictModel):
    days: list[DailySummary] = Field(min_length=1, max_length=31)


class Review(StrictModel):
    decision: str = Field(pattern="^(accept|reject)$")
    note: str = Field(default="", max_length=500)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def install_care(app, telemetry_type):
    attempts = {}
    clinician_cookie, member_cookie = "ct_care_clinician", "ct_care_member"

    def db():
        conn = app.state.store.connect()
        conn.row_factory = sqlite3.Row
        return conn

    def audit(conn, enrollment_id, kind, details=None):
        conn.execute("INSERT INTO care_audit(enrollment_id,kind,at,details) VALUES (?,?,?,?)",
                     (enrollment_id, kind, time.time(), json.dumps(details or {})))

    def mutation(request):
        if request.headers.get("X-CardioTwin-Action") != "1":
            raise HTTPException(403, "Use the CardioTwin submission form or the documented client header")

    def session(request, role):
        token = request.cookies.get(clinician_cookie if role == "clinician" else member_cookie, "")
        with db() as conn:
            row = conn.execute("SELECT * FROM care_sessions WHERE token_hash=? AND role=? AND expires>?",
                               (digest(token), role, time.time())).fetchone()
        if row is None:
            raise HTTPException(401, "Open your invitation link" if role == "member" else "Enter the clinician access key")
        return dict(row)

    def clinician(request):
        session(request, "clinician")

    def member(request):
        user = session(request, "member")
        with db() as conn:
            row = conn.execute("SELECT * FROM care_enrollments WHERE id=?", (user["enrollment_id"],)).fetchone()
        if row is None:
            raise HTTPException(401, "This invitation is no longer available")
        return dict(row)

    def set_session(response, role, enrollment_id=None):
        token = secrets.token_urlsafe(32)
        lifetime = 8 * 3600 if role == "clinician" else 30 * 86400
        with db() as conn:
            conn.execute("INSERT INTO care_sessions VALUES (?,?,?,?)", (digest(token), role, enrollment_id, time.time()+lifetime))
        response.set_cookie(clinician_cookie if role == "clinician" else member_cookie, token,
                            httponly=True, samesite="strict", secure=os.getenv("CARDIOTWIN_SECURE_COOKIES") == "1",
                            max_age=lifetime, path="/api/care")

    def next_date(conn, pid):
        row = conn.execute("SELECT payload FROM telemetry WHERE patient_id=? ORDER BY day DESC LIMIT 1", (pid,)).fetchone()
        return (date.fromisoformat(json.loads(row[0])["timestamp"])+timedelta(days=1)).isoformat() if row else None

    def public_submission(row):
        result = dict(row)
        result.pop("fingerprint", None)
        result["days"] = json.loads(result.pop("payload"))
        return result

    def require_consent(enrollment):
        if enrollment["status"] != "active":
            raise HTTPException(403, "Sharing is not active. Review your sharing choices or request a new invitation.")

    def prepare(enrollment, payload):
        require_consent(enrollment)
        permitted = set(json.loads(enrollment["consent"])["metrics"])
        prepared = []
        previous = None
        for day in payload.days:
            if previous and day.timestamp != previous + timedelta(days=1):
                raise HTTPException(422, "Dates must be in order with one row per consecutive calendar day")
            previous = day.timestamp
            try:
                if day.source != "manual":
                    validate_source(day.source)
                normalized = normalize_daily([r.model_dump() for r in day.readings])
                # Duplicate aliases could otherwise silently replace a member's value.
                if len(normalized) != len(day.readings):
                    raise ValueError("Each signal may appear only once per day")
                if set(normalized) - permitted:
                    raise ValueError("The summary includes signals you have not chosen to share")
                telemetry = telemetry_type(timestamp=day.timestamp, **normalized)
            except (ValueError, TypeError) as error:
                raise HTTPException(422, str(error)) from error
            prepared.append({"timestamp": day.timestamp.isoformat(), "source": day.source,
                             "values": normalized, "missing": [k for k in load_config()["signals"] if k not in normalized],
                             "coverage": len(normalized)/len(load_config()["signals"])})
        with db() as conn:
            expected = next_date(conn, enrollment["patient_id"])
        if expected and prepared[0]["timestamp"] != expected:
            raise HTTPException(409, f"Start with {expected}; existing readings cannot be replaced")
        return prepared

    @app.get("/api/care/config")
    def config():
        return {"synthetic": True, "demo_access": not bool(os.getenv("CARDIOTWIN_CLINICIAN_KEY")),
                "metrics": [{"key": key, "label": SIGNAL_NAMES[key], "unit": spec["unit"], "bounds": spec["bounds"]}
                            for key, spec in load_config()["signals"].items()]}

    @app.post("/api/care/login")
    def login(payload: Login, request: Request, response: Response):
        mutation(request)
        ip = request.client.host if request.client else "local"
        now = time.time()
        attempts[ip] = [t for t in attempts.get(ip, []) if t > now-60]
        if len(attempts[ip]) >= 10:
            raise HTTPException(429, "Too many attempts. Try again in a minute.")
        attempts[ip].append(now)
        expected = os.getenv("CARDIOTWIN_CLINICIAN_KEY") or "demo-clinician"
        if not hmac.compare_digest(payload.access_key.encode(), expected.encode()):
            raise HTTPException(401, "The clinician access key is incorrect")
        set_session(response, "clinician")
        return {"role": "clinician", "synthetic": True}

    @app.post("/api/care/logout")
    def logout(request: Request, response: Response):
        mutation(request)
        with db() as conn:
            for name in (clinician_cookie, member_cookie):
                conn.execute("DELETE FROM care_sessions WHERE token_hash=?", (digest(request.cookies.get(name, "")),))
                response.delete_cookie(name, path="/api/care")
        return {"status": "signed_out"}

    @app.get("/api/care/workspace")
    def workspace(request: Request):
        clinician(request)
        with db() as conn:
            enrollments = [dict(row) for row in conn.execute("SELECT id,patient_id,status,created,expires,consent,consented,revoked FROM care_enrollments ORDER BY created DESC")]
            for row in enrollments:
                row["next_date"] = next_date(conn, row["patient_id"])
                row["consent"] = json.loads(row["consent"]) if row["consent"] else None
                if row["status"] == "invited" and row["expires"] < time.time():
                    row["status"] = "expired"
            submissions = [public_submission(row) for row in conn.execute("SELECT * FROM care_submissions ORDER BY created DESC")]
            events = [dict(row) for row in conn.execute("SELECT * FROM care_audit ORDER BY id DESC LIMIT 100")]
        return {"enrollments": enrollments, "submissions": submissions, "events": events, "synthetic": True}

    @app.post("/api/care/invitations", status_code=201)
    def invite(payload: Invite, request: Request):
        mutation(request); clinician(request)
        if app.state.store.patient(payload.patient_id) is None:
            raise HTTPException(404, "Patient not found")
        token, enrollment_id, now = secrets.token_urlsafe(32), secrets.token_hex(12), time.time()
        with db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute("SELECT id FROM care_enrollments WHERE patient_id=? AND (status IN ('joined','active') OR (status='invited' AND expires>?))", (payload.patient_id, now)).fetchone()
            if existing:
                raise HTTPException(409, "This patient already has an open invitation or active sharing. End it before inviting again.")
            conn.execute("INSERT INTO care_enrollments(id,patient_id,token_hash,status,created,expires) VALUES (?,?,?,'invited',?,?)",
                         (enrollment_id, payload.patient_id, digest(token), now, now+48*3600))
            audit(conn, enrollment_id, "invited")
        return {"id": enrollment_id, "patient_id": payload.patient_id, "token": token, "expires": now+48*3600}

    @app.post("/api/care/member/exchange")
    def exchange(payload: Exchange, request: Request, response: Response):
        mutation(request)
        with db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM care_enrollments WHERE token_hash=? AND status='invited' AND expires>?", (digest(payload.token), time.time())).fetchone()
            if row is None:
                raise HTTPException(410, "This invitation has expired, was already used, or has been ended. Ask for a new invitation.")
            conn.execute("UPDATE care_enrollments SET status='joined' WHERE id=?", (row["id"],))
            audit(conn, row["id"], "invitation_opened")
        set_session(response, "member", row["id"])
        return {"status": "joined"}

    @app.get("/api/care/member")
    def member_home(request: Request):
        enrollment = member(request)
        with db() as conn:
            submissions = [public_submission(row) for row in conn.execute("SELECT * FROM care_submissions WHERE enrollment_id=? ORDER BY created DESC", (enrollment["id"],))]
            expected = next_date(conn, enrollment["patient_id"])
        patient = app.state.store.patient(enrollment["patient_id"])
        return {"patient": {"patient_id": patient["patient_id"], "name": patient["name"]},
                "status": enrollment["status"], "next_date": expected,
                "consent": json.loads(enrollment["consent"]) if enrollment["consent"] else None,
                "submissions": submissions, "synthetic": True}

    @app.post("/api/care/member/consent")
    def consent(payload: Consent, request: Request):
        mutation(request); enrollment = member(request)
        if not payload.acknowledged or set(payload.metrics)-set(load_config()["signals"]):
            raise HTTPException(422, "Choose supported signals and acknowledge how they will be shared")
        if enrollment["status"] != "joined":
            raise HTTPException(409, "Sharing choices have already been recorded; end sharing to withdraw them")
        record = {"metrics": sorted(set(payload.metrics)), "version": "2026-10-20-v1", "purpose": "synthetic remote-monitoring demonstration", "recipient": "CardioTwin demo care team"}
        with db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            changed = conn.execute("UPDATE care_enrollments SET status='active',consent=?,consented=? WHERE id=? AND status='joined'", (json.dumps(record), time.time(), enrollment["id"])).rowcount
            if not changed:
                raise HTTPException(409, "Sharing state changed; refresh the page")
            audit(conn, enrollment["id"], "consent_granted", record)
        return {"status": "active", "consent": record}

    def end_sharing(enrollment_id):
        with db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if not conn.execute("SELECT id FROM care_enrollments WHERE id=?", (enrollment_id,)).fetchone():
                raise HTTPException(404, "Sharing invitation not found")
            conn.execute("UPDATE care_enrollments SET status='revoked',revoked=? WHERE id=?", (time.time(), enrollment_id))
            conn.execute("UPDATE care_submissions SET status='withdrawn' WHERE enrollment_id=? AND status='pending'", (enrollment_id,))
            audit(conn, enrollment_id, "sharing_ended")
        return {"status": "revoked"}

    @app.post("/api/care/member/revoke")
    def revoke(request: Request):
        mutation(request)
        return end_sharing(member(request)["id"])

    @app.post("/api/care/enrollments/{enrollment_id}/revoke")
    def clinician_revoke(enrollment_id: str, request: Request):
        mutation(request); clinician(request)
        return end_sharing(enrollment_id)

    @app.post("/api/care/member/preview")
    def preview(payload: Submission, request: Request):
        mutation(request)
        return {"days": prepare(member(request), payload), "persisted": False}

    @app.post("/api/care/member/submissions")
    def submit(payload: Submission, request: Request):
        mutation(request); enrollment = member(request); require_consent(enrollment)
        # Retries return the prior receipt, even after a clinician accepted that date.
        fingerprint = digest(json.dumps(payload.model_dump(mode="json"), sort_keys=True))
        with db() as conn:
            existing = conn.execute("SELECT * FROM care_submissions WHERE enrollment_id=? AND fingerprint=?", (enrollment["id"], fingerprint)).fetchone()
        if existing:
            return {"submission": public_submission(existing), "duplicate": True}
        days = prepare(enrollment, payload)
        submission_id = secrets.token_hex(12)
        with db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            state = conn.execute("SELECT status FROM care_enrollments WHERE id=?", (enrollment["id"],)).fetchone()
            if state[0] != "active":
                raise HTTPException(403, "Sharing has ended")
            pending = conn.execute("SELECT id FROM care_submissions WHERE enrollment_id=? AND status='pending'", (enrollment["id"],)).fetchone()
            if pending:
                existing = conn.execute("SELECT * FROM care_submissions WHERE enrollment_id=? AND fingerprint=?", (enrollment["id"], fingerprint)).fetchone()
                if existing:
                    return {"submission": public_submission(existing), "duplicate": True}
                raise HTTPException(409, "Your previous summary is awaiting review. Wait for the care team before sending another.")
            conn.execute("INSERT INTO care_submissions(id,enrollment_id,patient_id,fingerprint,status,payload,created) VALUES (?,?,?,?,'pending',?,?)",
                         (submission_id, enrollment["id"], enrollment["patient_id"], fingerprint, json.dumps(days), time.time()))
            audit(conn, enrollment["id"], "submitted", {"submission_id": submission_id, "days": len(days)})
            row = conn.execute("SELECT * FROM care_submissions WHERE id=?", (submission_id,)).fetchone()
        return {"submission": public_submission(row), "duplicate": False}

    @app.post("/api/care/submissions/{submission_id}/review")
    def review(submission_id: str, payload: Review, request: Request):
        mutation(request); clinician(request)
        if payload.decision == "reject" and len(payload.note.strip()) < 3:
            raise HTTPException(422, "Add a short reason so the member can correct the summary")
        with db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM care_submissions WHERE id=?", (submission_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "Submission not found")
            if row["status"] != "pending":
                raise HTTPException(409, "This summary has already been reviewed or withdrawn")
            enrollment = conn.execute("SELECT * FROM care_enrollments WHERE id=?", (row["enrollment_id"],)).fetchone()
            if enrollment["status"] != "active":
                raise HTTPException(409, "The member has ended sharing")
            days = json.loads(row["payload"])
            if payload.decision == "accept":
                expected = next_date(conn, row["patient_id"])
                if expected and days[0]["timestamp"] != expected:
                    raise HTTPException(409, f"The patient ledger has moved on. Next date is {expected}; reject this summary and ask the member to resend.")
                last_day = conn.execute("SELECT COALESCE(MAX(day),0) FROM telemetry WHERE patient_id=?", (row["patient_id"],)).fetchone()[0]
                for index, day in enumerate(days, start=1):
                    observation = telemetry_type(timestamp=day["timestamp"], **day["values"]).model_dump(mode="json")
                    observation.update(patient_id=row["patient_id"], day=last_day+index, source=day["source"], submission_id=submission_id)
                    conn.execute("INSERT INTO telemetry VALUES (?,?,?)", (row["patient_id"], last_day+index, json.dumps(observation)))
            status = "accepted" if payload.decision == "accept" else "rejected"
            conn.execute("UPDATE care_submissions SET status=?,reviewed=?,review_note=? WHERE id=?", (status, time.time(), payload.note.strip(), submission_id))
            audit(conn, row["enrollment_id"], status, {"submission_id": submission_id})
        app.state.cache.clear()
        return {"status": status, "patient_id": row["patient_id"], "days": len(days)}
