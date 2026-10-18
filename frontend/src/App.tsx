import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import {
  Activity, ArrowDownToLine, ArrowRight, Bell, Check, ChevronRight, Clock3,
  FlaskConical, Info, Pause, Play, Plus, RotateCcw, Search, ShieldCheck,
  SlidersHorizontal, StepForward, Users, Wifi, X, Printer, Copy,
  Warning, UploadSimple
} from './icons'
import type { Evaluation, Observation, Patient, Twin, Review, TelemetryBatchSummary } from './types'
import {
  Badge, Contributions, HeartVisual, Loading, Logo, percent, riskClass,
  TrendChart, TwinIndices, ReviewBadge, PrintableSummary
} from './components'

async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    signal,
    ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(typeof result.detail === 'string' ? result.detail : 'Please check the supported input ranges and date.')
  }
  return result as T
}

const scenarioDefaults = { weight_delta: 0, heart_rate_delta: 0, respiratory_rate_delta: 0, activity_percent: 0 }
const sliderSpecs = [
  { key: 'weight_delta', label: 'Weight change', min: -3, max: 5, step: .1, unit: 'kg' },
  { key: 'heart_rate_delta', label: 'Resting heart rate', min: -15, max: 25, step: 1, unit: 'bpm' },
  { key: 'respiratory_rate_delta', label: 'Respiratory rate', min: -3, max: 8, step: .5, unit: '/min' },
  { key: 'activity_percent', label: 'Daily activity', min: -80, max: 50, step: 5, unit: '%' }
] as const

const SIGNAL_BOUNDS: Record<string, { label: string; unit: string; min: number; max: number; placeholder: string }> = {
  resting_hr: { label: 'Resting heart rate', unit: 'bpm', min: 35, max: 160, placeholder: '35–160' },
  hrv: { label: 'Heart rate variability', unit: 'ms', min: 5, max: 140, placeholder: '5–140' },
  respiratory_rate: { label: 'Respiratory rate', unit: '/min', min: 8, max: 40, placeholder: '8–40' },
  spo2: { label: 'Oxygen saturation', unit: '%', min: 80, max: 100, placeholder: '80–100' },
  steps: { label: 'Daily steps', unit: 'steps', min: 100, max: 20000, placeholder: '100–20000' },
  weight: { label: 'Body weight', unit: 'kg', min: 35, max: 160, placeholder: '35–160' },
  systolic_bp: { label: 'Systolic blood pressure', unit: 'mmHg', min: 70, max: 210, placeholder: '70–210' },
  diastolic_bp: { label: 'Diastolic blood pressure', unit: 'mmHg', min: 40, max: 130, placeholder: '40–130' },
  sleep_hours: { label: 'Sleep duration', unit: 'hours', min: 2, max: 12, placeholder: '2–12' }
}

export type PageRoute = 'overview' | 'patients' | 'connections' | 'evidence' | 'research' | 'demo'

