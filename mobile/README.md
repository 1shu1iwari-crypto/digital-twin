# CardioTwin mobile companion

An installable Expo / React Native companion for the CardioTwin wearable gateway.

## Implemented

- **iOS HealthKit** authorization and reads for resting heart rate, HRV (SDNN), respiratory rate, SpO₂, steps, body mass, blood pressure and sleep.
- **Android Health Connect** authorization and reads for resting heart rate (with daily heart-rate fallback), HRV (RMSSD), respiratory rate, SpO₂, steps, weight, blood pressure and sleep.
- On-device daily aggregation with a **review-before-upload** screen.
- Sync to `POST /api/patients/{patient_id}/wearables/ingest`.
- Persistent API URL / patient ID configuration.
- Native health-settings handoff and availability states.
- EAS development / preview profiles; the Android preview profile produces an **APK**.

The companion does not cache raw health records. It reads one requested day into memory, produces a small daily summary, lets the user review it, and uploads only that summary.

## Install

From `mobile/`:

```bash
npm install
npx expo prebuild
```

This app contains native modules and **will not work in Expo Go**.

## Android

Health Connect requires Android 8 / API 26 or newer. Android 14+ includes Health Connect in the system; Android 8–13 requires the Health Connect provider app.

Run on a USB-connected development phone:

```bash
npm run android
```

Or create an installable APK:

```bash
npm install -g eas-cli
eas login
eas build --profile preview --platform android
```

## iPhone

For local Xcode development on macOS:

```bash
npm run ios
```

For a physical-device EAS build:

```bash
eas login
eas build --profile development --platform ios
```

A physical iPhone build requires Apple signing / an Apple Developer account.

## Connect a phone to the FastAPI backend

On a physical phone, `localhost` points to the phone itself.

1. Put phone and computer on the same Wi-Fi.
2. Find the computer's LAN IP, e.g. `192.168.1.23`.
3. Run:

```bash
python -m uvicorn cardiotwin.api:app --host 0.0.0.0 --port 8000
```

4. In Companion Settings enter:

```text
http://192.168.1.23:8000
```

5. Use the development/preview EAS profile for local HTTP. Production builds disable cleartext HTTP and should use HTTPS.

## Sync semantics

The existing CardioTwin ledger accepts exactly the next calendar day. The companion reads the patient's current twin timestamp and selects the next expected date automatically, preserving the current causal feature pipeline.

For a fresh real-world enrollment, create/link a patient whose ledger date matches the period you intend to sync.

## HRV caveat

Apple HealthKit widely exposes `HeartRateVariabilitySDNN`, while Health Connect exposes `HeartRateVariabilityRmssd`. The companion shows this provenance in the preview. The current research model still receives one generic `hrv` feature, so cross-platform HRV should be harmonized or modeled separately before any validated study.

## Platform permissions

### iOS

HealthKit read permission status is intentionally private: the system does not tell apps whether the user denied a read category. Missing values can therefore mean either no data or no read permission.

### Android

The app requests read permission for heart rate, resting heart rate, HRV, respiration, oxygen saturation, steps, weight, blood pressure and sleep.

Google Play distribution requires the corresponding Health Connect data-access declaration in Play Console.

## Verify

```bash
npm run typecheck
npm run doctor
```
