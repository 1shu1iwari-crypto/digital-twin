# CardioTwin mobile companion

This folder defines the thin React Native + TypeScript boundary for real wearable sync. It is intentionally not a second copy of the dashboard.

The companion has four responsibilities:

1. request native permissions on-device;
2. read only the health record types the member approved;
3. aggregate/deduplicate those records into a daily summary;
4. upload the summary to `POST /api/patients/{patient_id}/wearables/ingest`.

Provider-specific native modules should implement the `HealthAdapter` contract in `src/health/contracts.ts`.

Recommended adapters:

- iOS: Apple HealthKit
- Android: Health Connect
- Samsung: share Samsung Health records into Health Connect, then use the same Android adapter
- Fitbit / Pixel cloud: Google Health provider adapter
- optional: Garmin Health and Oura OAuth adapters

Do not put the ML model in the mobile app for this prototype. Keep model inference behind the existing FastAPI boundary so mobile and web clients share one validated feature contract.
