# CardioTwin mobile companion

This folder defines the thin React Native + TypeScript boundary for real wearable sync. It is intentionally not a second copy of the dashboard.

The companion has four responsibilities:

1. request native permissions on-device;
2. read only the health record types the member approved;
3. aggregate/deduplicate those records into a daily summary;
4. upload the summary to `POST /api/care/member/submissions` using the member session and `X-CardioTwin-Action: 1`. The phone's device permission and the portal's sharing choices are both required. Review precedes the ledger update.

Provider-specific native modules should implement the `HealthAdapter` contract in `src/health/contracts.ts`.

Recommended adapters:

- iOS: Apple HealthKit
- Android: Health Connect
- Samsung: share Samsung Health records into Health Connect, then use the same Android adapter
- Fitbit / Pixel cloud: Google Health provider adapter
- optional: Garmin Health and Oura OAuth adapters

Do not put the ML model in the mobile app for this prototype. Keep model inference behind the existing FastAPI boundary so mobile and web clients share one validated feature contract.

The member session is established by the one-time invitation exchange. The server derives the patient association from that session; the companion must never send an arbitrary patient identifier. `syncDailySummary` now queues `{days: [summary]}` for clinician review instead of writing directly to telemetry. It needs an active sharing record and a same-service cookie session. It remains a contract, not a runnable native app: device modules, platform entitlements, verified identity enrollment, encrypted token storage and background sync workers are still to be implemented and tested on devices.

Use a provider's resting-heart-rate value for `resting_heart_rate`, not an arbitrary pulse sample or all-day mean. Define source timezone, HRV measurement semantics and daily aggregation explicitly before connecting any real provider. The current research model has only been evaluated on synthetic signals.
