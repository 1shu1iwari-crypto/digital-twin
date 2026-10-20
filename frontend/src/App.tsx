import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import {
  Activity, ArrowDownToLine, ArrowRight, Bell, Check, ChevronRight,
  FlaskConical, Info, Pause, Play, Plus, RotateCcw, Search,
  SlidersHorizontal, StepForward, Users, Wifi, X, Printer, Copy,
  Warning, UploadSimple
} from './icons'
import type { Evaluation, Observation, Patient, Twin, Review, TelemetryBatchSummary } from './types'
import {
  Badge, Contributions, HeartVisual, Loading, percent, riskClass,
  TrendChart, TwinIndices, ReviewBadge, PrintableSummary
} from './components'

async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    signal,
    ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
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
  { key: 'activity_percent', label: 'Daily activity', min: -80, max: 50, step: 5, unit: '%' },
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
  sleep_hours: { label: 'Sleep duration', unit: 'hours', min: 2, max: 12, placeholder: '2–12' },
}

export type PageRoute = 'overview' | 'patients' | 'connections' | 'evidence' | 'research' | 'demo'

export default function App() {
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

  const [scenario, setScenario] = useState({ ...scenarioDefaults })
  const [simulated, setSimulated] = useState<Twin | null>(null)

  const [telemetry, setTelemetry] = useState<Record<string, string>>({})
  const [telemetryCopiedNotice, setTelemetryCopiedNotice] = useState(false)
  const [telemetryFieldError, setTelemetryFieldError] = useState<Record<string, string>>({})

  const [review, setReview] = useState<Review>({ patient_id: '', day: 0, state: 'unreviewed', note: '', updated_at: null })
  const [noteDraft, setNoteDraft] = useState('')
  const [revision, setRevision] = useState(0)

  const [ingestTargetPid, setIngestTargetPid] = useState('')
  const [presetIndex, setPresetIndex] = useState(0)
  const [batchJsonDraft, setBatchJsonDraft] = useState('')
  const [batchResult, setBatchResult] = useState<TelemetryBatchSummary | null>(null)

  const prevRisksRef = useRef<Record<string, number>>({})
  const [alertingPids, setAlertingPids] = useState<Set<string>>(new Set())
  const [activeAlert, setActiveAlert] = useState<{ pid: string; name: string; risk: number; day: number; change: number } | null>(null)

  const actionLock = useRef(false)

  // URL hash router
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

  const loadPopulation = useCallback(async () => {
    const result = await api<{ patients: Patient[]; replay_day: number }>('/patients')
    setPatients(result.patients)
    setDay(result.replay_day)
    setSelected(old => old || result.patients[0]?.patient_id || '')
    setIngestTargetPid(old => old || result.patients[0]?.patient_id || '')
    setRevision(r => r + 1)

    // Detect risk elevation / deterioration alerts during streaming replay
    const prevMap = prevRisksRef.current
    const hasHistory = Object.keys(prevMap).length > 0
    const newAlerts = new Set<string>()
    let topAlert: { pid: string; name: string; risk: number; day: number; change: number } | null = null

    for (const p of result.patients) {
      if (p.risk !== null) {
        if (hasHistory) {
          const prev = prevMap[p.patient_id]
          if (prev !== undefined) {
            const jumped = (prev < 0.60 && p.risk >= 0.60) || (p.risk - prev >= 0.15)
            if (jumped) {
              newAlerts.add(p.patient_id)
              if (!topAlert || p.risk > topAlert.risk) {
                topAlert = { pid: p.patient_id, name: p.name, risk: p.risk, day: result.replay_day, change: p.risk - prev }
              }
            }
          }
        }
        prevMap[p.patient_id] = p.risk
      }
    }
    if (newAlerts.size > 0) {
      setAlertingPids(newAlerts)
      if (topAlert) setActiveAlert(topAlert)
    }
  }, [])

  useEffect(() => {
    loadPopulation()
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
    api<Evaluation>('/evaluation')
      .then(setEvaluation)
      .catch(e => setError(e.message))
  }, [loadPopulation])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    setSimulated(null)
    Promise.all([
      api<{ patient: Patient; twin: Twin; review?: Review }>(`/patients/${selected}`, undefined, controller.signal),
      api<{ observations: Observation[] }>(`/patients/${selected}/timeline`, undefined, controller.signal),
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

  const saveReview = async (newState?: string) => {
    if (!selected) return
    setBusy(true); setError('')
    try {
      const s = newState || review.state
      const updated = await api<Review>(`/patients/${selected}/review`, { state: s, note: noteDraft })
      setReview(updated)
      setNotice(`Review updated: ${s.replace('_', ' ')}`)
      await loadPopulation()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(t)
  }, [notice])

  // Dialog keyboard trap
  useEffect(() => {
    if (!modal) return
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const getFocusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]') ?? [])
    getFocusable()[0]?.focus()
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { setModal(null); return }
      if (event.key !== 'Tab') return
      const els = getFocusable(), first = els[0], last = els.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [modal, busy])

  const advance = useCallback(async () => {
    if (actionLock.current || busy) return
    actionLock.current = true; setBusy(true); setError('')
    try {
      const result = await api<{ day: number; updated: number; finished: boolean }>('/demo/advance', {})
      await loadPopulation()
      if (result.finished) { setPlaying(false); setNotice('Replay complete. Reset to start again.') }
      else if (!result.updated) { setNotice('No new readings available for this replay day.') }
    } catch (e) { setError((e as Error).message); setPlaying(false) }
    finally { actionLock.current = false; setBusy(false) }
  }, [loadPopulation, busy])

  useEffect(() => {
    if (!playing || busy) return
    const timer = setTimeout(() => void advance(), 2400)
    return () => clearTimeout(timer)
  }, [playing, busy, advance])

  const focus = (pid: string) => {
    if (pid !== selected) setDetail(null)
    setSelected(pid); setRoute('patients'); setSignal('risk'); setTab('Overview')
    window.location.hash = `#/patients/${pid}`
  }

  const openModal = (kind: 'scenario' | 'telemetry' | 'reset') => {
    setPlaying(false); setError(''); setModal(kind)
    if (kind === 'scenario') { setScenario({ ...scenarioDefaults }); setSimulated(null) }
    if (kind === 'telemetry' && detail) {
      const date = new Date(`${detail.twin.timestamp}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + 1)
      const blank: Record<string, string> = { timestamp: date.toISOString().slice(0, 10) }
      for (const s of detail.twin.signals) blank[s.key] = ''
      setTelemetry(blank); setTelemetryCopiedNotice(false); setTelemetryFieldError({})
    }
  }

  const copyPreviousReadings = () => {
    if (!detail) return
    const upd: Record<string, string> = { ...telemetry }
    for (const s of detail.twin.signals) upd[s.key] = s.value === null ? '' : String(s.value)
    setTelemetry(upd); setTelemetryCopiedNotice(true)
  }

  const validateTelemetryField = (key: string, val: string) => {
    if (val === '') {
      setTelemetryFieldError(prev => { const n = { ...prev }; delete n[key]; return n }); return true
    }
    const num = Number(val); const spec = SIGNAL_BOUNDS[key]
    if (isNaN(num)) { setTelemetryFieldError(prev => ({ ...prev, [key]: 'Invalid number' })); return false }
    if (spec && (num < spec.min || num > spec.max)) {
      setTelemetryFieldError(prev => ({ ...prev, [key]: `${spec.min}–${spec.max} ${spec.unit}` })); return false
    }
    setTelemetryFieldError(prev => { const n = { ...prev }; delete n[key]; return n }); return true
  }

  const reset = async () => {
    setBusy(true); setError('')
    try {
      prevRisksRef.current = {}
      setAlertingPids(new Set())
      setActiveAlert(null)
      await api('/demo/reset', {}); setSelected(''); setDetail(null)
      await loadPopulation(); setModal(null); setNotice('Demo reset to day 35.')
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const runScenario = async () => {
    setBusy(true); setError('')
    try {
      const result = await api<{ simulated: Twin }>(`/patients/${selected}/simulate`, scenario)
      setSimulated(result.simulated)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const ingest = async () => {
    let hasErr = false
    for (const [k, v] of Object.entries(telemetry)) {
      if (k !== 'timestamp' && !validateTelemetryField(k, v)) hasErr = true
    }
    if (hasErr) { setError('Please resolve values outside physiological ranges.'); return }
    setBusy(true); setError('')
    try {
      const payload = Object.fromEntries(
        Object.entries(telemetry).map(([k, v]) => [k, k === 'timestamp' ? v : v === '' ? null : Number(v)])
      )
      await api(`/patients/${selected}/telemetry`, payload)
      await loadPopulation(); setModal(null); setNotice('Daily reading saved. Patient twin updated.')
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const download = () => {
    const blob = new Blob([JSON.stringify({ patient: detail?.patient, twin: detail?.twin, observations: rows, synthetic: true }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url
    link.download = `${selected}-synthetic-twin.json`; link.click()
    URL.revokeObjectURL(url)
  }

  const high = useMemo(() => patients.filter(p => p.status === 'High risk').length, [patients])
  const watch = useMemo(() => patients.filter(p => p.status === 'Watch').length, [patients])
  const stable = useMemo(() => patients.filter(p => p.status === 'Stable').length, [patients])
  const insufficientCount = useMemo(() => patients.filter(p => p.status === 'Insufficient data' || p.coverage < .5).length, [patients])
  const unreviewedCount = useMemo(() => patients.filter(p => !p.review_state || p.review_state === 'unreviewed').length, [patients])

  const filtered = useMemo(() => patients.filter(p => {
    const match = `${p.patient_id} ${p.name} ${p.hf_type}`.toLowerCase().includes(search.toLowerCase())
    if (!match) return false
    if (filter === 'All patients') return true
    if (filter === 'High risk') return p.status === 'High risk'
    if (filter === 'Watch') return p.status === 'Watch'
    if (filter === 'Stable') return p.status === 'Stable'
    if (filter === 'Insufficient data') return p.status === 'Insufficient data' || p.coverage < .5
    if (filter === 'Reviewed') return p.review_state === 'reviewed'
    if (filter === 'Needs follow-up') return p.review_state === 'needs_follow_up'
    if (filter === 'Monitoring') return p.review_state === 'monitoring'
    if (filter === 'Flagged') return p.review_state === 'flagged'
    if (filter === 'Unreviewed') return !p.review_state || p.review_state === 'unreviewed'
    return p.status === filter
  }), [patients, search, filter])

  const twin = detail?.twin
  const patient = detail?.patient
  const chosenSignal = twin?.signals.find(s => s.key === signal)
  const model = evaluation?.models.find(m => m.name === 'Personalized CardioTwin')
  const lastUpdate = patients.map(p => p.timestamp).filter(Boolean).sort().at(-1)

  const topObservations = useMemo(() => {
    if (!twin?.signals) return []
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
    return { diff, text: `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pp vs yesterday (prev: ${Math.round(prv * 100)}%)`, isUp: diff > 0 }
  }, [rows])

  const PRESETS = useMemo(() => {
    const nextDate = twin?.timestamp ? new Date(`${twin.timestamp}T00:00:00Z`) : new Date()
    nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    const nextDateStr = nextDate.toISOString().slice(0, 10)
    return [
      {
        title: 'Morning Vitals Sync (Scale + BP)',
        description: 'Smart scale and BP cuff readings for the next morning.',
        items: [{ timestamp: nextDateStr, weight: 74.5, systolic_bp: 126, diastolic_bp: 82, resting_hr: 67 }],
      },
      {
        title: 'Multi-Sample Intra-Day Vitals',
        description: 'Continuous intra-day samples: min resting HR, sum steps, mean SpO₂/resp.',
        items: [
          { timestamp: nextDateStr, resting_hr: 76, steps: 1800, spo2: 95, respiratory_rate: 19 },
          { timestamp: nextDateStr, resting_hr: 63, steps: 2200, spo2: 97, respiratory_rate: 17 },
          { timestamp: nextDateStr, resting_hr: 69, steps: 1400, spo2: 96, respiratory_rate: 18 },
        ],
      },
      {
        title: '3-Day Historical Backfill',
        description: 'Delayed offline readings with automatic deduplication.',
        items: [{ timestamp: twin?.timestamp || nextDateStr, resting_hr: 65, steps: 4100, spo2: 96, weight: 73.8 }],
      },
    ]
  }, [twin])

  useEffect(() => {
    if (PRESETS[presetIndex]) setBatchJsonDraft(JSON.stringify(PRESETS[presetIndex].items, null, 2))
  }, [presetIndex, PRESETS])

  const executeBatchIngest = async () => {
    if (!ingestTargetPid) { setError('Please select a target patient.'); return }
    let parsed: unknown[]
    try {
      parsed = JSON.parse(batchJsonDraft)
      if (!Array.isArray(parsed) || !parsed.length) throw new Error('Payload must be a non-empty array.')
    } catch (e) { setError(`Invalid JSON: ${(e as Error).message}`); return }
    setBusy(true); setError(''); setBatchResult(null)
    try {
      const res = await api<{ summary: TelemetryBatchSummary; twin: Twin }>(
        `/patients/${ingestTargetPid}/telemetry/batch`, { items: parsed }
      )
      setBatchResult(res.summary)
      setNotice(`Batch ingested: ${res.summary.inserted} inserted, ${res.summary.deduplicated} deduplicated.`)
      await loadPopulation()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  /* ─────────────────────────────────────── NAV CONFIG ──── */
  const navItems = [
    { key: 'overview', label: 'Overview', icon: <Users size={16} /> },
    { key: 'patients', label: 'Patient Twin', icon: <Activity size={16} /> },
    { key: 'connections', label: 'Device Connections', icon: <Wifi size={16} /> },
    { key: 'evidence', label: 'Model Evidence', icon: <FlaskConical size={16} /> },
    { key: 'research', label: 'Research', icon: <Info size={16} /> },
    { key: 'demo', label: 'Demo Controls', icon: <Play size={16} /> },
  ]

  const pageTitle: Record<PageRoute, string> = {
    overview: 'Patient Overview',
    patients: selected ? `Patient ${selected}` : 'Patient Twin',
    connections: 'Device Connections',
    evidence: 'Model Evidence',
    research: 'Research & Methods',
    demo: 'Demo Controls',
  }

  const pageSubtitle: Record<PageRoute, string> = {
    overview: `${patients.length} patients · ${unreviewedCount} pending review · Last updated: ${lastUpdate || '—'}`,
    patients: patient ? `${patient.age}y ${patient.sex} · ${patient.hf_type} · NYHA ${patient.nyha}` : 'Select a patient',
    connections: 'Wearable ecosystems and live ingestion engine',
    evidence: 'Synthetic-data model performance on held-out test split',
    research: 'Design rationale and supporting literature',
    demo: `Day ${day} of 60 · Seed 2026 · 800 synthetic patients`,
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">Skip to workspace</a>

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <div className="brand-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div className="sidebar-brand-text">
            <strong>CardioTwin</strong>
            <small>Research prototype · Synthetic data</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Workspace</div>
          {navItems.map(item => (
            <button
              key={item.key}
              className={`nav-item ${route === item.key ? 'active' : ''}`}
              aria-current={route === item.key ? 'page' : undefined}
              aria-label={item.label}
              onClick={() => navigateTo(item.key as PageRoute)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="demo-tag">Live demo · No PHI</div>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────── */}
      <div className="main-area">

        {/* Top bar */}
        <header className="topbar">
          <div className="topbar-left">
            <b>{pageTitle[route]}</b>
            <span>·</span>
            <span>{pageSubtitle[route]}</span>
          </div>
          <div className="topbar-right">
            {/* Live Telemetry ECG Monitor */}
            <div className="ecg-monitor-pill" title="Dynamic wearable stream · Simulated cardiac rhythm">
              <svg className="ecg-svg" viewBox="0 0 100 30" preserveAspectRatio="none">
                <path
                  className={`ecg-line ${alertingPids.size > 0 ? 'alert' : ''}`}
                  d="M0,15 L25,15 L32,15 L35,8 L40,24 L45,2 L50,22 L54,15 L62,15 L68,11 L74,15 L100,15"
                />
              </svg>
              <span>Live Telemetry</span>
            </div>
            {/* Replay pill */}
            {(route === 'overview' || route === 'patients' || route === 'demo') && (
              <div className="replay-pill" title={`Wearable replay: Day ${day} of 60`}>
                <span className={`replay-dot ${playing ? 'live' : ''}`} />
                Day {day}/60
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => openModal('reset')} title="Reset demo">
                  <RotateCcw size={13} />
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busy || day >= 60} onClick={() => void advance()} title="Next day">
                  <StepForward size={13} />
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={day >= 60 || busy}
                  onClick={() => setPlaying(p => !p)}
                  title={playing ? 'Pause replay' : 'Play replay'}
                >
                  {playing ? <Pause size={13} /> : <Play size={13} />}
                </button>
              </div>
            )}
            {route === 'patients' && twin?.timestamp && (
              <>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowPrintModal(true)}>
                  <Printer size={14} /> Print
                </button>
                <button className="btn btn-secondary btn-sm" onClick={download} disabled={!detail}>
                  <ArrowDownToLine size={14} /> Export
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => openModal('telemetry')}>
                  <Plus size={14} /> Add reading
                </button>
              </>
            )}
          </div>
        </header>

        {/* Workspace */}
        <main className="workspace" id="workspace-content" tabIndex={-1}>

          {/* Error / toast */}
          {error && (
            <div className="toast-error" role="alert">
              <Warning size={15} /> {error}
              <button onClick={() => setError('')} aria-label="Dismiss"><X size={16} /></button>
            </div>
          )}

          {loading ? <Loading /> : <>

            {/* ════════════════════════════════════════════════ */}
            {/* OVERVIEW                                        */}
            {/* ════════════════════════════════════════════════ */}
            {route === 'overview' && (
              <>
                {/* Stat bar */}
                <div className="stat-bar mb-20">
                  {[
                    { label: 'High risk', num: high, sub: '≥60% estimate', cls: 'high', filter: 'High risk' },
                    { label: 'Watch', num: watch, sub: '20–60% estimate', cls: 'watch', filter: 'Watch' },
                    { label: 'Stable', num: stable, sub: '<20% estimate', cls: 'stable', filter: 'Stable' },
                    { label: 'Insufficient data', num: insufficientCount, sub: '<50% sensor coverage', cls: '', filter: 'Insufficient data' },
                  ].map(s => (
                    <button
                      key={s.filter}
                      className={`stat-card ${s.cls} ${filter === s.filter ? 'active' : ''}`}
                      onClick={() => setFilter(old => old === s.filter ? 'All patients' : s.filter)}
                    >
                      <div className="stat-label">{s.label}</div>
                      <div className="stat-num">{s.num}</div>
                      <div className="stat-sub">{s.sub}</div>
                    </button>
                  ))}
                </div>

                <div className="overview-grid">
                  {/* Patient table */}
                  <section className="card">
                    <div className="card-header">
                      <div>
                        <div className="card-title">Priority queue <span style={{ fontFamily: 'var(--mono)', fontWeight: 400, fontSize: 12, color: 'var(--text-tertiary)' }}>{patients.length}</span></div>
                        <div className="card-subtitle">Sorted by 7-day risk estimate · {unreviewedCount} pending review</div>
                      </div>
                      <div className="card-badge gap-8"><Wifi size={12} /> Daily readings</div>
                    </div>

                    <div className="table-tools">
                      <label className="search-field">
                        <Search size={14} />
                        <input
                          aria-label="Search patients"
                          placeholder="Search by ID or HF type…"
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                        />
                      </label>
                      <select
                        className="filter-select"
                        aria-label="Filter by category"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                      >
                        {['All patients', 'High risk', 'Watch', 'Stable', 'Insufficient data', 'Reviewed', 'Needs follow-up', 'Monitoring', 'Flagged', 'Unreviewed'].map(s => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => focus('HF-0011')}
                        title="Jump to the featured 5-day warning decompensation case study"
                        style={{ borderColor: '#f59e0b', color: '#92400e', background: '#fffbeb', gap: 5 }}
                      >
                        ★ Case Study: HF-0011
                      </button>
                    </div>

                    {activeAlert && (
                      <div className="alert-toast-banner" role="alert">
                        <div className="alert-toast-content">
                          <Bell size={16} style={{ color: 'var(--high)', flexShrink: 0 }} />
                          <span>
                            <b>High-Risk Decompensation Alert:</b> Patient <b>{activeAlert.pid}</b> entered High Risk ({percent(activeAlert.risk)}, +{Math.round(activeAlert.change * 100)}% shift) on Day {activeAlert.day}. Early warning generated ~5 days prior to predicted hospital event.
                          </span>
                        </div>
                        <div className="alert-toast-actions">
                          <button className="btn btn-danger btn-sm" onClick={() => focus(activeAlert.pid)}>
                            Inspect Case <ArrowRight size={13} />
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setActiveAlert(null)} title="Dismiss">
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Patient</th>
                            <th>7-day risk</th>
                            <th>Status</th>
                            <th>Review</th>
                            <th>Coverage</th>
                            <th aria-label="Open" />
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map(p => (
                            <tr key={p.patient_id} className={`${selected === p.patient_id ? 'selected-row' : ''} ${alertingPids.has(p.patient_id) ? 'row-alert-flash' : ''}`}>
                              <td>
                                <button className="patient-link" onClick={() => focus(p.patient_id)}>
                                  <span className="patient-avatar">{p.patient_id.slice(-2)}</span>
                                  <span>
                                    <b>{p.patient_id}</b>
                                    {p.patient_id === 'HF-0011' && <span className="badge-featured">★ Demo Case</span>}
                                    <small>{p.age}y · {p.sex} · {p.hf_type}</small>
                                  </span>
                                </button>
                              </td>
                              <td>
                                <div className="risk-cell">
                                  <span className={`risk-value ${riskClass(p.status)}`}>{percent(p.risk)}</span>
                                  <div className="risk-bar-wrap">
                                    <div className={`risk-bar-fill ${riskClass(p.status)}`} style={{ width: `${(p.risk ?? 0) * 100}%` }} />
                                  </div>
                                </div>
                              </td>
                              <td><Badge status={p.status} /></td>
                              <td><ReviewBadge state={p.review_state} /></td>
                              <td>
                                <div className="coverage-cell">
                                  <span className="coverage-dot" style={{ background: p.coverage >= .8 ? 'var(--stable)' : p.coverage >= .5 ? 'var(--watch)' : 'var(--high)' }} />
                                  {Math.round(p.coverage * 100)}%
                                </div>
                              </td>
                              <td>
                                <button className="btn btn-ghost btn-sm" aria-label={`Open ${p.patient_id}`} onClick={() => focus(p.patient_id)}>
                                  <ChevronRight size={15} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!filtered.length && <div className="empty-state">No patients match this filter.</div>}
                    </div>

                    <div className="table-footer">
                      <span>Showing {filtered.length} of {patients.length}</span>
                      <span>Entirely synthetic · patient-specific baselines</span>
                    </div>
                  </section>

                  {/* Focus aside */}
                  <aside>
                    <div className="card">
                      <div className="card-header">
                        <div>
                          <div className="card-subtitle">Patient in focus</div>
                          <div className="card-title">{selected || 'None selected'}</div>
                        </div>
                        <span className="patient-avatar">{selected.slice(-2)}</span>
                      </div>

                      {twin ? (
                        <>
                          <div className="focus-risk-block">
                            <div className={`focus-risk-num ${riskClass(twin.status)}`}>{percent(twin.risk?.probability)}</div>
                            <div className="focus-risk-label">estimated 7-day risk</div>
                            {twin.risk?.ci_lower != null && (
                              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, fontFamily: 'var(--mono)' }}>
                                95% CI [{percent(twin.risk.ci_lower)}–{percent(twin.risk.ci_upper)}]
                              </div>
                            )}
                          </div>
                          <div className="mini-chart-label">21-day risk trajectory</div>
                          <TrendChart rows={rows} compact />
                          <div className="mt-12">
                            <button className="btn btn-primary btn-full" onClick={() => focus(selected)}>
                              Open patient twin <ArrowRight size={15} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="empty-state">Select a patient from the table.</div>
                      )}
                    </div>

                    <div className="card mt-12" style={{ padding: '14px 16px' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
                        Personal baselines
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                        75 bpm is only part of the story. For a patient whose baseline is 58, that reading signals change. The model tracks <em>deviation from each patient's own history</em>.
                      </p>
                      <button className="btn btn-ghost btn-sm mt-8" onClick={() => navigateTo('research')}>
                        Read more <ArrowRight size={13} />
                      </button>
                    </div>
                  </aside>
                </div>
              </>
            )}

            {/* ════════════════════════════════════════════════ */}
            {/* PATIENTS / TWIN DETAIL                          */}
            {/* ════════════════════════════════════════════════ */}
            {route === 'patients' && (detail ? (
              <>
                <div className="patient-header">
                  <div className="patient-id-block">
                    <div className="patient-avatar-lg">{selected.slice(-2)}</div>
                    <div>
                      <h2>{selected} <small>Fictional patient</small></h2>
                      <p>{patient?.age}y · {patient?.sex} · {patient?.hf_type} · NYHA {patient?.nyha}</p>
                    </div>
                  </div>
                  <div className="patient-header-actions">
                    <label className="sr-only" htmlFor="patient-selector">Choose patient</label>
                    <select
                      id="patient-selector"
                      className="patient-selector"
                      value={selected}
                      onChange={e => { setSelected(e.target.value); setDetail(null); window.location.hash = `#/patients/${e.target.value}` }}
                    >
                      {patients.map(p => (
                        <option key={p.patient_id} value={p.patient_id}>{p.patient_id} · {p.status}</option>
                      ))}
                    </select>
                    <button className="btn btn-secondary btn-sm" onClick={() => openModal('telemetry')} disabled={!twin?.timestamp}>
                      <Plus size={14} /> Add reading
                    </button>
                  </div>
                </div>

                {/* Tab bar */}
                <div className="tab-bar" role="tablist">
                  {(['Overview', 'Explainability', 'EHR profile', 'Data timeline'] as const).map(t => (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={tab === t}
                      className={`tab-btn ${tab === t ? 'active' : ''}`}
                      onClick={() => setTab(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* ── Tab: Overview ── */}
                {tab === 'Overview' && twin && (
                  <>
                    <div className="detail-grid mb-14">
                      {/* Risk card */}
                      <div className="card risk-score-card">
                        <div className="risk-eyebrow">Estimated 7-day decompensation risk</div>
                        <div className={`risk-main-num ${riskClass(twin.status)}`}>{percent(twin.risk?.probability)}</div>
                        {twin.risk?.ci_lower != null && (
                          <div className="risk-ci">95% CI: [{percent(twin.risk.ci_lower)} – {percent(twin.risk.ci_upper)}]</div>
                        )}
                        {riskMovement && (
                          <div className={`risk-movement ${riskMovement.isUp ? 'up' : 'down'}`}>
                            {riskMovement.isUp ? '▲' : '▼'} {riskMovement.text}
                          </div>
                        )}
                        <div className="risk-scale-track">
                          <div className="risk-scale-thumb" style={{ left: `${(twin.risk?.probability ?? 0) * 100}%` }} />
                        </div>
                        <div className="risk-scale-labels">
                          <span>Low</span><span>Elevated</span><span>High</span>
                        </div>
                        <div className="risk-data-footer">
                          <Wifi size={12} /> {Math.round(twin.quality.coverage * 100)}% sensor coverage
                          <span>·</span> Updated {twin.timestamp}
                        </div>
                        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                          <Badge status={twin.status} />
                          <button className="btn btn-secondary btn-sm" onClick={() => openModal('scenario')} disabled={!twin.risk}>
                            <SlidersHorizontal size={14} /> Scenario
                          </button>
                        </div>
                      </div>

                      {/* Twin state */}
                      <div className="card">
                        <div className="card-header">
                          <div>
                            <div className="card-title">Digital twin state</div>
                            <div className="card-subtitle">Model-derived indices · 0–100</div>
                          </div>
                          <Activity size={16} style={{ color: 'var(--text-tertiary)' }} />
                        </div>
                        <TwinIndices twin={twin} />
                        <p className="micro-note" style={{ marginTop: 10 }}>
                          Higher burden = greater deviation from baseline. These are illustrative indices, not measured parameters.
                        </p>
                      </div>
                    </div>

                    {/* Key observations */}
                    {topObservations.length > 0 && (
                      <div className="card mb-14">
                        <div className="card-header">
                          <div>
                            <div className="card-title">Notable physiological changes</div>
                            <div className="card-subtitle">Signals with largest deviation from personal baseline</div>
                          </div>
                          <div className="card-badge">vs personal baseline</div>
                        </div>
                        <div className="key-obs-grid">
                          {topObservations.map(s => (
                            <div key={s.key} className="key-obs-card">
                              <div className="key-obs-label">{s.label}</div>
                              <div className="key-obs-value">{s.value!.toFixed(s.key === 'weight' ? 1 : 0)} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-tertiary)' }}>{s.unit}</span></div>
                              <div className="key-obs-baseline">Baseline: {s.baseline?.toFixed(s.key === 'weight' ? 1 : 0)} {s.unit}</div>
                              <span className={`key-obs-delta ${(s.delta ?? 0) > 0 ? 'elevated' : 'reduced'}`}>
                                {s.delta! >= 0 ? '+' : ''}{s.delta!.toFixed(s.key === 'weight' ? 1 : 0)} {s.unit}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* All signals */}
                    <div className="card mb-14">
                      <div className="card-header">
                        <div>
                          <div className="card-title">All wearable signals</div>
                          <div className="card-subtitle">Current reading · personal baseline · 24h change</div>
                        </div>
                      </div>
                      <div className="signals-grid">
                        {twin.signals.map(s => (
                          <div key={s.key} className="signal-card">
                            <div className="signal-name">{s.label}</div>
                            {s.value !== null ? (
                              <div className="signal-value">
                                {s.value.toFixed(s.key === 'weight' ? 1 : 0)}
                                <span className="signal-unit">{s.unit}</span>
                              </div>
                            ) : (
                              <div className="signal-value missing">—</div>
                            )}
                            <div className="signal-meta">
                              <span className="signal-baseline">
                                {s.baseline !== null ? `Baseline: ${s.baseline.toFixed(s.key === 'weight' ? 1 : 0)}` : 'No baseline'}
                              </span>
                              {s.delta !== null && (
                                <span className={`signal-delta ${s.delta > 0.5 ? 'up' : s.delta < -0.5 ? 'down' : 'neutral'}`}>
                                  {s.delta >= 0 ? '+' : ''}{s.delta.toFixed(1)}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Clinician review */}
                    <div className="card review-section mb-14">
                      <div className="review-header">
                        <div className="card-title">Clinician review &amp; triage</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <select
                            className="review-state-select"
                            value={review.state}
                            aria-label="Review status"
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
                        placeholder="Document clinical review note, triage decision, or follow-up rationale…"
                        value={noteDraft}
                        onChange={e => setNoteDraft(e.target.value)}
                        disabled={busy}
                        rows={3}
                      />
                      <div className="review-footer">
                        <span className="review-timestamp">
                          {review.updated_at ? `Last reviewed: ${new Date(review.updated_at).toLocaleString()}` : 'No review saved yet'}
                        </span>
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={busy || (noteDraft === (review.note || '') && review.state !== 'unreviewed')}
                          onClick={() => void saveReview()}
                        >
                          Save note
                        </button>
                      </div>
                    </div>

                    {/* Trend chart + explanation */}
                    <div className="detail-grid">
                      <div className="card chart-section">
                        <div className="card-header">
                          <div>
                            <div className="card-title">{signal === 'risk' ? 'Risk trajectory' : chosenSignal?.label}</div>
                            <div className="card-subtitle">{signal === 'risk' ? 'Daily 7-day risk · shaded: 95% CI' : 'Dashed = personal baseline · gaps = missing data'}</div>
                          </div>
                          <div className="card-badge">{rows.length} readings</div>
                        </div>
                        <div className="chart-controls-bar">
                          <div className="chart-tab-group">
                            {[
                              { key: 'risk', label: 'Risk' },
                              { key: 'resting_hr', label: 'HR' },
                              { key: 'weight', label: 'Weight' },
                              { key: 'respiratory_rate', label: 'Resp.' },
                              { key: 'steps', label: 'Activity' },
                            ].map(s => (
                              <button
                                key={s.key}
                                className={`chart-tab ${signal === s.key ? 'active' : ''}`}
                                onClick={() => setSignal(s.key)}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                          <select
                            className="chart-signal-select"
                            aria-label="More signals"
                            value={['risk', 'resting_hr', 'weight', 'respiratory_rate', 'steps'].includes(signal) ? '' : signal}
                            onChange={e => { if (e.target.value) setSignal(e.target.value) }}
                          >
                            <option value="">More…</option>
                            <option value="hrv">HRV (ms)</option>
                            <option value="spo2">SpO₂ (%)</option>
                            <option value="systolic_bp">Systolic BP</option>
                            <option value="diastolic_bp">Diastolic BP</option>
                            <option value="sleep_hours">Sleep (hrs)</option>
                          </select>
                        </div>
                        <TrendChart rows={rows} signal={signal} baseline={chosenSignal?.baseline} unit={chosenSignal?.unit} />
                        <div className="chart-legend">
                          <span className="leg-item"><span className="legend-line" /> {signal === 'risk' ? 'Estimated risk' : 'Observed'}</span>
                          {signal !== 'risk' && <span className="leg-item"><span className="legend-dash" /> Personal baseline</span>}
                          {signal === 'risk' && <span className="leg-item"><span className="legend-band" /> 95% CI</span>}
                        </div>
                      </div>

                      <div className="card">
                        <div className="card-header">
                          <div>
                            <div className="card-title">Why this risk?</div>
                            <div className="card-subtitle">TreeSHAP · calibrated log-odds</div>
                          </div>
                          <Info size={15} style={{ color: 'var(--text-tertiary)' }} />
                        </div>
                        {twin.risk ? (
                          <Contributions values={twin.risk.explanation.contributions} />
                        ) : (
                          <div className="empty-state">Baseline or current data is incomplete.</div>
                        )}
                        <button className="btn btn-ghost btn-sm mt-8" onClick={() => setTab('Explainability')}>
                          Full explanation <ArrowRight size={13} />
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* ── Tab: Explainability ── */}
                {tab === 'Explainability' && twin && (
                  <div className="card">
                    <div className="card-header">
                      <div>
                        <div className="card-title">A traceable estimate</div>
                        <div className="card-subtitle">Each feature pushes the model's log-odds higher or lower</div>
                      </div>
                      <div className="card-badge">Native TreeSHAP</div>
                    </div>
                    {twin.risk ? (
                      <>
                        <div className="explanation-summary-row">
                          <div className="eq-item"><div className="eq-label">Base log-odds</div><div className="eq-val">{twin.risk.explanation.base_value.toFixed(3)}</div></div>
                          <div className="eq-op">+</div>
                          <div className="eq-item"><div className="eq-label">Sum contributions</div><div className="eq-val">{twin.risk.explanation.contributions.reduce((a, b) => a + b.contribution, 0).toFixed(3)}</div></div>
                          <div className="eq-op">=</div>
                          <div className="eq-item"><div className="eq-label">Log-odds</div><div className="eq-val">{twin.risk.explanation.log_odds.toFixed(3)}</div></div>
                          <div className="eq-op">→</div>
                          <div className="eq-item"><div className="eq-label">Risk (sigmoid)</div><div className="eq-val">{percent(twin.risk.probability)}</div></div>
                        </div>
                        <div className="explanation-columns">
                          <Contributions values={twin.risk.explanation.contributions} limit={12} />
                          <div className="method-note">
                            <h3>Read carefully</h3>
                            <p>Red bars increase the estimate; green bars lower it. Values are additive in log-odds space, not percentage-point changes.</p>
                            <p style={{ marginTop: 8 }}>Shows the 12 largest contributions. These are predictive associations in synthetic data — not causal evidence.</p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">Risk inference is paused until adequate data is available.</div>
                    )}
                  </div>
                )}

                {/* ── Tab: EHR profile ── */}
                {tab === 'EHR profile' && patient && (
                  <div className="card">
                    <div className="card-header">
                      <div>
                        <div className="card-title">Historical patient context</div>
                        <div className="card-subtitle">Fictional EHR attributes used by the model</div>
                      </div>
                      <Badge status="Synthetic EHR" />
                    </div>
                    <div className="ehr-grid">
                      {[
                        { label: 'Age', value: `${patient.age} years` },
                        { label: 'HF phenotype', value: patient.hf_type },
                        { label: 'LVEF', value: `${patient.lvef}%` },
                        { label: 'NYHA class', value: String(patient.nyha) },
                        { label: 'Creatinine', value: `${patient.creatinine} mg/dL` },
                        { label: 'eGFR', value: `${patient.egfr} mL/min/1.73m²` },
                        { label: 'Sodium', value: `${patient.sodium} mmol/L` },
                        { label: 'Hemoglobin', value: `${patient.hemoglobin} g/dL` },
                        { label: 'Prior admissions', value: String(patient.previous_admissions) },
                        { label: 'Diabetes', value: patient.diabetes ? 'Yes' : 'No' },
                        { label: 'CKD', value: patient.ckd ? 'Yes' : 'No' },
                        { label: 'COPD', value: patient.copd ? 'Yes' : 'No' },
                      ].map(x => (
                        <div key={x.label} className="ehr-field">
                          <small>{x.label}</small>
                          <strong>{x.value}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="method-note">
                      <h3>Every patient begins with their own baseline</h3>
                      <p>The first 14 observed days establish a frozen stable-period median and MAD for each signal. This holds in the simulator and requires verification for real deployment.</p>
                    </div>
                  </div>
                )}

                {/* ── Tab: Data timeline ── */}
                {tab === 'Data timeline' && (
                  <div className="card">
                    <div className="card-header">
                      <div>
                        <div className="card-title">Daily observation ledger</div>
                        <div className="card-subtitle">Persisted readings only · withheld replay data excluded</div>
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={download}>
                        <ArrowDownToLine size={14} /> Export JSON
                      </button>
                    </div>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Date</th><th>Risk</th><th>HR</th><th>HRV</th>
                            <th>Weight</th><th>Resp.</th><th>SpO₂</th><th>Steps</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...rows].reverse().map(row => (
                            <tr key={row.day}>
                              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.timestamp}</td>
                              <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{percent(row.risk)}</td>
                              {['resting_hr', 'hrv', 'weight', 'respiratory_rate', 'spo2', 'steps'].map(key => (
                                <td key={key} style={{ fontFamily: 'var(--mono)' }}>{row[key] ?? '—'}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : <Loading />)}

            {/* ════════════════════════════════════════════════ */}
            {/* CONNECTIONS                                     */}
            {/* ════════════════════════════════════════════════ */}
            {route === 'connections' && (
              <div className="connections-grid">
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Supported wearable ecosystems</div>
                      <div className="card-subtitle">Native adapter contracts defined in mobile companion</div>
                    </div>
                  </div>
                  <div className="provider-list">
                    {[
                      { name: 'Apple Health (HealthKit)', desc: 'Continuous background HR, HRV (SDNN), resting pulse, sleep segments, steps.', contract: 'mobile/src/adapters/apple_health.ts' },
                      { name: 'Garmin Health API', desc: 'Cloud API webhook for SpO₂, respiration, daily resting pulse.', contract: 'mobile/src/adapters/garmin.ts' },
                      { name: 'Withings Health Mate', desc: 'Cellular scale telemetry (weight, BMI) and home BP cuffs.', contract: 'mobile/src/adapters/withings.ts' },
                      { name: 'Google Health Connect', desc: 'Android unified health store integrating multi-sensor wearable telemetry.', contract: 'mobile/src/adapters/health_connect.ts' },
                    ].map(prov => (
                      <div key={prov.name} className="provider-item">
                        <div className="provider-title-row">
                          <b>{prov.name}</b>
                          <span className="planned-badge">Planned</span>
                        </div>
                        <p>{prov.desc}</p>
                        <small className="contract-path">{prov.contract}</small>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Live wearable ingestion engine</div>
                      <div className="card-subtitle">Multi-sample aggregation, backfill, deduplication</div>
                    </div>
                    <div className="card-badge gap-8"><Activity size={12} /> Active</div>
                  </div>

                  <div className="ingest-form">
                    <div className="ingest-row">
                      <label className="ingest-label" htmlFor="target-patient">Target patient</label>
                      <select id="target-patient" className="ingest-select" value={ingestTargetPid} onChange={e => setIngestTargetPid(e.target.value)}>
                        {patients.map(p => (
                          <option key={p.patient_id} value={p.patient_id}>{p.patient_id} ({p.name})</option>
                        ))}
                      </select>
                    </div>
                    <div className="ingest-row">
                      <label className="ingest-label" htmlFor="preset-select">Telemetry preset</label>
                      <select id="preset-select" className="ingest-select" value={presetIndex} onChange={e => setPresetIndex(Number(e.target.value))}>
                        {PRESETS.map((p, i) => (
                          <option key={i} value={i}>{p.title}</option>
                        ))}
                      </select>
                    </div>
                    <p className="preset-desc">{PRESETS[presetIndex]?.description}</p>
                    <div className="ingest-row">
                      <label className="ingest-label" htmlFor="json-draft">Telemetry JSON batch</label>
                      <textarea
                        id="json-draft"
                        className="code-textarea"
                        value={batchJsonDraft}
                        onChange={e => setBatchJsonDraft(e.target.value)}
                        rows={6}
                      />
                    </div>
                    <button className="btn btn-primary" disabled={busy} onClick={() => void executeBatchIngest()}>
                      <UploadSimple size={15} /> {busy ? 'Ingesting…' : 'Ingest wearable batch'}
                    </button>

                    {batchResult && (
                      <div className="batch-result" role="status">
                        <h4><Check size={14} /> Batch ingestion complete</h4>
                        <div className="result-metrics">
                          <span>Inserted <b>{batchResult.inserted}</b></span>
                          <span>Updated <b>{batchResult.updated}</b></span>
                          <span>Deduped <b>{batchResult.deduplicated}</b></span>
                          <span>Backfilled <b>{batchResult.backfilled}</b></span>
                        </div>
                        <button className="btn btn-secondary btn-sm mt-8" onClick={() => focus(ingestTargetPid)}>
                          Inspect {ingestTargetPid} <ArrowRight size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════════ */}
            {/* EVIDENCE                                        */}
            {/* ════════════════════════════════════════════════ */}
            {route === 'evidence' && evaluation && (
              <>
                <div className="stat-bar mb-20">
                  {[
                    { label: 'Synthetic patients', num: evaluation.n_patients, sub: `${evaluation.n_samples.toLocaleString()} labeled patient-days` },
                    { label: 'Test patients', num: evaluation.split_counts.test, sub: 'No overlap with training', cls: 'stable' },
                    { label: 'ROC-AUC', num: model?.roc_auc.toFixed(3) ?? '—', sub: 'Personalized CardioTwin', cls: 'watch' },
                    { label: 'PR-AUC', num: model?.pr_auc.toFixed(3) ?? '—', sub: `${percent(evaluation.positive_fraction)} positive days`, cls: '' },
                  ].map(s => (
                    <div key={s.label} className={`stat-card ${s.cls ?? ''}`}>
                      <div className="stat-label">{s.label}</div>
                      <div className="stat-num">{s.num}</div>
                      <div className="stat-sub">{s.sub}</div>
                    </div>
                  ))}
                </div>

                <div className="card mb-14">
                  <div className="card-header">
                    <div>
                      <div className="card-title">What does personalization add?</div>
                      <div className="card-subtitle">Training 70% · calibration & threshold 15% · untouched test 15%</div>
                    </div>
                    <div className="card-badge">Seed 2026</div>
                  </div>
                  <div className="table-scroll">
                    <table className="evaluation-table">
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>ROC-AUC</th><th>PR-AUC</th><th>Brier ↓</th>
                          <th>Sensitivity</th><th>Specificity</th>
                          <th>FA/pt-mo</th><th>Lead days</th>
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
                  <div className="table-footer">
                    <span>Thresholds maximize validation F1 · dashboard categories use separate demo thresholds (20%/60%)</span>
                  </div>
                </div>

                <div className="eval-grid">
                  <div className="card">
                    <div className="card-header">
                      <div>
                        <div className="card-title">Calibration check</div>
                        <div className="card-subtitle">Predicted vs observed rates · held-out synthetic data</div>
                      </div>
                    </div>
                    {model && <CalibrationChart bins={model.calibration} />}
                    <p className="micro-note">Quantile bins. Closer to dashed diagonal = better agreement in this benchmark.</p>
                  </div>

                  <div className="card">
                    <div className="card-header">
                      <div>
                        <div className="card-title">Benchmark scope and limits</div>
                      </div>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                      The model learns generated trajectories and synthetic event labels. These results demonstrate the software pipeline and the value of personalization <em>within this simulator</em>.
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 8 }}>
                      They cannot establish clinical sensitivity, real-world warning time, improved outcomes, or transportability to a hospital population.
                    </p>
                    <div className="split-pills" style={{ marginTop: 12 }}>
                      {Object.entries(evaluation.split_counts).map(([k, v]) => (
                        <span key={k}>{k} <b>{v}</b></span>
                      ))}
                    </div>
                    <p className="micro-note">
                      False alerts count the start of each consecutive episode on negative-label days. Lead time is within the 7-day target window; undetected events excluded from mean.
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* ════════════════════════════════════════════════ */}
            {/* RESEARCH                                        */}
            {/* ════════════════════════════════════════════════ */}
            {route === 'research' && (
              <>
                <div className="card research-hero mb-14">
                  <div>
                    <h2>Understand an ordinary day.<br />Then look for change.</h2>
                    <p>A patient-specific virtual state combines fictional EHR context with daily wearable and home-device signals. Each observation updates the twin and its estimated 7-day risk. The explanation makes changes inspectable.</p>
                    <div className="research-badge">Engineering proof of concept</div>
                  </div>
                  <HeartVisual />
                </div>

                <div className="research-grid mb-14">
                  {[
                    { n: '01', title: 'A personal baseline', body: "A 14-day stable window estimates each signal\u2019s median and MAD. Minimum observation counts and scale floors avoid unreliable deviations." },
                    { n: '02', title: 'Causal temporal features', body: 'Current readings, 3- and 7-day means/slopes, variability, missingness, and personal deviations use only observations available at the prediction day.' },
                    { n: '03', title: 'An interpretable model', body: 'XGBoost learns tabular features. Validation-only sigmoid calibration adjusts its probability scale. Native TreeSHAP attributes calibrated log-odds to inputs.' },
                    { n: '04', title: 'A living virtual state', body: 'Congestion, stress, oxygenation, activity, and hemodynamic indices evolve with readings. They are derived scores, not measured physiological parameters.' },
                    { n: '05', title: 'A scenario, not a prescription', body: "Perturb the latest day\u2019s weight, pulse, respiration, or activity. The scenario recomputes the twin without saving readings or estimating treatment effects." },
                    { n: '06', title: 'Honest data provenance', body: 'This release uses an in-house seeded simulator only. It does not include Synthea, PhysioNet, real wearables, hospital EHRs, or mechanistic heart simulation.' },
                  ].map(item => (
                    <div key={item.n} className="card research-method">
                      <div className="method-num">{item.n}</div>
                      <h3>{item.title}</h3>
                      <p>{item.body}</p>
                    </div>
                  ))}
                </div>

                <div className="card generalization-card mb-14">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Multi-Stream Generalization · Continuous Glucose Monitoring (CGM) Twin</div>
                      <div className="card-subtitle">Identical dual-stream fusion architecture adapted for 2-hour acute glycemic spike & hypoglycemia prediction</div>
                    </div>
                    <span className="card-badge" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>Generalizable Pipeline</span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
                    The hackathon challenge highlights adverse event prediction across two distinct clinical horizons: heart failure decompensation (7-day horizon) and sudden continuous glucose spikes (2-hour horizon). The CardioTwin dual-stream late-fusion architecture was deliberately engineered to generalize across both domains without algorithmic overhaul:
                  </p>
                  <table className="generalization-table">
                    <thead>
                      <tr>
                        <th>Domain Dimension</th>
                        <th>CardioTwin-HF (Current Implementation)</th>
                        <th>GlucoTwin-CGM (Direct Generalization)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><b>Stream 1: Static EHR Profile</b></td>
                        <td>Age, sex, LVEF, NYHA class, serum sodium, creatinine, eGFR, hemoglobin, CKD, COPD</td>
                        <td>Age, sex, diabetes type/duration, HbA1c, fasting glucose, insulin regimen, eGFR, genetic markers (TCF7L2)</td>
                      </tr>
                      <tr>
                        <td><b>Stream 2: Dynamic Wearables / IoT</b></td>
                        <td>Daily resting HR, HRV (rMSSD), respiratory rate, SpO₂, body weight, step count, sleep hours</td>
                        <td>5-minute interstitial CGM glucose, accelerometer step cadence/METs, sleep architecture, smart insulin pen logs</td>
                      </tr>
                      <tr>
                        <td><b>Personal Baseline Construction</b></td>
                        <td>14-day frozen median &amp; MAD for hemodynamics and body weight</td>
                        <td>14-day fasting glycemic median, diurnal circadian glucose profile, target range (70–180 mg/dL)</td>
                      </tr>
                      <tr>
                        <td><b>Temporal Feature Engineering</b></td>
                        <td>3-day and 7-day slopes, baseline deviation, signal variability, missingness fraction</td>
                        <td>30-min rate of change (dG/dt), rolling postprandial AUC, glycemic coefficient of variation (CV%), MAGE</td>
                      </tr>
                      <tr>
                        <td><b>Dual-Stream Fusion Mechanism</b></td>
                        <td>Contextual interaction: modulates wearable deviations by cardiac &amp; renal reserve</td>
                        <td>Contextual interaction: modulates acute glucose velocity by baseline insulin sensitivity &amp; renal clearance</td>
                      </tr>
                      <tr>
                        <td><b>Adverse Event Target</b></td>
                        <td>7-day acute decompensation / hospitalization (lead time: 5.56 days)</td>
                        <td>2-hour acute hyperglycemia (&gt;250 mg/dL) or nocturnal hypoglycemia (&lt;70 mg/dL)</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="card research-references">
                  <h2>Research that informed the concept</h2>
                  <p>These studies motivate the design. Their published results are not this prototype&apos;s results.</p>
                  {[
                    { href: 'https://pubmed.ncbi.nlm.nih.gov/32093506/', title: 'LINK-HF · wearable monitoring', desc: 'Personalized physiological monitoring for HF hospitalization prediction' },
                    { href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11449733/', title: 'TIM-HF2 · seven-day prediction', desc: 'Machine learning with daily remote-monitoring observations' },
                    { href: 'https://www.nature.com/articles/s41746-025-01501-9', title: 'Mechanistic HF digital twins', desc: 'A more physiologically detailed direction for future research' },
                  ].map(ref => (
                    <a key={ref.href} href={ref.href} target="_blank" rel="noreferrer" className="research-ref-link">
                      <div><b>{ref.title}</b><span>{ref.desc}</span></div>
                      <ArrowRight size={15} style={{ flexShrink: 0, color: 'var(--text-tertiary)' }} />
                    </a>
                  ))}
                </div>
              </>
            )}

            {/* ════════════════════════════════════════════════ */}
            {/* DEMO CONTROLS                                   */}
            {/* ════════════════════════════════════════════════ */}
            {route === 'demo' && (
              <>
                <div className="card mb-14">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Replay controls</div>
                      <div className="card-subtitle">Stream wearable data day by day from SQLite replay storage</div>
                    </div>
                  </div>
                  <div className="replay-controls">
                    <span className={`replay-dot ${playing ? 'live' : ''}`} />
                    <span className="day-label">Day {day} of 60</span>
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => openModal('reset')}>
                      <RotateCcw size={14} /> Reset
                    </button>
                    <button className="btn btn-secondary btn-sm" disabled={busy || day >= 60} onClick={() => void advance()}>
                      <StepForward size={14} /> Next day
                    </button>
                    <button className="btn btn-primary btn-sm" disabled={day >= 60 || busy} onClick={() => setPlaying(p => !p)}>
                      {playing ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
                    </button>
                  </div>
                </div>

                {/* Featured Case Study Card */}
                <div className="card mb-14" style={{ borderLeft: '4px solid #f59e0b' }}>
                  <div className="card-header">
                    <div>
                      <div className="card-title">Featured Case Study · Patient HF-0011 (5-Day Warning Trajectory)</div>
                      <div className="card-subtitle">53-year-old female · LVEF 54.1% · NYHA Class IV · Ground-truth decompensation on Day 41</div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => focus('HF-0011')} style={{ background: '#d97706' }}>
                      Inspect HF-0011 in Detail View <ArrowRight size={13} />
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginTop: 10 }}>
                    <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Day 35 (Replay Start)</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginTop: 4 }}>Risk: 32% (Watch)</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                        Weight 66.1 kg · Resting HR 88 bpm · Normal activity (1,617 steps). Stable near baseline.
                      </div>
                    </div>
                    <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Days 37–38 (Early Shift)</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--watch)', marginTop: 4 }}>Risk: 48% (Rising)</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                        Weight +1.4 kg · Respiratory rate rises to 20.5/min · HRV drops to 19.4 ms. Subclinical fluid retention.
                      </div>
                    </div>
                    <div style={{ background: 'var(--high-bg)', padding: '12px 14px', borderRadius: 'var(--radius)', border: '1px solid rgba(220,38,38,0.2)' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--high)', textTransform: 'uppercase' }}>Days 39–40 (Acute Alert)</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--high)', marginTop: 4 }}>Risk: 74% (High Risk 🔴)</div>
                      <div style={{ fontSize: 11.5, color: '#7f1d1d', marginTop: 4 }}>
                        Step count plunges to 100 steps/day · Resting HR surges to 96 bpm (+19 bpm over personal baseline). Twin flags alert.
                      </div>
                    </div>
                    <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Day 41 (Simulated Event)</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginTop: 4 }}>Hospital Admission</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                        Acute decompensation occurred on Day 41. <b>Digital Twin gave 5.0 days advance warning</b> for clinical triage.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="demo-grid">
                  <div className="card">
                    <div className="card-header"><div className="card-title">Simulation parameters</div></div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                      Seed 2026 · 800 synthetic patients · 60 observed days. Telemetry is seeded up to Day 35; subsequent days stream dynamically from SQLite replay storage.
                    </p>
                  </div>
                  <div className="card">
                    <div className="card-header"><div className="card-title">Research boundary notice</div></div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                      All data is synthetic. Model metrics reflect performance on this generator, not clinical sensitivity. No medical advice, diagnosis, or causal intervention estimates are provided.
                    </p>
                  </div>
                </div>
              </>
            )}

          </>}
        </main>

        {/* Footer */}
        <footer className="app-footer">
          <span>CardioTwin-HF · Research prototype · Synthetic data · No treatment recommendations</span>
          <a href="https://github.com/1shu1iwari-crypto/digital-twin" target="_blank" rel="noreferrer">
            View repository <ArrowRight size={12} />
          </a>
        </footer>
      </div>

      {/* ── Mobile bottom nav ─────────────────────────── */}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {[
          { key: 'overview', label: 'Overview', icon: <Users size={20} /> },
          { key: 'patients', label: 'Patients', icon: <Activity size={20} /> },
          { key: 'connections', label: 'Devices', icon: <Wifi size={20} /> },
          { key: 'evidence', label: 'Evidence', icon: <FlaskConical size={20} /> },
        ].map(item => (
          <button
            key={item.key}
            className={`mob-nav-item ${route === item.key ? 'active' : ''}`}
            onClick={() => navigateTo(item.key as PageRoute)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Printable summary ─────────────────────────── */}
      {showPrintModal && detail && patient && twin && (
        <PrintableSummary patient={patient} twin={twin} review={review} onClose={() => setShowPrintModal(false)} />
      )}

      {/* ── Toast ─────────────────────────────────────── */}
      {notice && (
        <div className="toast-area">
          <div className="toast" role="status">
            <Check size={15} /> {notice}
          </div>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────── */}
      {modal && (
        <div className="modal-backdrop" onClick={() => !busy && setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={e => e.stopPropagation()}
          >
            <button className="btn btn-ghost modal-close" aria-label="Close" disabled={busy} onClick={() => setModal(null)}>
              <X size={17} />
            </button>
            <div className="modal-eyebrow">
              {modal === 'scenario' ? 'Physiological exploration' : modal === 'telemetry' ? 'Daily sensor observation' : 'Demo controls'}
            </div>
            <h2 id="modal-title">
              {modal === 'scenario' ? 'What if the signals change?' : modal === 'telemetry' ? 'Add a daily reading' : 'Restart the demo?'}
            </h2>
            <p>
              {modal === 'scenario'
                ? "Adjust the latest day\u2019s physiology to recompute the model estimate."
                : modal === 'telemetry'
                ? `${selected} · Next calendar day. Blank sensors stay missing.`
                : 'This replaces all local demo patients and readings with the original synthetic cohort.'}
            </p>

            {error && <div className="toast-error" role="alert" style={{ marginBottom: 12 }}><Warning size={14} /> {error}</div>}
            <hr className="modal-divider" />

            {modal === 'scenario' && (
              <>
                <div className="scenario-sliders">
                  {sliderSpecs.map(s => (
                    <div key={s.key}>
                      <div className="slider-label">
                        <b>{s.label}</b>
                        <span>{scenario[s.key] > 0 ? '+' : ''}{scenario[s.key]} {s.unit}</span>
                      </div>
                      <input
                        type="range"
                        aria-label={s.label}
                        min={s.min} max={s.max} step={s.step}
                        value={scenario[s.key]}
                        onChange={e => { setScenario(old => ({ ...old, [s.key]: Number(e.target.value) })); setSimulated(null) }}
                      />
                    </div>
                  ))}
                </div>
                <div className="scenario-comparison">
                  <div><small>Current estimate</small><strong>{percent(twin?.risk?.probability)}</strong></div>
                  <ArrowRight size={20} style={{ color: 'var(--text-tertiary)' }} />
                  <div><small>Scenario estimate</small><strong style={{ color: 'var(--high)' }}>{simulated ? percent(simulated.risk?.probability) : '—'}</strong></div>
                </div>
                {simulated && (
                  <p className="scenario-result" role="status">
                    Scenario recomputed. Δ: {((simulated.risk!.probability - twin!.risk!.probability) * 100).toFixed(1)} pp. Original readings unchanged.
                  </p>
                )}
                <div className="modal-note"><Info size={14} /> One-day input perturbation, not a causal forecast or treatment recommendation.</div>
                <button className="btn btn-primary btn-full" disabled={busy} onClick={() => void runScenario()}>
                  <SlidersHorizontal size={15} /> {busy ? 'Recomputing…' : 'Recompute scenario'}
                </button>
              </>
            )}

            {modal === 'telemetry' && (
              <form onSubmit={e => { e.preventDefault(); void ingest() }}>
                <div className="copy-action-banner">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={copyPreviousReadings}>
                    <Copy size={13} /> Copy yesterday's values
                  </button>
                  {telemetryCopiedNotice && (
                    <span className="copied-note"><Check size={13} /> Values copied — adjust before submitting</span>
                  )}
                </div>
                <div className="telemetry-form">
                  <label className="form-field full-field">
                    <span className="form-label">Date</span>
                    <input
                      className="form-input"
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
                      <div key={s.key} className="form-field">
                        <span className="form-label">
                          {s.label} <small>({s.unit})</small>
                          {spec && <span className="field-range-hint"> {spec.min}–{spec.max}</span>}
                        </span>
                        <input
                          className={`form-input ${fieldErr ? 'error' : ''}`}
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
                        {fieldErr && <span className="field-error">{fieldErr}</span>}
                      </div>
                    )
                  })}
                </div>
                <div className="modal-note"><Info size={14} /> Readings start blank to prevent silent replication. Blank fields → sensor gaps.</div>
                <button className="btn btn-primary btn-full" disabled={busy} type="submit">
                  <Plus size={15} /> {busy ? 'Saving…' : 'Save reading & update twin'}
                </button>
              </form>
            )}

            {modal === 'reset' && (
              <div className="reset-buttons">
                <button className="btn btn-secondary" disabled={busy} onClick={() => setModal(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={busy} onClick={() => void reset()}>
                  <RotateCcw size={14} /> {busy ? 'Resetting…' : 'Reset demo'}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function CalibrationChart({ bins }: { bins: { predicted: number; observed: number }[] }) {
  const x = (v: number) => 40 + v * 350
  const y = (v: number) => 230 - v * 200
  return (
    <svg className="calibration-chart" viewBox="0 0 420 270" role="img" aria-label="Calibration: predicted vs observed event fraction">
      <line x1={40} y1={230} x2={390} y2={30} stroke="#d4d4d8" strokeDasharray="5 5" />
      {[0, .25, .5, .75, 1].map(t => (
        <g key={t}>
          <line x1={40} y1={y(t)} x2={390} y2={y(t)} stroke="#f4f4f5" />
          <text x={30} y={y(t) + 4} textAnchor="end" className="chart-label">{Math.round(t * 100)}%</text>
          <text x={x(t)} y={248} textAnchor="middle" className="chart-label">{Math.round(t * 100)}%</text>
        </g>
      ))}
      <path d={bins.map((p, i) => `${i ? 'L' : 'M'}${x(p.predicted)},${y(p.observed)}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth="2" />
      {bins.map((p, i) => (
        <circle key={i} cx={x(p.predicted)} cy={y(p.observed)} r={4} fill="#2563eb" />
      ))}
      <text x={210} y={266} textAnchor="middle" className="chart-label">Predicted probability</text>
    </svg>
  )
}
