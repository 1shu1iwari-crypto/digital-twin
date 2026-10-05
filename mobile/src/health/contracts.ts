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
  sourceMetric?: string
}

export type DailySummary = {
  source: 'apple_health' | 'health_connect'
  timestamp: string
  readings: DailyReading[]
}

export type HealthAvailability = {
  available: boolean
  label: string
  detail: string
  action?: 'install' | 'settings'
}

export type PermissionResult = {
  requested: boolean
  detail: string
}

export interface HealthAdapter {
  source: DailySummary['source']
  displayName: string
  hrvLabel: string
  checkAvailability(): Promise<HealthAvailability>
  requestPermissions(): Promise<PermissionResult>
  readDailySummary(day: string): Promise<DailySummary>
  openSettings(): Promise<void>
}
