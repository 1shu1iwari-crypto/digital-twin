# Wearable integration architecture

CardioTwin now treats the phone as the primary health-data gateway instead of integrating every watch directly into the web dashboard.

```text
Apple Watch -> Apple Health -> HealthKit ----┐
                                             |
Galaxy Watch -> Samsung Health -> Health Connect --┐
                                                   |
Pixel / Android apps -> Health Connect ------------+--> React Native companion
                                                   |        |
Fitbit / Pixel cloud -> Google Health API ---------┘        | consented daily summary
                                                            v
                                                     FastAPI ingestion
                                                            |
                                                     normalization layer
                                                            |
                                                existing telemetry contract
                                                            |
                                                   feature generation
                                                            |
                                                     XGBoost twin
```

## Why this boundary

The browser cannot request HealthKit or Health Connect permissions. Those permissions must be granted through native mobile APIs. The web experience therefore explains and displays connection state, while a React Native companion owns consent, reads authorized records, aggregates them into daily summaries, and calls the wearable ingestion endpoint.

This keeps the existing model semantics stable: all device adapters eventually produce the same canonical daily signals.

## Current API

- `GET /api/wearables/sources` returns the supported gateway catalog.
- `POST /api/patients/{patient_id}/wearables/preview` validates the same daily payload without persisting it. Returns canonical values and units, missing metrics, supplied-signal coverage, patient/date/day, and `persisted: false`.
- `POST /api/patients/{patient_id}/wearables/ingest` accepts one daily summary.
- Provider credentials and OAuth refresh tokens are deliberately outside the prototype database.
- High-frequency ECG/PPG/accelerometer streams should not be posted directly to this endpoint. Aggregate them on-device or through a dedicated stream processor first.

Example:

```json
{
  "source": "apple_health",
  "timestamp": "2026-10-06",
  "readings": [
    {"metric": "heart_rate", "value": 72, "unit": "bpm"},
    {"metric": "heart_rate_variability", "value": 38, "unit": "ms"},
    {"metric": "sleep_minutes", "value": 438, "unit": "min"},
    {"metric": "steps", "value": 6432, "unit": "steps"}
  ]
}
```

## Dashboard import

Open Wearables, select a fictional patient, and choose **Load fictional example**. The example uses the patient's next calendar date and nine explicitly fictional measurements; it does not copy or simulate a device connection. Edit the JSON as needed, then choose **Preview summary** to inspect normalized values. Only **Save summary & update twin** writes to the daily ledger and refreshes the patient data.

Editing the summary or changing patients invalidates the preview. Both preview and save validate the source, signals, units, bounds, and next-day timestamp. Save validates again so a replay or another append after preview produces a date conflict instead of replacing a reading. Opening Wearables pauses automatic replay. Duplicate saves return 409; they never overwrite the ledger. Missing metrics remain missing and inference may abstain. The source identifier is retained with the daily observation.

Supported units are bpm for pulse, ms for HRV, /min or breaths/min for respiration, steps, kg or lb/lbs/pound/pounds for weight, mmHg for pressure, and h/hours or min/minute/minutes for sleep. Oxygen accepts percent (`%`) or explicit `ratio`/`fraction` values between 0 and 1. Omitted units retain the gateway's defaults, including fraction detection for oxygen and minutes for `sleep_minutes`. Explicit unsupported units are rejected instead of being interpreted as canonical values. Multiple aliases for the same signal retain the existing last-value-wins rule.

The import is a local synthetic-data testing workflow. Native permissions, provider authentication, and actual device synchronization still require the mobile companion.

## Storage path

The hackathon demo intentionally keeps SQLite for reproducibility. The production-shaped path is:

```text
FastAPI
  |
  +-- PostgreSQL + TimescaleDB      normalized timestamped measurements
  +-- S3 / Cloud Storage + Parquet raw/history archive
  +-- Redis                         cache and background job coordination
  +-- FHIR adapter                  Observation / Patient / Device exchange
```

The adapter contract is independent of persistence, so moving the ledger from SQLite to TimescaleDB does not require changing wearable providers or the ML feature contract.

## Mobile companion contract

A React Native + TypeScript companion should implement:

1. HealthKit adapter on iOS.
2. Health Connect adapter on Android; Samsung Health can share supported records into Health Connect.
3. Google Health provider adapter for cloud-backed Fitbit/Pixel flows.
4. Optional Garmin and Oura OAuth adapters.
5. Local aggregation and deduplication.
6. Explicit per-metric consent and a visible last-sync state.
7. Upload only the fields required by the CardioTwin feature contract.

Do not describe the prototype as clinically validated merely because real wearable data can be connected. Model validation and data-source integration are separate concerns.
