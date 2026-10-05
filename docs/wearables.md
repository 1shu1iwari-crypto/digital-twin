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