export default function App() {
  // Navigation: state + synchronized with URL Hash
  const [route, setRoute] = useState<PageRoute>('overview')
  const [patients, setPatients] = useState<Patient[]>([])
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState<{ patient: Patient; twin: Twin; review?: Review } | null>(null)
  const [rows, setRows] = useState<Observation[]>([])
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [day, setDay] = useState(35)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All patients')
  const [signal, setSignal] = useState('risk')
  const [tab, setTab] = useState<'Overview' | 'Explainability' | 'EHR profile' | 'Data timeline'>('Overview')
  const [modal, setModal] = useState<'scenario' | 'telemetry' | 'reset' | null>(null)
  const [showPrintModal, setShowPrintModal] = useState(false)

  // Scenario Sandbox State
  const [scenario, setScenario] = useState({ ...scenarioDefaults })
  const [simulated, setSimulated] = useState<Twin | null>(null)

  // Telemetry Entry State (P1 Honesty: starts blank, explicit copy)
  const [telemetry, setTelemetry] = useState<Record<string, string>>({})
  const [telemetryCopiedNotice, setTelemetryCopiedNotice] = useState(false)
  const [telemetryFieldError, setTelemetryFieldError] = useState<Record<string, string>>({})

  // Review Ledger State
  const [review, setReview] = useState<Review>({ patient_id: '', day: 0, state: 'unreviewed', note: '', updated_at: null })
  const [noteDraft, setNoteDraft] = useState('')
  const [revision, setRevision] = useState(0)

  // Connections / Wearable Ingestion State
  const [ingestTargetPid, setIngestTargetPid] = useState('')
  const [presetIndex, setPresetIndex] = useState(0)
  const [batchJsonDraft, setBatchJsonDraft] = useState('')
  const [batchResult, setBatchResult] = useState<TelemetryBatchSummary | null>(null)

  const actionLock = useRef(false)

  // Sync route from URL hash
  const syncFromHash = useCallback(() => {
    const hash = window.location.hash.replace(/^#\/?/, '')
    const parts = hash.split('/')
    const base = parts[0] || 'overview'

    if (base === 'patients' && parts[1]) {
      setRoute('patients')
      setSelected(parts[1])
    } else if (['overview', 'patients', 'connections', 'evidence', 'research', 'demo'].includes(base)) {
      setRoute(base as PageRoute)
    } else {
      setRoute('overview')
    }
  }, [])

  useEffect(() => {
    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [syncFromHash])

  const navigateTo = (newRoute: PageRoute, pid?: string) => {
    setRoute(newRoute)
    if (newRoute === 'patients' && pid) {
      setSelected(pid)
      window.location.hash = `#/patients/${pid}`
    } else {
      window.location.hash = `#/${newRoute}`
    }
  }

  // Load population
  const loadPopulation = useCallback(async () => {
    const result = await api<{ patients: Patient[]; replay_day: number }>('/patients')
    setPatients(result.patients)
    setDay(result.replay_day)
    setSelected(old => old || result.patients[0]?.patient_id || '')
    setIngestTargetPid(old => old || result.patients[0]?.patient_id || '')
    setRevision(r => r + 1)
  }, [])

  useEffect(() => {
    loadPopulation()
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))

    api<Evaluation>('/evaluation')
      .then(setEvaluation)
      .catch(e => setError(e.message))
  }, [loadPopulation])

  // Load selected patient detail & timeline
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    setSimulated(null)
    Promise.all([
      api<{ patient: Patient; twin: Twin; review?: Review }>(`/patients/${selected}`, undefined, controller.signal),
      api<{ observations: Observation[] }>(`/patients/${selected}/timeline`, undefined, controller.signal)
    ]).then(([res, timeline]) => {
      setDetail(res)
      setRows(timeline.observations)
      if (res.review) {
        setReview(res.review)
        setNoteDraft(res.review.note || '')
      } else {
        setReview({ patient_id: selected, day, state: 'unreviewed', note: '', updated_at: null })
        setNoteDraft('')
      }
    }).catch(e => {
      if (e.name !== 'AbortError') setError(e.message)
    })
    return () => controller.abort()
  }, [selected, revision, day])

  // Save review note to SQLite
  const saveReview = async (newState?: string) => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const s = newState || review.state
      const updated = await api<Review>(`/patients/${selected}/review`, { state: s, note: noteDraft })
      setReview(updated)
      setNotice(`Review updated: ${s.replace('_', ' ')}`)
      await loadPopulation()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  // Dialog keyboard trapping
  useEffect(() => {
    if (!modal) return
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const getFocusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]') ?? [])
    getFocusable()[0]?.focus()
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { setModal(null); return }
      if (event.key !== 'Tab') return
      const elements = getFocusable(), first = elements[0], last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [modal, busy])

  // Advance replay day
  const advance = useCallback(async () => {
    if (actionLock.current || busy) return
    actionLock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await api<{ day: number; updated: number; finished: boolean }>('/demo/advance', {})
      await loadPopulation()
      if (result.finished) {
        setPlaying(false)
        setNotice('Replay complete. Reset the demo to start again.')
      } else if (!result.updated) {
        setNotice('No new readings available for this replay day.')
      }
    } catch (e) {
      setError((e as Error).message)
      setPlaying(false)
    } finally {
      actionLock.current = false
      setBusy(false)
    }
  }, [loadPopulation, busy])

  useEffect(() => {
    if (!playing || busy) return
    const timer = setTimeout(() => void advance(), 2400)
    return () => clearTimeout(timer)
  }, [playing, busy, advance])

  const focus = (pid: string) => {
    if (pid !== selected) setDetail(null)
    setSelected(pid)
    setRoute('patients')
    setSignal('risk')
    setTab('Overview')
    window.location.hash = `#/patients/${pid}`
  }

  const openModal = (kind: 'scenario' | 'telemetry' | 'reset') => {
    setPlaying(false)
    setError('')
    setModal(kind)
    if (kind === 'scenario') {
      setScenario({ ...scenarioDefaults })
      setSimulated(null)
    }
    if (kind === 'telemetry' && detail) {
      // P1 Honesty Fix: Start with BLANK readings.
      const date = new Date(`${detail.twin.timestamp}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + 1)
      const blankTelemetry: Record<string, string> = {
        timestamp: date.toISOString().slice(0, 10)
      }
      for (const s of detail.twin.signals) {
        blankTelemetry[s.key] = ''
      }
      setTelemetry(blankTelemetry)
      setTelemetryCopiedNotice(false)
      setTelemetryFieldError({})
    }
  }

  const copyPreviousReadings = () => {
    if (!detail) return
    const updated: Record<string, string> = { ...telemetry }
    for (const s of detail.twin.signals) {
      updated[s.key] = s.value === null ? '' : String(s.value)
    }
    setTelemetry(updated)
    setTelemetryCopiedNotice(true)
  }

  const validateTelemetryField = (key: string, val: string) => {
    if (val === '') {
      setTelemetryFieldError(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      return true
    }
    const num = Number(val)
    const spec = SIGNAL_BOUNDS[key]
    if (isNaN(num)) {
      setTelemetryFieldError(prev => ({ ...prev, [key]: 'Invalid number' }))
      return false
    }
    if (spec && (num < spec.min || num > spec.max)) {
      setTelemetryFieldError(prev => ({ ...prev, [key]: `Must be between ${spec.min} and ${spec.max} ${spec.unit}` }))
      return false
    }
    setTelemetryFieldError(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    return true
  }

  const reset = async () => {
    setBusy(true)
    setError('')
    try {
      await api('/demo/reset', {})
      setSelected('')
      setDetail(null)
      await loadPopulation()
      setModal(null)
      setNotice('Demo reset to day 35.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const runScenario = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ simulated: Twin }>(`/patients/${selected}/simulate`, scenario)
      setSimulated(result.simulated)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const ingest = async () => {
    let hasErr = false
    for (const [k, v] of Object.entries(telemetry)) {
      if (k !== 'timestamp' && !validateTelemetryField(k, v)) {
        hasErr = true
      }
    }
    if (hasErr) {
      setError('Please resolve input values outside supported physiological ranges.')
      return
    }

    setBusy(true)
    setError('')
    try {
      const payload = Object.fromEntries(
        Object.entries(telemetry).map(([k, v]) => [k, k === 'timestamp' ? v : v === '' ? null : Number(v)])
      )
      await api(`/patients/${selected}/telemetry`, payload)
      await loadPopulation()
      setModal(null)
      setNotice('Daily reading saved. Patient twin updated.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    const blob = new Blob([JSON.stringify({ patient: detail?.patient, twin: detail?.twin, observations: rows, synthetic: true }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${selected}-synthetic-twin.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const high = useMemo(() => patients.filter(p => p.status === 'High risk').length, [patients])
  const watch = useMemo(() => patients.filter(p => p.status === 'Watch').length, [patients])
  const stable = useMemo(() => patients.filter(p => p.status === 'Stable').length, [patients])
  const insufficientCount = useMemo(() => patients.filter(p => p.status === 'Insufficient data' || p.coverage < .5).length, [patients])
  const unreviewedCount = useMemo(() => patients.filter(p => !p.review_state || p.review_state === 'unreviewed' || p.review_state === 'needs_follow_up').length, [patients])

  const filtered = useMemo(() => {
    return patients.filter(p => {
      const match = `${p.patient_id} ${p.name} ${p.hf_type}`.toLowerCase().includes(search.toLowerCase())
      if (!match) return false
      if (filter === 'All patients') return true
      if (filter === 'High risk' || filter === 'High model estimate') return p.status === 'High risk'
      if (filter === 'Watch' || filter === 'Elevated model estimate') return p.status === 'Watch'
      if (filter === 'Stable' || filter === 'Low model estimate') return p.status === 'Stable'
      if (filter === 'Insufficient data') return p.status === 'Insufficient data' || p.coverage < .5
      if (filter === 'Reviewed') return p.review_state === 'reviewed'
      if (filter === 'Needs follow-up') return p.review_state === 'needs_follow_up'
      if (filter === 'Monitoring') return p.review_state === 'monitoring'
      if (filter === 'Flagged') return p.review_state === 'flagged'
      if (filter === 'Unreviewed') return !p.review_state || p.review_state === 'unreviewed'
      return p.status === filter
    })
  }, [patients, search, filter])

  const twin = detail?.twin
  const patient = detail?.patient
  const chosenSignal = twin?.signals.find(s => s.key === signal)
  const model = evaluation?.models.find(m => m.name === 'Personalized CardioTwin')
  const lastUpdate = patients.map(p => p.timestamp).filter(Boolean).sort().at(-1)
  const readableDate = (value: string | undefined) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Waiting for readings'

  const topObservations = useMemo(() => {
    if (!twin || !twin.signals) return []
    return [...twin.signals]
      .filter(s => s.value !== null && s.delta !== null)
      .sort((a, b) => Math.abs(b.deviation ?? 0) - Math.abs(a.deviation ?? 0))
      .slice(0, 3)
  }, [twin])

  const riskMovement = useMemo(() => {
    if (!rows || rows.length < 2) return null
    const cur = rows[rows.length - 1]?.risk
    const prv = rows[rows.length - 2]?.risk
    if (cur == null || prv == null) return null
    const diff = (cur - prv) * 100
    return {
      diff,
      text: `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} percentage points vs yesterday (${Math.round(prv * 100)}%)`,
      isUp: diff > 0
    }
  }, [rows])

  // Presets for Connections sample data batch ingestion
  const PRESETS = useMemo(() => {
    const nextDate = twin?.timestamp ? new Date(`${twin.timestamp}T00:00:00Z`) : new Date()
    nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    const nextDateStr = nextDate.toISOString().slice(0, 10)

    return [
      {
        title: 'Morning Vitals Sync (Scale + BP check-in)',
        description: 'Simulates smart scale and blood pressure cuff readings for the next morning.',
        items: [{ timestamp: nextDateStr, weight: 74.5, systolic_bp: 126, diastolic_bp: 82, resting_hr: 67 }]
      },
      {
        title: 'Multi-Sample Intra-Day Vitals (Aggregation test)',
        description: 'Simulates continuous intra-day samples: min resting HR, sum steps, and mean SpO2/resp.',
        items: [
          { timestamp: nextDateStr, resting_hr: 76, steps: 1800, spo2: 95, respiratory_rate: 19 },
          { timestamp: nextDateStr, resting_hr: 63, steps: 2200, spo2: 97, respiratory_rate: 17 },
          { timestamp: nextDateStr, resting_hr: 69, steps: 1400, spo2: 96, respiratory_rate: 18 }
        ]
      },
      {
        title: '3-Day Historical Backfill Sync',
        description: 'Fills delayed offline readings from past days with automatic deduplication.',
        items: [{ timestamp: twin?.timestamp || nextDateStr, resting_hr: 65, steps: 4100, spo2: 96, weight: 73.8 }]
      }
    ]
  }, [twin])

  useEffect(() => {
    if (PRESETS[presetIndex]) {
      setBatchJsonDraft(JSON.stringify(PRESETS[presetIndex].items, null, 2))
    }
  }, [presetIndex, PRESETS])

  const executeBatchIngest = async () => {
    if (!ingestTargetPid) {
      setError('Please select a target patient for wearable batch ingestion.')
      return
    }
    let parsed: any[]
    try {
      parsed = JSON.parse(batchJsonDraft)
      if (!Array.isArray(parsed) || !parsed.length) throw new Error('Batch payload must be a non-empty array of reading objects.')
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`)
      return
    }

    setBusy(true)
    setError('')
    setBatchResult(null)
    try {
      const res = await api<{ summary: TelemetryBatchSummary; twin: Twin }>(
        `/patients/${ingestTargetPid}/telemetry/batch`,
        { items: parsed }
      )
      setBatchResult(res.summary)
      setNotice(`Wearable batch ingested: ${res.summary.inserted} inserted, ${res.summary.deduplicated} deduplicated.`)
      await loadPopulation()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">Skip to patient workspace</a>

      {/* Main Header with Navigation */}
      <header className="site-header">
        <button className="brand-button" aria-label="Go to patient overview" onClick={() => navigateTo('overview')}>
          <Logo />
        </button>

        <nav aria-label="Main navigation" className="desktop-nav">
          {[
            { key: 'overview', label: 'Patient overview', text: 'Overview' },
            { key: 'patients', label: 'Digital twin', text: 'Patients' },
            { key: 'connections', label: 'Device connections', text: 'Connections' },
            { key: 'evidence', label: 'Model performance', text: 'Evidence' },
            { key: 'research', label: 'Research & methods', text: 'Research' },
            { key: 'demo', label: 'Replay controls', text: 'Demo' }
          ].map(item => (
            <button
              key={item.key}
              aria-label={item.label}
              aria-current={route === item.key ? 'page' : undefined}
              className={route === item.key ? 'nav-item active' : 'nav-item'}
              onClick={() => navigateTo(item.key as PageRoute)}
            >
              {item.text}
            </button>
          ))}
        </nav>
      </header>

      <main className="main" id="workspace-content" tabIndex={-1}>
        <div className="content">

          {error && (
            <div className="error" role="alert">
              <span><Warning size={16} /> {error}</span>
              <button onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <Check size={17} />{notice}
            </div>
          )}

          {loading ? <Loading /> : <>
            {/* Page Heading */}
            <div className="page-heading">
              <div>
                <h1>
                  {route === 'overview' ? <>Patients, <em>at a glance.</em></> :
                    route === 'patients' ? <>Patient <em>{selected.slice(-2) || 'twin'}</em></> :
                      route === 'connections' ? <>Provider <em>Connections.</em></> :
                        route === 'evidence' ? <>The model, <em>examined.</em></> :
                          route === 'research' ? <>Research <em>notes.</em></> :
                            <>Demo <em>controls.</em></>}
                </h1>
                <p>
                  {route === 'overview' ? 'Follow the changes that matter. Click cards to filter the queue or inspect patients.' :
                    route === 'patients' ? 'A daily record of this patient’s readings, personal deviations, and estimated risk.' :
                      route === 'connections' ? 'Continuous wearable streams feed daily intra-day physiological samples into the digital twin ingestion engine.' :
                        route === 'evidence' ? 'What the model learns from simulated data, and where the evidence stops.' :
                          route === 'research' ? 'The studies and design choices behind this prototype.' :
                            'Replay longitudinal wearable streams day by day, test counterfactual scenarios, and reset local demo databases.'}
                </p>
              </div>

              {route === 'patients' ? (
                <div className="patient-quick-actions">
                  <button className="button secondary" onClick={() => setShowPrintModal(true)}>
                    <Printer size={16} /> Print summary
                  </button>
                  <button className="button secondary" onClick={download} disabled={!detail}>
                    <ArrowDownToLine size={16} /> Export twin
                  </button>
                  <button className="button primary" onClick={() => openModal('telemetry')} disabled={!twin?.timestamp}>
                    <Plus size={16} /> Add daily reading
                  </button>
                </div>
              ) : (
                <div className="date-note">
                  <small>Latest observation</small>
                  <span>{readableDate(lastUpdate)}</span>
                </div>
              )}
            </div>

            {/* Wearable Replay Bar (Available on monitoring views) */}
            {(route === 'overview' || route === 'patients' || route === 'demo') && (
              <div className="replay-bar">
                <div>
                  <span className={`live-dot ${playing ? 'is-playing' : ''}`} />
                  <b>{playing ? 'Replay running' : 'Wearable replay'}</b>
                  <span>Day {day} of 60</span>
                </div>
                <div>
                  <button className="button text" disabled={busy} onClick={() => openModal('reset')}>
                    <RotateCcw size={14} /> Reset
                  </button>
                  <button className="button secondary small-btn" onClick={() => void advance()} disabled={busy || day >= 60}>
                    <StepForward size={14} /> Next day
                  </button>
                  <button
                    className={`button primary small-btn ${playing ? 'playing' : ''}`}
                    onClick={() => setPlaying(p => !p)}
                    disabled={day >= 60 || busy}
                  >
                    {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause replay' : 'Play replay'}
                  </button>
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* AREA 1: OVERVIEW (#/overview)                                */}
            {/* ============================================================ */}
            {route === 'overview' && (
              <>
                {/* Clickable Operational Summary Cards */}
                <div className="stats-grid">
                  <button
                    className={`summary-card clickable ${filter === 'High risk' ? 'active-filter' : ''}`}
                    onClick={() => setFilter('High risk')}
                    title="Filter priority queue to high risk"
                  >
                    <div className="summary-top">
                      <span>High estimated risk</span>
                      <Bell size={18} className="text-coral" />
                    </div>
                    <strong className="text-coral">{high}</strong>
                    <p>60% and above · Click to filter</p>
                  </button>

                  <button
                    className={`summary-card clickable ${filter === 'Watch' ? 'active-filter' : ''}`}
                    onClick={() => setFilter('Watch')}
                    title="Filter priority queue to watch"
                  >
                    <div className="summary-top">
                      <span>Worth a closer look</span>
                      <Clock3 size={18} />
                    </div>
                    <strong>{watch}</strong>
                    <p>20% to below 60% · Click to filter</p>
                  </button>

                  <button
                    className={`summary-card clickable ${filter === 'Stable' ? 'active-filter' : ''}`}
                    onClick={() => setFilter('Stable')}
                    title="Filter priority queue to stable"
                  >
                    <div className="summary-top">
                      <span>Stable readings</span>
                      <ShieldCheck size={18} />
                    </div>
                    <strong className="text-green">{stable}</strong>
                    <p>Below 20% · Click to filter</p>
                  </button>

                  <button
                    className={`summary-card clickable ${filter === 'Insufficient data' ? 'active-filter' : ''}`}
                    onClick={() => setFilter('Insufficient data')}
                    title="Filter priority queue to insufficient data"
                  >
                    <div className="summary-top">
                      <span>Missing / Stale data</span>
                      <Warning size={18} />
                    </div>
                    <strong>{insufficientCount}</strong>
                    <p>&lt; 50% sensor coverage · Click to filter</p>
                  </button>
                </div>

                {/* Priority Queue Layout */}
                <div className="overview-grid">
                  <section className="card patient-list">
                    <div className="card-heading">
                      <div>
                        <h2>Patient priority queue <span className="count">{patients.length}</span></h2>
                        <p>Sorted by estimated 7-day risk · {unreviewedCount} pending review</p>
                      </div>
                      <span className="subtle-tag"><Wifi size={12} /> Daily readings</span>
                    </div>

                    <div className="table-tools">
                      <label className="search">
                        <Search size={18} />
                        <input
                          aria-label="Search patients"
                          placeholder="Find a patient by ID or HF type"
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                        />
                      </label>
                      <select
                        aria-label="Filter risk category"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                      >
                        {['All patients', 'High risk', 'Watch', 'Stable', 'Insufficient data', 'Reviewed', 'Needs follow-up', 'Monitoring', 'Flagged', 'Unreviewed'].map(s => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </div>

                    <div className="table-scroll">
                      <table className="patient-table">
                        <thead>
                          <tr>
                            <th>Patient</th>
                            <th>7-day risk</th>
                            <th>Status</th>
                            <th>Review</th>
                            <th>Data coverage</th>
                            <th aria-label="Open patient" />
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map(p => (
                            <tr key={p.patient_id} className={selected === p.patient_id ? 'selected' : ''}>
                              <td>
                                <button className="patient-link" onClick={() => focus(p.patient_id)}>
                                  <span className="patient-avatar">{p.patient_id.slice(-2)}</span>
                                  <span>
                                    <b>{p.patient_id}</b>
                                    <small>{p.age}y · {p.sex} · {p.hf_type}</small>
                                  </span>
                                </button>
                              </td>
                              <td>
                                <div className={`table-risk ${riskClass(p.status)}`}>
                                  <b>{percent(p.risk)}</b>
                                  <div><i style={{ width: `${(p.risk ?? 0) * 100}%` }} /></div>
                                </div>
                              </td>
                              <td><Badge status={p.status} /></td>
                              <td><ReviewBadge state={p.review_state} /></td>
                              <td>
                                <span className="coverage">
                                  <span style={{ background: p.coverage >= .8 ? '#7c9e86' : '#c09156' }} />
                                  {Math.round(p.coverage * 100)}%
                                </span>
                                <small className="reading-date">{p.timestamp}</small>
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`Open ${p.patient_id} twin`}
                                  onClick={() => focus(p.patient_id)}
                                >
                                  <ChevronRight size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!filtered.length && <div className="empty">No patients match this search.</div>}
                    </div>

                    <div className="table-footer">
                      Showing {filtered.length} of {patients.length} patients
                      <span>Entirely synthetic · patient-specific baselines</span>
                    </div>
                  </section>

                  {/* Aside: Patient in Focus */}
                  <aside className="overview-aside">
                    <section className="card featured-twin">
                      <div className="card-heading">
                        <div>
                          <span className="eyebrow">Patient in focus</span>
                          <h2>{selected || 'Patient twin'}</h2>
                          <p>{patient ? `${patient.age} years · ${patient.sex} · ${patient.hf_type}` : 'Loading profile'}</p>
                        </div>
                        <span className="case-number">{selected.slice(-2)}</span>
                      </div>

                      <HeartVisual twin={twin} small />

                      {twin && (
                        <>
                          <div className="featured-risk">
                            <div>
                              <small>Estimated risk · next 7 days</small>
                              <strong className={riskClass(twin.status)}>{percent(twin.risk?.probability)}</strong>
                            </div>
                            <Badge status={twin.status} />
                          </div>
                          <div className="preview-chart">
                            <TrendChart rows={rows} compact />
                            <span>21-day risk history</span>
                          </div>
                          <button className="button primary full" onClick={() => focus(selected)}>
                            Explore digital twin <ArrowRight size={16} />
                          </button>
                        </>
                      )}
                    </section>

                    <section className="insight-card">
                      <span className="eyebrow">A note on personal baselines</span>
                      <h3>75 bpm is only<br />part of the story.</h3>
                      <p>For someone usually at 58, that’s a change. For someone usually at 73, it may be an ordinary day.</p>
                      <button onClick={() => navigateTo('research')}>
                        Read how the baseline works <ArrowRight size={16} />
                      </button>
                    </section>
                  </aside>
                </div>
              </>
            )}

            {/* ============================================================ */}
            {/* AREA 2: PATIENTS & TWIN DETAIL (#/patients)                  */}
            {/* ============================================================ */}
            {route === 'patients' && (detail ? (
              <>
                {/* 1. Compact Patient Header */}
                <div className="patient-header">
                  <div className="patient-identity">
                    <div className="patient-avatar large">{selected.slice(-2)}</div>
                    <div>
                      <h2>{selected} <span>Fictional patient</span></h2>
                      <p>{patient?.age} years · {patient?.sex} · {patient?.hf_type} · NYHA {patient?.nyha}</p>
                    </div>
                  </div>
                  <div>
                    <label className="sr-only" htmlFor="patient-selector">Choose a patient</label>
                    <select
                      id="patient-selector"
                      value={selected}
                      onChange={e => { setSelected(e.target.value); setDetail(null); window.location.hash = `#/patients/${e.target.value}` }}
                    >
                      {patients.map(p => (
                        <option key={p.patient_id} value={p.patient_id}>{p.patient_id} · {p.status}</option>
                      ))}
                    </select>
                    <button className="button secondary" onClick={() => openModal('telemetry')} disabled={!twin?.timestamp}>
                      <Plus size={16} /> Add daily reading
                    </button>
                  </div>
                </div>

                {/* Patient Tabs */}
                <div className="patient-tabs" role="tablist">
                  {(['Overview', 'Explainability', 'EHR profile', 'Data timeline'] as const).map(t => (
                    <button
                      role="tab"
                      aria-selected={tab === t}
                      key={t}
                      onClick={() => setTab(t)}
                      className={tab === t ? 'active' : ''}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Tab: Overview */}
                {tab === 'Overview' && twin && (
                  <>
                    {/* 2. Change Summary */}
                    <div className="patient-top-grid">
                      <section className="card risk-card">
                        <div>
                          <span className="eyebrow">ESTIMATED 7-DAY DECOMPENSATION RISK</span>
                          <div className="risk-score">
                            <strong className={riskClass(twin.status)}>{percent(twin.risk?.probability)}</strong>
                            <Badge status={twin.status} />
                          </div>

                          {twin.risk?.ci_lower != null && (
                            <div className="uncertainty-pill" title="95% confidence interval on calibrated risk">
                              95% CI: [{percent(twin.risk.ci_lower)} – {percent(twin.risk.ci_upper)}] · ±{Math.round((twin.risk.uncertainty_width ?? 0) * 50)}% margin
                            </div>
                          )}

                          {riskMovement && (
                            <div className="trend-metric-row">
                              <small className={`movement-text ${riskMovement.isUp ? 'text-coral' : 'text-green'}`}>
                                {riskMovement.isUp ? '▲' : '▼'} {riskMovement.text}
                              </small>
                            </div>
                          )}

                          <p>Personal baseline + wearable trends + EHR context</p>
                          <div className="risk-scale">
                            <i style={{ left: `${(twin.risk?.probability ?? 0) * 100}%` }} />
                          </div>
                          <div className="risk-scale-labels">
                            <span>Low model estimate</span>
                            <span>Elevated estimate</span>
                            <span>High estimate</span>
                          </div>
                          <div className="data-note">
                            <Wifi size={14} /> {Math.round(twin.quality.coverage * 100)}% sensor coverage
                            <span>·</span> Updated {twin.timestamp}
                          </div>
                          <button className="button secondary" onClick={() => openModal('scenario')} disabled={!twin.risk}>
                            <SlidersHorizontal size={15} /> Explore a scenario
                          </button>
                        </div>
                        <HeartVisual twin={twin} />
                      </section>

                      {/* Digital Twin State */}
                      <section className="card state-card">
                        <div className="card-heading">
                          <div>
                            <h2>Digital twin state</h2>
                            <p>Model-derived indices · 0–100</p>
                          </div>
                          <Activity size={18} />
                        </div>
                        <TwinIndices twin={twin} />
                        <p className="micro-note">Higher burden means greater deviation; higher stability means closer to baseline. These are illustrative indices.</p>
                      </section>
                    </div>

                    {/* 3. Three Main Key Clinical Observations */}
                    <div className="key-observations-section card">
                      <div className="section-title-row">
                        <h3>Key Physiological Observations</h3>
                        <span className="subtle-tag">Measured readings vs personal baseline</span>
                      </div>
                      <div className="observations-grid">
                        {topObservations.length ? (
                          topObservations.map(s => (
                            <div key={s.key} className="observation-card">
                              <div className="obs-header">
                                <span className="obs-name">{s.label}</span>
                                <span className={`obs-badge ${(s.delta ?? 0) > 0 ? 'elevated' : 'reduced'}`}>
                                  {s.delta! >= 0 ? '+' : ''}{s.delta!.toFixed(s.key === 'weight' ? 1 : 0)} {s.unit}
                                </span>
                              </div>
                              <div className="obs-body">
                                <strong>{s.value!.toFixed(s.key === 'weight' ? 1 : 0)} {s.unit}</strong>
                                <p>Personal baseline: {s.baseline?.toFixed(s.key === 'weight' ? 1 : 0)} {s.unit}</p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="empty-obs">All vital signs remain within expected personal baseline boundaries.</div>
                        )}
                      </div>
                    </div>

                    {/* 4. Clinician Review & Triage Ledger */}
                    <div className="review-triage">
                      <div className="review-triage-header">
                        <h3>Clinician Review & Triage</h3>
                        <div className="review-triage-controls">
                          <select
                            value={review.state}
                            aria-label="Patient review status"
                            disabled={busy}
                            onChange={e => void saveReview(e.target.value)}
                          >
                            <option value="unreviewed">Unreviewed</option>
                            <option value="monitoring">Monitoring</option>
                            <option value="needs_follow_up">Needs follow-up</option>
                            <option value="flagged">Flagged</option>
                            <option value="reviewed">Reviewed</option>
                          </select>
                          <ReviewBadge state={review.state} />
                        </div>
                      </div>
                      <textarea
                        className="review-note-input"
                        placeholder="Document clinical review note, triage decision, or follow-up rationale..."
                        value={noteDraft}
                        onChange={e => setNoteDraft(e.target.value)}
                        disabled={busy}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <small style={{ color: '#70685d', fontSize: '11px' }}>
                          {review.updated_at ? `Last reviewed: ${new Date(review.updated_at).toLocaleString()}` : 'No review notes saved yet'}
                        </small>
                        <button
                          className="button secondary small-btn"
                          disabled={busy || (noteDraft === (review.note || '') && review.state !== 'unreviewed')}
                          onClick={() => void saveReview()}
                        >
                          Save review note
                        </button>
                      </div>
                    </div>

                    {/* 5. Trend Chart with Controls */}
                    <div className="patient-bottom-grid">
                      <section className="card trend-card">
                        <div className="card-heading">
                          <div>
                            <h2>{signal === 'risk' ? 'Risk trajectory' : chosenSignal?.label}</h2>
                            <p>{signal === 'risk' ? 'A daily view of the estimated 7-day risk (shaded ribbon: 95% CI)' : 'Dashed line shows the personal baseline · gaps are missing data'}</p>
                          </div>
                          <span className="subtle-tag">Last {rows.length} readings</span>
                        </div>

                        {/* Chart Signal Selector */}
                        <div className="chart-controls-bar">
                          <div className="chart-tabs">
                            {[
                              { key: 'risk', label: 'Risk' },
                              { key: 'resting_hr', label: 'Heart rate' },
                              { key: 'weight', label: 'Weight' },
                              { key: 'respiratory_rate', label: 'Respiration' },
                              { key: 'steps', label: 'Activity' }
                            ].map(s => (
                              <button
                                key={s.key}
                                onClick={() => setSignal(s.key)}
                                className={signal === s.key ? 'active' : ''}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                          <div className="more-signals-dropdown">
                            <select
                              aria-label="More signals"
                              value={['risk', 'resting_hr', 'weight', 'respiratory_rate', 'steps'].includes(signal) ? '' : signal}
                              onChange={e => { if (e.target.value) setSignal(e.target.value) }}
                            >
                              <option value="">More signals...</option>
                              <option value="hrv">Heart rate variability (ms)</option>
                              <option value="spo2">Oxygen saturation (%)</option>
                              <option value="systolic_bp">Systolic BP (mmHg)</option>
                              <option value="diastolic_bp">Diastolic BP (mmHg)</option>
                              <option value="sleep_hours">Sleep duration (hrs)</option>
                            </select>
                          </div>
                        </div>

                        <TrendChart
                          rows={rows}
                          signal={signal}
                          baseline={chosenSignal?.baseline}
                          unit={chosenSignal?.unit}
                        />

                        <div className="chart-legend">
                          <i /> {signal === 'risk' ? 'Estimated risk (shaded area: 95% CI)' : 'Observed signal'}
                          {signal !== 'risk' && <><i className="baseline" /> Personal baseline</>}
                        </div>
                      </section>

                      {/* TreeSHAP Explanation Card */}
                      <section className="card explanation-card">
                        <div className="card-heading">
                          <div>
                            <h2>Why this risk?</h2>
                            <p>TreeSHAP · calibrated log-odds</p>
                          </div>
                          <Info size={16} />
                        </div>
                        {twin.risk ? (
                          <Contributions values={twin.risk.explanation.contributions} />
                        ) : (
                          <p>Personal baseline or current data is incomplete.</p>
                        )}
                        <button className="button text" onClick={() => setTab('Explainability')}>
                          View full explanation <ArrowRight size={14} />
                        </button>
                      </section>
                    </div>
                  </>
                )}

                {/* Tab: Explainability */}
                {tab === 'Explainability' && twin && (
                  <section className="card explanation-full">
                    <div className="card-heading">
                      <div>
                        <h2>A traceable estimate.</h2>
                        <p>Each feature pushes the model’s log-odds higher or lower.</p>
                      </div>
                      <span className="subtle-tag">Native TreeSHAP</span>
                    </div>
                    {twin.risk ? (
                      <>
                        <div className="explanation-summary">
                          <div>
                            <small>Base log-odds</small>
                            <strong>{twin.risk.explanation.base_value.toFixed(3)}</strong>
                          </div>
                          <Plus size={16} />
                          <div>
                            <small>Sum of contributions</small>
                            <strong>{twin.risk.explanation.contributions.reduce((a, b) => a + b.contribution, 0).toFixed(3)}</strong>
                          </div>
                          <span>=</span>
                          <div>
                            <small>Final log-odds</small>
                            <strong>{twin.risk.explanation.log_odds.toFixed(3)}</strong>
                          </div>
                          <ArrowRight size={18} />
                          <div>
                            <small>After sigmoid</small>
                            <strong>{percent(twin.risk.probability)}</strong>
                          </div>
                        </div>
                        <div className="explanation-columns">
                          <Contributions values={twin.risk.explanation.contributions} limit={12} />
                          <div className="method-note">
                            <h3>Read the explanation carefully.</h3>
                            <p>Coral contributions increase the model’s estimate. Green contributions lower it. Values are additive in log-odds space, not percentage-point changes in probability.</p>
                            <p>The displayed list shows the 12 largest contributions; the sum above includes all features.</p>
                            <p>These are predictive associations in synthetic data. They do not establish causation or support treatment decisions.</p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p>Risk inference is paused until adequate baseline and current readings are available.</p>
                    )}
                  </section>
                )}

                {/* Tab: EHR profile */}
                {tab === 'EHR profile' && patient && (
                  <section className="card ehr-card">
                    <div className="card-heading">
                      <div>
                        <h2>Historical patient context</h2>
                        <p>Fictional EHR attributes used by the model</p>
                      </div>
                      <Badge status="Synthetic EHR" />
                    </div>
                    <div className="ehr-grid">
                      {[
                        { label: 'Age', value: `${patient.age} years` },
                        { label: 'HF phenotype', value: patient.hf_type },
                        { label: 'LVEF', value: `${patient.lvef}%` },
                        { label: 'NYHA class', value: patient.nyha },
                        { label: 'Creatinine', value: `${patient.creatinine} mg/dL` },
                        { label: 'eGFR', value: `${patient.egfr} mL/min/1.73m²` },
                        { label: 'Sodium', value: `${patient.sodium} mmol/L` },
                        { label: 'Hemoglobin', value: `${patient.hemoglobin} g/dL` },
                        { label: 'Previous admissions', value: patient.previous_admissions },
                        { label: 'Diabetes', value: patient.diabetes ? 'Yes' : 'No' },
                        { label: 'Chronic kidney disease', value: patient.ckd ? 'Yes' : 'No' },
                        { label: 'COPD', value: patient.copd ? 'Yes' : 'No' }
                      ].map(x => (
                        <div key={x.label}>
                          <small>{x.label}</small>
                          <strong>{x.value}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="method-note">
                      <h3>Every patient begins with their own baseline.</h3>
                      <p>The first 14 observed days establish a frozen stable-period median and median absolute deviation for each signal. This assumption holds in the simulator and requires verification for any real deployment.</p>
                    </div>
                  </section>
                )}

                {/* Tab: Data timeline */}
                {tab === 'Data timeline' && (
                  <section className="card">
                    <div className="card-heading">
                      <div>
                        <h2>Daily observation ledger</h2>
                        <p>Persisted readings only; withheld replay data is excluded</p>
                      </div>
                      <button className="button text" onClick={download}>
                        <ArrowDownToLine size={15} /> Export JSON
                      </button>
                    </div>
                    <div className="table-scroll">
                      <table className="patient-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Risk</th>
                            <th>HR</th>
                            <th>HRV</th>
                            <th>Weight</th>
                            <th>Resp.</th>
                            <th>SpO₂</th>
                            <th>Steps</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...rows].reverse().map(row => (
                            <tr key={row.day}>
                              <td>{row.timestamp}</td>
                              <td>{percent(row.risk)}</td>
                              {['resting_hr', 'hrv', 'weight', 'respiratory_rate', 'spo2', 'steps'].map(key => (
                                <td key={key}>{row[key] ?? '—'}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            ) : <Loading />)}

            {/* ============================================================ */}
            {/* AREA 3: CONNECTIONS (#/connections)                         */}
            {/* ============================================================ */}
            {route === 'connections' && (
              <div className="page-section">
                <div className="connections-grid">
                  <section className="card providers-card">
                    <div className="card-heading">
                      <div>
                        <h2>Supported Wearable Ecosystems</h2>
                        <p>Native adapter contracts defined in mobile companion workspace</p>
                      </div>
                    </div>
                    <div className="providers-list">
                      {[
                        {
                          name: 'Apple Health (HealthKit)',
                          desc: 'Continuous background heart rate, HRV (SDNN), resting pulse, sleep segments, and steps.',
                          badge: 'Planned Integration',
                          contract: 'mobile/src/adapters/apple_health.ts'
                        },
                        {
                          name: 'Garmin Health API',
                          desc: 'Direct cloud API webhook for pulse oximetry (SpO2), respiration, and daily resting pulse.',
                          badge: 'Planned Integration',
                          contract: 'mobile/src/adapters/garmin.ts'
                        },
                        {
                          name: 'Withings Health Mate',
                          desc: 'Cellular scale telemetry (body weight, BMI) and home blood pressure monitoring cuffs.',
                          badge: 'Planned Integration',
                          contract: 'mobile/src/adapters/withings.ts'
                        },
                        {
                          name: 'Google Health Connect',
                          desc: 'Android unified health store integrating multi-sensor wearable telemetry.',
                          badge: 'Planned Integration',
                          contract: 'mobile/src/adapters/health_connect.ts'
                        }
                      ].map(prov => (
                        <div key={prov.name} className="provider-item">
                          <div className="provider-main">
                            <div className="prov-title-row">
                              <b>{prov.name}</b>
                              <span className="planned-badge">{prov.badge}</span>
                            </div>
                            <p>{prov.desc}</p>
                            <small className="contract-path">Adapter contract: {prov.contract}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Working Sample-Data Ingestion Sandbox */}
                  <section className="card ingest-sandbox-card">
                    <div className="card-heading">
                      <div>
                        <h2>Live Wearable Ingestion Engine</h2>
                        <p>Multi-sample physiological aggregation, backfill support, and deduplication</p>
                      </div>
                      <span className="subtle-tag"><Activity size={14} /> Active Engine</span>
                    </div>

                    <div className="ingest-controls">
                      <div className="ingest-row">
                        <label htmlFor="target-patient">Target patient:</label>
                        <select
                          id="target-patient"
                          value={ingestTargetPid}
                          onChange={e => setIngestTargetPid(e.target.value)}
                        >
                          {patients.map(p => (
                            <option key={p.patient_id} value={p.patient_id}>{p.patient_id} ({p.name})</option>
                          ))}
                        </select>
                      </div>

                      <div className="ingest-row">
                        <label htmlFor="preset-select">Telemetry scenario preset:</label>
                        <select
                          id="preset-select"
                          value={presetIndex}
                          onChange={e => setPresetIndex(Number(e.target.value))}
                        >
                          {PRESETS.map((p, i) => (
                            <option key={i} value={i}>{p.title}</option>
                          ))}
                        </select>
                      </div>

                      <p className="preset-description">{PRESETS[presetIndex]?.description}</p>

                      <div className="json-editor-wrap">
                        <label htmlFor="json-draft">Wearable Telemetry JSON Batch:</label>
                        <textarea
                          id="json-draft"
                          className="code-textarea"
                          value={batchJsonDraft}
                          onChange={e => setBatchJsonDraft(e.target.value)}
                          rows={6}
                        />
                      </div>

                      <div className="ingest-actions">
                        <button className="button primary" disabled={busy} onClick={() => void executeBatchIngest()}>
                          <UploadSimple size={16} /> {busy ? 'Ingesting…' : 'Ingest wearable batch'}
                        </button>
                      </div>

                      {batchResult && (
                        <div className="batch-result-card" role="status">
                          <h4><Check size={16} /> Batch Ingestion Summary</h4>
                          <div className="result-metrics">
                            <span>Inserted: <b>{batchResult.inserted}</b></span>
                            <span>Updated: <b>{batchResult.updated}</b></span>
                            <span>Deduplicated: <b>{batchResult.deduplicated}</b></span>
                            <span>Backfilled: <b>{batchResult.backfilled}</b></span>
                          </div>
                          <button
                            className="button secondary small-btn"
                            onClick={() => focus(ingestTargetPid)}
                          >
                            Inspect updated twin for {ingestTargetPid} <ArrowRight size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* AREA 4: EVIDENCE (#/evidence)                                */}
            {/* ============================================================ */}
            {route === 'evidence' && evaluation && (
              <>
                <div className="stats-grid">
                  <SummaryCard icon={<Users size={20} />} label="Synthetic patients" number={evaluation.n_patients} detail={`${evaluation.n_samples.toLocaleString()} labeled patient-days`} />
                  <SummaryCard icon={<ShieldCheck size={20} />} label="Held-out test patients" number={evaluation.split_counts.test} detail="No patient overlaps with training" tone="green" />
                  <SummaryCard icon={<Activity size={20} />} label="Personalized ROC-AUC" number={model?.roc_auc.toFixed(3) ?? '—'} detail="Discrimination on synthetic data" tone="coral" />
                  <SummaryCard icon={<FlaskConical size={20} />} label="Personalized PR-AUC" number={model?.pr_auc.toFixed(3) ?? '—'} detail={`${percent(evaluation.positive_fraction)} positive patient-days overall`} tone="amber" />
                </div>

                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>What does personalization add?</h2>
                      <p>Training 70% · calibration & threshold selection 15% · untouched test set 15%</p>
                    </div>
                    <span className="subtle-tag">Seed 2026</span>
                  </div>
                  <div className="table-scroll">
                    <table className="evaluation-table">
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>ROC-AUC</th>
                          <th>PR-AUC</th>
                          <th>Brier ↓</th>
                          <th>Sensitivity</th>
                          <th>Specificity</th>
                          <th>False alerts /<br />patient-month</th>
                          <th>Mean lead<br />days</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evaluation.models.map(m => (
                          <tr key={m.name} className={m.name === 'Personalized CardioTwin' ? 'best-model' : ''}>
                            <td>
                              <b>{m.name}</b>
                              {m.name === 'Personalized CardioTwin' && <small>Primary prototype model</small>}
                            </td>
                            <td>{m.roc_auc.toFixed(3)}</td>
                            <td>{m.pr_auc.toFixed(3)}</td>
                            <td>{m.brier.toFixed(3)}</td>
                            <td>{percent(m.sensitivity)}</td>
                            <td>{percent(m.specificity)}</td>
                            <td>{m.false_alerts_per_patient_month.toFixed(2)}</td>
                            <td>{m.mean_lead_days?.toFixed(1) ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-footer">Operating thresholds maximize validation F1. Dashboard categories use separate demo thresholds (20% / 60%).</div>
                </section>

                <div className="evaluation-grid">
                  <section className="card">
                    <div className="card-heading">
                      <div>
                        <h2>Calibration check</h2>
                        <p>Predicted vs observed rates · held-out synthetic data</p>
                      </div>
                    </div>
                    {model && <CalibrationChart bins={model.calibration} />}
                    <p className="micro-note">Quantile bins. Closer to the dashed diagonal means better agreement in this benchmark.</p>
                  </section>
                  <section className="card limitations">
                    <h2>What this benchmark can tell us</h2>
                    <p>The model learns generated trajectories and synthetic event labels. These results demonstrate the software pipeline and the value of personalization within this simulator.</p>
                    <p>They cannot establish clinical sensitivity, real-world warning time, improved outcomes, or transportability to a hospital population.</p>
                    <div className="split-pills">
                      {Object.entries(evaluation.split_counts).map(([k, v]) => (
                        <span key={k}>{k}<b>{v}</b></span>
                      ))}
                    </div>
                    <p className="micro-note">False alerts count the start of each consecutive alert episode on negative-label days. Lead time is measured only within the 7-day target window; undetected events are excluded from its mean.</p>
                  </section>
                </div>
              </>
            )}

            {/* ============================================================ */}
            {/* AREA 5: RESEARCH & METHODS (#/research)                      */}
            {/* ============================================================ */}
            {route === 'research' && (
              <>
                <section className="research-hero card">
                  <div>
                    <span className="eyebrow">The premise</span>
                    <h2>Understand an ordinary day.<br />Then look for change.</h2>
                    <p>A patient-specific virtual state combines fictional EHR context with daily wearable and home-device signals. Each observation updates the twin and its estimated seven-day risk. The explanation makes those changes inspectable.</p>
                    <div className="subtle-tag">An engineering proof of concept</div>
                  </div>
                  <HeartVisual />
                </section>
                <div className="research-grid">
                  {[
                    { n: '01', title: 'A personal baseline', body: 'A 14-day stable window estimates each signal’s median and MAD. Minimum observation counts and scale floors avoid unreliable or exploding deviations.' },
                    { n: '02', title: 'Causal temporal features', body: 'Current readings, 3- and 7-day means and slopes, variability, missingness, and personal deviations use only observations available at the prediction day.' },
                    { n: '03', title: 'An interpretable model', body: 'XGBoost learns tabular features. Validation-only sigmoid calibration adjusts its probability scale. Native TreeSHAP attributes calibrated log-odds to input features.' },
                    { n: '04', title: 'A living virtual state', body: 'Illustrative congestion, stress, oxygenation, activity, and hemodynamic indices evolve with readings. They are derived scores, not measured physiological parameters.' },
                    { n: '05', title: 'A scenario, not a prescription', body: 'Perturb the latest day’s weight, pulse, respiration, or activity. The scenario recomputes the twin without saving readings or estimating treatment effects.' },
                    { n: '06', title: 'Honest data provenance', body: 'This release uses an in-house seeded simulator only. It does not include Synthea, PhysioNet, real wearables, hospital EHRs, or mechanistic heart simulation.' }
                  ].map(item => (
                    <section className="card research-method" key={item.n}>
                      <span>{item.n}</span>
                      <h3>{item.title}</h3>
                      <p>{item.body}</p>
                    </section>
                  ))}
                </div>
                <section className="card research-references">
                  <h2>Research that informed the concept</h2>
                  <p>These studies motivate the design. Their published results are not this prototype’s results.</p>
                  <a href="https://pubmed.ncbi.nlm.nih.gov/32093506/" target="_blank" rel="noreferrer">
                    <div>
                      <b>LINK-HF · wearable monitoring</b>
                      <span>Personalized physiological monitoring for HF hospitalization prediction</span>
                    </div>
                    <ArrowRight size={17} />
                  </a>
                  <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC11449733/" target="_blank" rel="noreferrer">
                    <div>
                      <b>TIM-HF2 · seven-day prediction</b>
                      <span>Machine learning with daily remote-monitoring observations</span>
                    </div>
                    <ArrowRight size={17} />
                  </a>
                  <a href="https://www.nature.com/articles/s41746-025-01501-9" target="_blank" rel="noreferrer">
                    <div>
                      <b>Mechanistic HF digital twins</b>
                      <span>A more physiologically detailed direction for future research</span>
                    </div>
                    <ArrowRight size={17} />
                  </a>
                </section>
              </>
            )}

            {/* ============================================================ */}
            {/* AREA 6: DEMO CONTROLS & REPLAY (#/demo)                      */}
            {/* ============================================================ */}
            {route === 'demo' && (
              <div className="page-section">
                <div className="demo-controls-panel card">
                  <div className="demo-info-grid">
                    <div className="demo-info-card">
                      <h3>Simulation Parameters</h3>
                      <p>Seed 2026 · 800 synthetic patients · 60 observed days. Telemetry is seeded up to Day 35; subsequent days are streamed dynamically from SQLite replay storage.</p>
                    </div>
                    <div className="demo-info-card">
                      <h3>Research Boundary Notice</h3>
                      <p>All data is synthetic. Model metrics reflect performance on this generator, not clinical sensitivity. No medical advice, diagnosis, or causal intervention estimates are provided.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>}
        </div>
      </main>

      {/* Mobile Bottom Navigation Bar (4 items) */}
      <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
        {[
          { key: 'overview', label: 'Overview', icon: <Users size={20} /> },
          { key: 'patients', label: 'Patients', icon: <Activity size={20} /> },
          { key: 'connections', label: 'Connections', icon: <Wifi size={20} /> },
          { key: 'evidence', label: 'Evidence', icon: <FlaskConical size={20} /> }
        ].map(item => (
          <button
            key={item.key}
            className={`bottom-nav-item ${route === item.key ? 'active' : ''}`}
            onClick={() => navigateTo(item.key as PageRoute)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Printable Clinical Summary Modal */}
      {showPrintModal && detail && patient && twin && (
        <PrintableSummary
          patient={patient}
          twin={twin}
          review={review}
          onClose={() => setShowPrintModal(false)}
        />
      )}

      {/* Modal Dialogs */}
      {modal && (
        <div className="modal-backdrop" onClick={() => !busy && setModal(null)}>
          <section
            className={`modal ${modal === 'reset' ? 'reset-modal' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={e => e.stopPropagation()}
          >
            <button className="modal-close icon-button" aria-label="Close dialog" disabled={busy} onClick={() => setModal(null)}>
              <X size={19} />
            </button>
            <span className="eyebrow">
              {modal === 'scenario' ? 'PHYSIOLOGICAL EXPLORATION' : modal === 'telemetry' ? 'DAILY SENSOR OBSERVATION' : 'DEMO CONTROLS'}
            </span>
            <h2 id="modal-title">
              {modal === 'scenario' ? 'What if the signals change?' : modal === 'telemetry' ? 'Add a daily reading.' : 'Restart the demo?'}
            </h2>
            <p>
              {modal === 'scenario' ? 'Adjust the latest day’s physiology to recompute the model estimate.' :
                modal === 'telemetry' ? `${selected} · Add exactly the next calendar day. Blank sensors stay missing.` :
                  'This replaces all local demo patients and manually added readings with the original synthetic cohort.'}
            </p>

            {error && <div className="error" role="alert">{error}</div>}

            {modal === 'scenario' && (
              <>
                <div className="scenario-sliders">
                  {sliderSpecs.map(s => (
                    <label key={s.key}>
                      <div>
                        <b>{s.label}</b>
                        <span>{scenario[s.key] > 0 ? '+' : ''}{scenario[s.key]} {s.unit}</span>
                      </div>
                      <input
                        type="range"
                        aria-label={s.label}
                        min={s.min}
                        max={s.max}
                        step={s.step}
                        value={scenario[s.key]}
                        onChange={e => {
                          setScenario(old => ({ ...old, [s.key]: Number(e.target.value) }))
                          setSimulated(null)
                        }}
                      />
                    </label>
                  ))}
                </div>
                <div className="scenario-comparison">
                  <div>
                    <small>Current estimate</small>
                    <strong>{percent(twin?.risk?.probability)}</strong>
                  </div>
                  <ArrowRight size={22} />
                  <div>
                    <small>Scenario estimate</small>
                    <strong className="text-coral">{simulated ? percent(simulated.risk?.probability) : '—'}</strong>
                  </div>
                </div>
                {simulated && (
                  <p className="scenario-result" role="status">
                    Scenario recomputed. Change: {((simulated.risk!.probability - twin!.risk!.probability) * 100).toFixed(1)} percentage points. Original readings remain unchanged.
                  </p>
                )}
                <div className="modal-note">
                  <Info size={15} /> This is a one-day input perturbation, not a causal forecast or a treatment recommendation.
                </div>
                <button className="button primary full" disabled={busy} onClick={() => void runScenario()}>
                  <SlidersHorizontal size={16} /> {busy ? 'Recomputing…' : 'Recompute scenario'}
                </button>
              </>
            )}

            {modal === 'telemetry' && (
              <form onSubmit={e => { e.preventDefault(); void ingest() }}>
                {/* P1 Honesty Fix: Explicit Copy action with provenance notice */}
                <div className="copy-action-banner">
                  <button type="button" className="button secondary small-btn" onClick={copyPreviousReadings}>
                    <Copy size={14} /> Copy yesterday’s values
                  </button>
                  {telemetryCopiedNotice && (
                    <span className="copied-note"><Check size={14} /> Values copied from previous observation. Adjust before submitting.</span>
                  )}
                </div>

                <div className="telemetry-form">
                  <label className="full-field">
                    Date
                    <input
                      type="date"
                      required
                      value={telemetry.timestamp || ''}
                      onChange={e => setTelemetry(old => ({ ...old, timestamp: e.target.value }))}
                    />
                  </label>
                  {twin?.signals.map(s => {
                    const spec = SIGNAL_BOUNDS[s.key]
                    const fieldErr = telemetryFieldError[s.key]
                    return (
                      <label key={s.key} className={fieldErr ? 'field-with-error' : ''}>
                        <div className="field-label-row">
                          <span>{s.label} <small>({s.unit})</small></span>
                          {spec && <span className="field-range-hint">{spec.min}–{spec.max}</span>}
                        </div>
                        <input
                          type="number"
                          step="any"
                          aria-label={`${s.label} reading`}
                          value={telemetry[s.key] ?? ''}
                          placeholder={spec?.placeholder || 'Missing'}
                          onChange={e => {
                            const val = e.target.value
                            setTelemetry(old => ({ ...old, [s.key]: val }))
                            validateTelemetryField(s.key, val)
                          }}
                        />
                        {fieldErr && <small className="field-error-text">{fieldErr}</small>}
                      </label>
                    )
                  })}
                </div>
                <div className="modal-note">
                  <Info size={15} /> Readings start blank to prevent silent replication. Blank fields are recorded as sensor gaps.
                </div>
                <button className="button primary full" disabled={busy} type="submit">
                  <Plus size={16} /> {busy ? 'Saving…' : 'Save reading & update twin'}
                </button>
              </form>
            )}

            {modal === 'reset' && (
              <div className="reset-buttons">
                <button className="button secondary" disabled={busy} onClick={() => setModal(null)}>Cancel</button>
                <button className="button primary" disabled={busy} onClick={() => void reset()}>
                  <RotateCcw size={15} /> {busy ? 'Resetting…' : 'Reset demo'}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <Logo />
        <span>Research prototype · Synthetic data · No treatment recommendations</span>
        <a href="https://github.com/1shu1iwari-crypto/digital-twin" target="_blank" rel="noreferrer">
          View repository <ArrowRight size={13} />
        </a>
      </footer>
    </div>
  )
}

function SummaryCard({ icon, label, number, detail, tone = 'neutral' }: { icon: React.ReactNode; label: string; number: string | number; detail: string; tone?: string }) {
  return (
    <section className={`summary-card ${tone}`}>
      <div className="summary-top">
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <strong>{number}</strong>
      <p>{detail}</p>
    </section>
  )
}

function CalibrationChart({ bins }: { bins: { predicted: number; observed: number }[] }) {
  const x = (v: number) => 40 + v * 350
  const y = (v: number) => 230 - v * 200
  return (
    <svg className="calibration-chart" viewBox="0 0 420 270" role="img" aria-label="Calibration curve: predicted probability versus observed event fraction">
      <line x1={40} y1={230} x2={390} y2={30} stroke="#acb7ac" strokeDasharray="5 5" />
      {[0, .25, .5, .75, 1].map(t => (
        <g key={t}>
          <line x1={40} y1={y(t)} x2={390} y2={y(t)} stroke="#e7e9e2" />
          <text x={30} y={y(t) + 4} textAnchor="end" className="chart-label">{Math.round(t * 100)}%</text>
          <text x={x(t)} y={248} textAnchor="middle" className="chart-label">{Math.round(t * 100)}%</text>
        </g>
      ))}
      <path d={bins.map((p, i) => `${i ? 'L' : 'M'}${x(p.predicted)},${y(p.observed)}`).join(' ')} fill="none" stroke="#b8735f" strokeWidth="2" />
      {bins.map((p, i) => (
        <circle key={i} cx={x(p.predicted)} cy={y(p.observed)} r={4} fill="#b8735f" />
      ))}
      <text x={210} y={266} textAnchor="middle" className="chart-label">Predicted probability</text>
    </svg>
  )
}
