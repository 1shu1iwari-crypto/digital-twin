export type CanonicalMetric =
  | 'heart_rate'
  | 'heart_rate_variability'
  | 'respiratory_rate'
  | 'oxygen_saturation'
  | 'steps'
  | 'body_weight'
  | 'systolic_bp'
  | 'diastolic_bp'
  | 'sleep_minutes'

export type DailyReading = {
  metric: CanonicalMetric
  value: number
  unit?: string
}

export type DailySummary = {
  source: 'apple_health' | 'health_connect' | 'samsung_health' | 'google_health' | 'garmin' | 'oura'
  timestamp: string
  readings: DailyReading[]
}

export interface HealthAdapter {
  source: DailySummary['source']
  requestPermissions(): Promise<boolean>
  readDailySummary(day: string): Promise<DailySummary>
}

export async function syncDailySummary(
  apiBase: string,
  patientId: string,
  adapter: HealthAdapter,
  day: string,
) {
  const allowed = await adapter.requestPermissions()
  if (!allowed) throw new Error('Health data permission was not granted')

  const summary = await adapter.readDailySummary(day)
  const response = await fetch(
    `${apiBase}/api/patients/${encodeURIComponent(patientId)}/wearables/ingest`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(summary),
    },
  )
  const body = await response.json()
  if (!response.ok) throw new Error(body.detail || 'Wearable sync failed')
  return body
}
