from contextlib import asynccontextmanager
from datetime import date, timedelta
import json
import os
import sqlite3
from pathlib import Path
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .config import ARTIFACTS, ROOT, load_config
from .model import RiskModel
from .store import Store
from .twin import snapshot
from .wearables import normalize_daily, source_catalog, validate_source

class Telemetry(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    timestamp: date
    resting_hr: float | None = Field(None, ge=35, le=160)
    hrv: float | None = Field(None, ge=5, le=140)
    respiratory_rate: float | None = Field(None, ge=8, le=40)
    spo2: float | None = Field(None, ge=80, le=100)
    steps: float | None = Field(None, ge=100, le=20000)
    weight: float | None = Field(None, ge=35, le=160)
    systolic_bp: float | None = Field(None, ge=70, le=210)
    diastolic_bp: float | None = Field(None, ge=40, le=130)
    sleep_hours: float | None = Field(None, ge=2, le=12)

    @model_validator(mode="after")
    def some_signal(self):
        if all(getattr(self, key) is None for key in load_config()["signals"]):
            raise ValueError("At least one sensor reading is required")
        return self

class WearableReading(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    metric: str = Field(min_length=1, max_length=80)
    value: float
    unit: str | None = Field(None, max_length=30)

class WearableBatch(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    source: str = Field(min_length=1, max_length=40)
    timestamp: date
    readings: list[WearableReading] = Field(min_length=1, max_length=32)

class Scenario(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    weight_delta: float = Field(0, ge=-3, le=5)
    heart_rate_delta: float = Field(0, ge=-15, le=25)
    respiratory_rate_delta: float = Field(0, ge=-3, le=8)
    activity_percent: float = Field(0, ge=-80, le=50)

class Patient(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    patient_id: str = Field(pattern=r"^HF-[A-Za-z0-9-]{1,20}$")
    name: str = Field(min_length=1, max_length=80)
    age: int = Field(ge=18, le=100)
    sex: str = Field(pattern="^(Female|Male|Other)$")
    lvef: float = Field(ge=10, le=80)
    nyha: int = Field(ge=1, le=4)
    creatinine: float = Field(ge=.3, le=10)
    egfr: float = Field(ge=5, le=150)
    sodium: float = Field(ge=110, le=160)
    hemoglobin: float = Field(ge=5, le=20)
    previous_admissions: int = Field(ge=0, le=20)
    diabetes: int = Field(ge=0, le=1)
    ckd: int = Field(ge=0, le=1)
    copd: int = Field(ge=0, le=1)

def create_app(db_path=None, model_dir=ARTIFACTS):
    @asynccontextmanager
    async def lifespan(app):
        app.state.store = Store(db_path or os.environ.get("CARDIOTWIN_DB"))
        try:
            app.state.model = RiskModel(model_dir)
        except FileNotFoundError as error:
            raise RuntimeError("Train the model first: python -m scripts.train_model") from error
        app.state.cache = {}
        yield

    app = FastAPI(title="CardioTwin-HF", version="0.1.0", lifespan=lifespan,
                  description="Synthetic-data research demonstration. No clinical validation or treatment recommendations.")
    origins = os.environ.get("CARDIOTWIN_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    def get_patient(pid):
        patient = app.state.store.patient(pid)
        if patient is None:
            raise HTTPException(404, "Patient not found")
        return patient

    def get_twin(pid):
        patient = get_patient(pid)
        history = app.state.store.history(pid)
        key = (pid, int(history.day.max()) if len(history) else 0)
        if key not in app.state.cache:
            app.state.cache[key] = snapshot(patient, history, app.state.model)
        return app.state.cache[key]

    @app.get("/api/health")
    def health():
        return dict(status="ok", model_loaded=True, synthetic=True)

    @app.get("/api/wearables/sources")
    def wearable_sources():
        return dict(
            sources=source_catalog(),
            architecture="phone/provider -> normalization -> daily telemetry -> twin",
            note="Native HealthKit and Health Connect permission prompts belong in the mobile companion app."
        )

    @app.get("/api/patients")
    def patients():
        records = []
        for patient in app.state.store.patients():
            twin = get_twin(patient["patient_id"])
            records.append({**patient, "risk": twin["risk"]["probability"] if twin["risk"] else None,
                            "status": twin["status"], "coverage": twin["quality"]["coverage"], "timestamp": twin["timestamp"], "last_day": twin["last_day"]})
        records.sort(key=lambda p: p["risk"] if p["risk"] is not None else -1, reverse=True)
        return dict(patients=records, replay_day=app.state.store.replay_day(), synthetic=True)

    @app.post("/api/patients", status_code=201)
    def add_patient(payload: Patient):
        patient = payload.model_dump()
        patient.update(synthetic=True, hf_type="HFrEF" if patient["lvef"] <= 40 else "HFmrEF" if patient["lvef"] < 50 else "HFpEF")
        try:
            app.state.store.add_patient(patient)
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Patient identifier already exists")
        return patient

    @app.get("/api/patients/{pid}")
    def detail(pid: str):
        return dict(patient=get_patient(pid), twin=get_twin(pid))

    @app.get("/api/patients/{pid}/twin")
    def twin(pid: str):
        return get_twin(pid)

    @app.get("/api/patients/{pid}/risk")
    def risk(pid: str):
        return get_twin(pid)["risk"]

    @app.get("/api/patients/{pid}/explanation")
    def explanation(pid: str):
        risk = get_twin(pid)["risk"]
        return risk["explanation"] if risk else dict(method=None, contributions=[], note="Insufficient data")

    @app.get("/api/patients/{pid}/timeline")
    def timeline(pid: str, days: int = Query(21, ge=1, le=90)):
        patient = get_patient(pid)
        history = app.state.store.history(pid)
        rows = []
        for row in history.tail(days).to_dict("records"):
            key = (pid, int(row["day"]))
            if key not in app.state.cache:
                app.state.cache[key] = snapshot(patient, history, app.state.model, int(row["day"]))
            state = app.state.cache[key]
            clean = {k: None if isinstance(v, float) and not np.isfinite(v) else v for k,v in row.items()}
            rows.append({**clean, "risk": state["risk"]["probability"] if state["risk"] else None})
        return dict(observations=rows, synthetic=True)

    @app.post("/api/patients/{pid}/telemetry", status_code=201)
    def telemetry(pid: str, payload: Telemetry):
        get_patient(pid)
        history = app.state.store.history(pid)
        if len(history) and payload.timestamp != date.fromisoformat(str(history.iloc[-1].timestamp))+timedelta(days=1):
            raise HTTPException(409, "Timestamp must be the next calendar day; gaps should be sent as partial observations")
        observation = payload.model_dump(mode="json")
        observation.update(patient_id=pid, day=int(history.day.max())+1 if len(history) else 1)
        try:
            app.state.store.append(pid, observation)
        except ValueError as error:
            raise HTTPException(409, str(error))
        return get_twin(pid)

    @app.post("/api/patients/{pid}/wearables/ingest", status_code=201)
    def wearable_ingest(pid: str, payload: WearableBatch):
        """Accept one consented daily summary from a supported wearable gateway.

        Raw OAuth tokens and high-frequency streams are intentionally not persisted here.
        The existing telemetry contract remains the single path into feature generation
        and inference, so device integrations cannot silently change model semantics.
        """
        get_patient(pid)
        try:
            source = validate_source(payload.source)
            normalized = normalize_daily([reading.model_dump() for reading in payload.readings])
        except (ValueError, TypeError) as error:
            raise HTTPException(422, str(error)) from error

        try:
            telemetry_payload = Telemetry(timestamp=payload.timestamp, **normalized)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error

        history = app.state.store.history(pid)
        if len(history) and telemetry_payload.timestamp != date.fromisoformat(str(history.iloc[-1].timestamp)) + timedelta(days=1):
            raise HTTPException(409, "Wearable sync must append the next calendar day; aggregate gaps as partial daily observations")

        observation = telemetry_payload.model_dump(mode="json")
        observation.update(
            patient_id=pid,
            day=int(history.day.max()) + 1 if len(history) else 1,
            source=source,
        )
        try:
            app.state.store.append(pid, observation)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

        app.state.cache.clear()
        return dict(
            source=source,
            normalized=normalized,
            twin=get_twin(pid),
            privacy="consented daily summary only; provider credentials are not stored by this prototype",
        )

    @app.post("/api/patients/{pid}/simulate")
    def simulate(pid: str, payload: Scenario):
        patient = get_patient(pid)
        history = app.state.store.history(pid).copy(deep=True)
        current = get_twin(pid)
        if not current["risk"]:
            raise HTTPException(422, "Scenario simulation requires a complete personal baseline and sufficient data")
        changes = {"weight": payload.weight_delta, "resting_hr": payload.heart_rate_delta, "respiratory_rate": payload.respiratory_rate_delta}
        for signal, delta in changes.items():
            if pd.isna(history.iloc[-1][signal]) and delta:
                raise HTTPException(422, f"The latest {signal} reading is missing")
            if pd.notna(history.iloc[-1][signal]):
                history.loc[history.index[-1], signal] += delta
        if pd.isna(history.iloc[-1].steps) and payload.activity_percent:
            raise HTTPException(422, "The latest activity reading is missing")
        history.loc[history.index[-1], "steps"] *= 1 + payload.activity_percent / 100
        for signal, spec in load_config()["signals"].items():
            value = history.iloc[-1][signal]
            if pd.notna(value) and not spec["bounds"][0] <= value <= spec["bounds"][1]:
                raise HTTPException(422, f"Scenario exceeds supported {signal} input range")
        simulated = snapshot(patient, history, app.state.model)
        return dict(current=current, simulated=simulated, persisted=False,
                    note="One-day physiological perturbation; no causal treatment effect is estimated")

    @app.post("/api/demo/advance")
    def advance():
        result = app.state.store.advance()
        app.state.cache.clear()
        return result

    @app.post("/api/demo/reset")
    def reset():
        app.state.store.seed()
        app.state.cache.clear()
        return dict(status="reset", day=35)

    @app.get("/api/evaluation")
    def evaluation():
        return json.loads((Path(model_dir)/"evaluation.json").read_text())

    dist = ROOT / "frontend/dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="dashboard")
    return app

app = create_app()
