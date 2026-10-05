"""Wearable source catalog and normalization helpers.

Native permissions stay on the phone. This module accepts already-consented daily
summaries from HealthKit / Health Connect / provider APIs and translates them into
CardioTwin's existing signal names. It intentionally stores no OAuth tokens or raw
high-frequency sensor streams.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date, datetime
from typing import Iterable


@dataclass(frozen=True)
class WearableSource:
    id: str
    label: str
    platform: str
    gateway: str
    mode: str
    description: str
    metrics: tuple[str, ...]

    def public(self) -> dict:
        value = asdict(self)
        value["metrics"] = list(self.metrics)
        return value


SOURCES: tuple[WearableSource, ...] = (
    WearableSource(
        "apple_health",
        "Apple Health",
        "iPhone + Apple Watch",
        "HealthKit",
        "native",
        "The iPhone companion app reads approved HealthKit types and sends daily summaries to CardioTwin.",
        ("heart rate", "HRV", "SpO₂", "sleep", "steps", "workouts", "weight"),
    ),
    WearableSource(
        "health_connect",
        "Health Connect",
        "Android",
        "Android Health Connect",
        "native",
        "The Android companion app requests per-record permissions once and syncs supported fitness data.",
        ("heart rate", "HRV", "SpO₂", "sleep", "steps", "weight", "blood pressure"),
    ),
    WearableSource(
        "samsung_health",
        "Samsung Health",
        "Galaxy Watch / Galaxy phone",
        "Health Connect",
        "bridge",
        "Samsung Health data flows through Health Connect when the member enables sharing.",
        ("heart rate", "sleep", "steps", "SpO₂", "workouts"),
    ),
    WearableSource(
        "google_health",
        "Google Health",
        "Pixel / Fitbit cloud",
        "Google Health API",
        "oauth",
        "Cloud sync path for Google wearable data; authorization belongs in the mobile companion flow.",
        ("heart rate", "HRV", "sleep", "steps", "SpO₂", "activity"),
    ),
    WearableSource(
        "garmin",
        "Garmin",
        "Garmin wearables",
        "Garmin Health API / SDK",
        "oauth",
        "Optional provider adapter for approved Garmin Health integrations.",
        ("heart rate", "HRV", "sleep", "steps", "SpO₂", "respiration"),
    ),
    WearableSource(
        "oura",
        "Oura",
        "Oura Ring",
        "Oura API v2",
        "oauth",
        "Optional provider adapter for sleep, readiness and longitudinal cardiovascular signals.",
        ("heart rate", "HRV", "sleep", "SpO₂", "temperature", "activity"),
    ),
)

_SOURCE_IDS = {source.id for source in SOURCES}

ALIASES = {
    "heart_rate": "resting_hr",
    "resting_heart_rate": "resting_hr",
    "resting_hr": "resting_hr",
    "hr": "resting_hr",
    "heart_rate_variability": "hrv",
    "hrv": "hrv",
    "respiration": "respiratory_rate",
    "respiratory_rate": "respiratory_rate",
    "oxygen_saturation": "spo2",
    "blood_oxygen": "spo2",
    "spo2": "spo2",
    "steps": "steps",
    "step_count": "steps",
    "weight": "weight",
    "body_weight": "weight",
    "systolic": "systolic_bp",
    "systolic_bp": "systolic_bp",
    "diastolic": "diastolic_bp",
    "diastolic_bp": "diastolic_bp",
    "sleep": "sleep_hours",
    "sleep_hours": "sleep_hours",
    "sleep_minutes": "sleep_hours",
}

CANONICAL_UNITS = {
    "resting_hr": "bpm",
    "hrv": "ms",
    "respiratory_rate": "/min",
    "spo2": "%",
    "steps": "steps",
    "weight": "kg",
    "systolic_bp": "mmHg",
    "diastolic_bp": "mmHg",
    "sleep_hours": "h",
}


def source_catalog() -> list[dict]:
    return [source.public() for source in SOURCES]


def validate_source(source: str) -> str:
    if source not in _SOURCE_IDS:
        raise ValueError(f"Unsupported wearable source: {source}")
    return source


def normalize_metric(metric: str, value: float, unit: str | None = None) -> tuple[str, float]:
    """Normalize one provider metric into the daily CardioTwin signal contract."""
    key = ALIASES.get(metric.strip().lower())
    if key is None:
        raise ValueError(f"Unsupported wearable metric: {metric}")

    normalized = float(value)
    normalized_unit = (unit or "").strip().lower()

    if metric.strip().lower() == "sleep_minutes" or (key == "sleep_hours" and normalized_unit in {"min", "minute", "minutes"}):
        normalized /= 60.0
    elif key == "weight" and normalized_unit in {"lb", "lbs", "pound", "pounds"}:
        normalized *= 0.45359237
    elif key == "spo2" and 0 <= normalized <= 1 and normalized_unit in {"ratio", "fraction", ""}:
        normalized *= 100.0

    return key, round(normalized, 4)


def normalize_daily(readings: Iterable[dict]) -> dict[str, float]:
    """Normalize a daily summary payload.

    Multiple values for the same metric are allowed; the latest supplied value wins.
    High-frequency raw streams should be aggregated on-device or in a dedicated
    ingestion worker before reaching this endpoint.
    """
    result: dict[str, float] = {}
    for reading in readings:
        key, value = normalize_metric(
            str(reading.get("metric", "")),
            float(reading["value"]),
            reading.get("unit"),
        )
        result[key] = value
    if not result:
        raise ValueError("At least one supported wearable reading is required")
    return result


def iso_day(value: date | datetime | str) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)[:10]
