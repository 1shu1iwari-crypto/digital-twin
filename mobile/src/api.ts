import type { DailySummary } from './health/contracts'

export type MobilePatient = {
  patient_id: string
  name: string
  age: number
  sex: string
  hf_type: string
  status: string
  risk: number | null
  timestamp: string
  coverage: number
}

export type TwinResponse = {
  patient: MobilePatient
  twin: {
    patient_id: string
    timestamp: string
    status: string
    risk: { probability: number } | null
    quality: { coverage: number; baseline_ready: boolean; today_coverage: number }
    signals: Array<{key: string; label: string; value: number | null; unit: string}>
  }
}

function cleanBase(base: string) {
  return base.trim().replace(/\/+$/, '')
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${cleanBase(base)}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status})`
    throw new Error(detail)
  }
  return body as T
}

export async function checkServer(base: string) {
  return request<{status: string; model_loaded: boolean}>(base, '/api/health')
}

export async function getPatient(base: string, patientId: string) {
  return request<TwinResponse>(base, `/api/patients/${encodeURIComponent(patientId)}`)
}

export async function uploadSummary(base: string, patientId: string, summary: DailySummary) {
  return request<{
    source: string
    normalized: Record<string, number>
    twin: TwinResponse['twin']
    privacy: string
  }>(base, `/api/patients/${encodeURIComponent(patientId)}/wearables/ingest`, {
    method: 'POST',
    body: JSON.stringify({
      source: summary.source,
      timestamp: summary.timestamp,
      readings: summary.readings.map(({metric, value, unit}) => ({
        metric,
        value,
        unit,
      })),
    }),
  })
}

export function nextCalendarDay(day: string) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
