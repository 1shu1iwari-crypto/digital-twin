import { useState } from 'react'
import { ArrowUpRight, ArrowDownRight, Minus } from './icons'
import type { Contribution, Observation, Signal, Twin, Patient, Review } from './types'

export const percent = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value * 100)}%`

export function getRiskEstimate(risk: number | null | undefined, rawStatus?: string): { label: string; tone: 'coral' | 'amber' | 'green' | 'neutral'; code: 'high' | 'watch' | 'stable' | 'unknown' } {
  if (risk == null || rawStatus === 'Insufficient data' || rawStatus === 'Awaiting data') {
    return { label: 'Insufficient data', tone: 'neutral', code: 'unknown' }
  }
  if (risk >= 0.60 || rawStatus === 'High risk') {
    return { label: 'High model estimate', tone: 'coral', code: 'high' }
  }
  if (risk >= 0.20 || rawStatus === 'Watch') {
    return { label: 'Elevated model estimate', tone: 'amber', code: 'watch' }
  }
  return { label: 'Low model estimate', tone: 'green', code: 'stable' }
}

export const riskClass = (status: string) => {
  if (status.includes('High') || status === 'high') return 'high'
  if (status.includes('Elevated') || status.includes('Watch') || status === 'watch') return 'watch'
  if (status.includes('Low') || status.includes('Stable') || status === 'stable') return 'stable'
  return 'unknown'
}

export function Badge({ status }: { status: string }) {
  const displayLabel = status === 'High risk' ? 'High model estimate'
    : status === 'Watch' ? 'Elevated model estimate'
    : status === 'Stable' ? 'Low model estimate'
    : status
  return <span className={`badge ${riskClass(status)}`}><i />{displayLabel}</span>
}

export const reviewClass = (state: string) => {
  switch (state) {
    case 'reviewed': return 'reviewed'
    case 'needs_follow_up': return 'needs-follow-up'
    case 'monitoring': return 'monitoring'
    case 'flagged': return 'flagged'
    default: return 'unreviewed'
  }
}

export function ReviewBadge({ state }: { state?: string }) {
  const s = state || 'unreviewed'
  const labels: Record<string, string> = {
    reviewed: 'Reviewed',
    needs_follow_up: 'Needs follow-up',
    monitoring: 'Monitoring',
    flagged: 'Flagged',
    unreviewed: 'Unreviewed'
  }
  return <span className={`review-badge ${reviewClass(s)}`}>{labels[s] || s}</span>
}

export function HeartVisual({ twin, small = false }: { twin?: Twin | null; small?: boolean }) {
  return (
    <div className={`heart-visual ${small ? 'small' : ''}`}>
      <svg viewBox="0 0 300 280" role="img" aria-label="Decorative ink study of a heart; not a physiological model output">
        <path d="M192 62 C254 87 263 154 215 211 C179 259 105 248 78 203 C48 152 83 72 130 61 C154 53 175 54 192 62Z" fill="#eedfd5" />
        <g fill="none" stroke="#6d443a" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M139 89 C107 72 88 91 86 117 C70 149 86 178 109 202 C127 220 151 243 170 232 C197 214 222 167 214 136 C207 107 184 99 165 105 C157 100 149 93 139 89Z" />
          <path d="M139 91 C134 74 134 53 146 39 L162 41 L162 65 C157 75 160 91 167 105 M146 39 L147 24 M154 40 L157 23 M162 41 L169 27" />
          <path d="M155 83 C168 57 188 59 194 74 L183 87 L198 100 M185 64 L192 48 M191 70 L205 60" />
          <path d="M141 91 C119 100 123 126 133 148 C145 173 161 197 171 231 M151 109 C167 117 177 141 178 158 C183 178 193 189 194 205" />
          <path d="M129 129 L109 141 L98 161 M132 146 L119 165 L113 185 M146 169 L129 190 M174 138 L191 153 L207 160 M179 160 L196 177" />
          <path d="M95 102 C99 92 115 88 128 93 M96 110 C99 100 112 96 125 97" strokeWidth=".8" />
          <path d="M199 125 C207 139 208 154 201 170 M199 132 C202 144 202 154 199 163" strokeWidth=".8" />
        </g>
        <path d="M36 132 H62 M226 177 H264 M81 225 H48" stroke="#b8a89a" strokeWidth=".8" />
        <text x="24" y="121" fontSize="8" fill="#8b796b" fontFamily="monospace">01</text><text x="265" y="180" fontSize="8" fill="#8b796b" fontFamily="monospace">02</text>
      </svg>
      <div className="heart-caption">{twin?.quality.baseline_ready ? 'Personal baseline established' : 'A patient-specific model'}<span>Illustration, not measured anatomy</span></div>
    </div>
  )
}

export function TrendChart({
  rows,
  signal = 'risk',
  baseline,
  unit = '%',
  compact = false
}: {
  rows: Observation[]
  signal?: string
  baseline?: number | null
  unit?: string
  compact?: boolean
}) {
  const [activePoint, setActivePoint] = useState<{
    index: number
    date: string
    value: number
    baseline?: number | null
    diff?: number | null
    low?: number | null
    high?: number | null
  } | null>(null)

  const data = rows.map((row, i) => {
    const rawVal = row[signal]
    const numVal = typeof rawVal === 'number' ? Number(rawVal) * (signal === 'risk' ? 100 : 1) : null
    return {
      x: i,
      y: numVal,
      date: row.timestamp,
      low: typeof row.risk_lower === 'number' ? row.risk_lower * 100 : null,
      high: typeof row.risk_upper === 'number' ? row.risk_upper * 100 : null
    }
  })

  const valid = data.filter(p => p.y !== null)
  if (!valid.length) return <div className="empty-chart">Waiting for enough sensor data</div>

  let min = signal === 'risk' ? 0 : Math.min(...valid.map(p => p.y!), baseline ?? Infinity)
  let max = signal === 'risk' ? 100 : Math.max(...valid.map(p => p.y!), baseline ?? -Infinity)
  const pad = Math.max((max - min) * .2, 1)
  if (signal !== 'risk') { min -= pad; max += pad }

  const w = compact ? 300 : 680
  const h = compact ? 90 : 210
  const left = compact ? 5 : 72
  const right = compact ? 5 : 15
  const top = compact ? 10 : 24
  const bottom = compact ? 10 : 32

  const x = (i: number) => left + (i / Math.max(1, rows.length - 1)) * (w - left - right)
  const y = (v: number) => h - bottom - ((v - min) / (max - min)) * (h - top - bottom)

  let connected = false
  const path = data.map(p => {
    if (p.y === null) { connected = false; return '' }
    const command = connected ? 'L' : 'M'
    connected = true
    return `${command}${x(p.x)},${y(p.y)}`
  }).join(' ')

  const last = valid[valid.length - 1]

  let bandPath = ''
  if (signal === 'risk') {
    const validBounds = rows.map((r, i) => {
      if (typeof r.risk_lower === 'number' && typeof r.risk_upper === 'number') {
        return { x: i, low: r.risk_lower * 100, high: r.risk_upper * 100 }
      }
      return null
    }).filter((p): p is { x: number; low: number; high: number } => p !== null)

    if (validBounds.length > 1) {
      const topPts = validBounds.map(p => `${x(p.x)},${y(p.high)}`)
      const botPts = [...validBounds].reverse().map(p => `${x(p.x)},${y(p.low)}`)
      bandPath = `M ${topPts.join(' L ')} L ${botPts.join(' L ')} Z`
    }
  }

  return (
    <div className="trend-chart-wrapper">
      <svg
        className="trend-chart"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`${signal} trend across ${rows.length} days; gaps indicate missing readings`}
      >
        {!compact && [0, .25, .5, .75, 1].map(t => (
          <g key={t}>
            <line x1={left} y1={y(min + (max - min) * t)} x2={w - right} y2={y(min + (max - min) * t)} stroke="#e8e9e3" strokeDasharray="3 4" />
            <text x={left - 8} y={y(min + (max - min) * t) + 4} textAnchor="end" className="chart-label">{Math.round(min + (max - min) * t)}{signal === 'risk' ? '%' : ''}</text>
          </g>
        ))}
        {baseline != null && (
          <line x1={left} y1={y(baseline)} x2={w - right} y2={y(baseline)} stroke="#91aaa0" strokeDasharray="6 4" strokeWidth="1.5" />
        )}
        {bandPath && <path d={bandPath} fill="rgba(195,105,82,0.18)" stroke="none" />}
        <path d={path} fill="none" stroke={signal === 'risk' ? '#c36952' : '#376e61'} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />

        {/* Interactive points */}
        {!compact && data.map((p) => {
          if (p.y === null) return null
          const isSelected = activePoint?.index === p.x
          const px = x(p.x)
          const py = y(p.y)
          return (
            <g key={p.x} className="chart-point-group">
              <circle
                cx={px}
                cy={py}
                r={isSelected ? 6 : 4}
                fill={signal === 'risk' ? '#c36952' : '#376e61'}
                stroke="#fff"
                strokeWidth={isSelected ? 2.5 : 1.5}
                style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
                tabIndex={0}
                aria-label={`Day ${p.date}: ${p.y.toFixed(1)}${unit}`}
                onMouseEnter={() => {
                  setActivePoint({
                    index: p.x,
                    date: p.date,
                    value: p.y!,
                    baseline: baseline ?? null,
                    diff: baseline != null ? p.y! - baseline : null,
                    low: p.low,
                    high: p.high
                  })
                }}
                onFocus={() => {
                  setActivePoint({
                    index: p.x,
                    date: p.date,
                    value: p.y!,
                    baseline: baseline ?? null,
                    diff: baseline != null ? p.y! - baseline : null,
                    low: p.low,
                    high: p.high
                  })
                }}
                onClick={() => {
                  setActivePoint({
                    index: p.x,
                    date: p.date,
                    value: p.y!,
                    baseline: baseline ?? null,
                    diff: baseline != null ? p.y! - baseline : null,
                    low: p.low,
                    high: p.high
                  })
                }}
              />
            </g>
          )
        })}

        {compact && (
          <circle cx={x(last.x)} cy={y(last.y!)} r="4.5" fill={signal === 'risk' ? '#c36952' : '#376e61'} stroke="#fff" strokeWidth="2" />
        )}

        {!compact && [0, Math.floor((rows.length - 1) / 2), rows.length - 1].map((i, j) => (
          <text key={j} x={x(i)} y={h - 5} textAnchor={j === 0 ? 'start' : j === 2 ? 'end' : 'middle'} className="chart-label">
            {rows[i]?.timestamp?.slice(5)}
          </text>
        ))}
      </svg>

      {/* Inspectable point pill */}
      {!compact && (
        <div className="inspectable-point-bar" role="status">
          {activePoint ? (
            <div className="point-detail">
              <span className="point-date"><b>Date:</b> {activePoint.date}</span>
              <span className="point-value">
                <b>Value:</b> {activePoint.value.toFixed(signal === 'risk' ? 0 : 1)} {unit}
              </span>
              {signal === 'risk' && activePoint.low != null && activePoint.high != null && (
                <span className="point-ci">
                  <b>95% CI:</b> [{Math.round(activePoint.low)}% – {Math.round(activePoint.high)}%]
                </span>
              )}
              {signal !== 'risk' && activePoint.baseline != null && (
                <span className="point-diff">
                  <b>Baseline:</b> {activePoint.baseline.toFixed(1)} {unit}
                  {' '}({activePoint.diff! >= 0 ? '+' : ''}{activePoint.diff!.toFixed(1)} delta)
                </span>
              )}
              <span className="point-source"><b>Source:</b> Home sensor reading</span>
            </div>
          ) : (
            <div className="point-hint">Hover or tap any chart point to inspect exact reading, personal baseline difference, and confidence interval.</div>
          )}
        </div>
      )}
    </div>
  )
}

export function SignalCard({ signal, onClick, active }: { signal: Signal; onClick: () => void; active: boolean }) {
  const down = (signal.delta ?? 0) < 0
  const Icon = signal.delta === null ? Minus : down ? ArrowDownRight : ArrowUpRight
  const isMissing = signal.value === null

  return (
    <button className={`signal-card ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="signal-label">{signal.label}</span>
      <strong>
        {isMissing ? '—' : signal.key === 'steps' ? Math.round(signal.value!).toLocaleString() : signal.value!.toFixed(signal.key === 'weight' || signal.key === 'sleep_hours' ? 1 : 0)}{' '}
        <small>{signal.unit}</small>
      </strong>
      <span className="signal-delta">
        <Icon size={14} />
        {isMissing ? (
          'Reading missing today'
        ) : signal.baseline != null ? (
          <>
            {signal.delta! >= 0 ? '+' : ''}{signal.delta!.toFixed(signal.key === 'weight' ? 1 : 0)} {signal.unit} vs baseline ({signal.baseline.toFixed(signal.key === 'weight' ? 1 : 0)} {signal.unit})
          </>
        ) : (
          'Baseline in progress'
        )}
      </span>
    </button>
  )
}

export function Contributions({ values, limit = 6 }: { values: Contribution[]; limit?: number }) {
  const items = values.slice(0, limit)
  const max = Math.max(...items.map(x => Math.abs(x.contribution)), .001)

  return (
    <div className="contributions">
      {items.map(item => (
        <div className="contribution" key={item.feature}>
          <div className="contribution-header">
            <span className="contribution-label">{item.label}</span>
            {item.value != null && (
              <span className="contribution-val">
                Measured: <b>{typeof item.value === 'number' ? (Number.isInteger(item.value) ? item.value : item.value.toFixed(1)) : item.value}</b>
              </span>
            )}
            <b className={item.contribution >= 0 ? 'text-coral' : 'text-green'}>
              {item.contribution > 0 ? '+' : ''}{item.contribution.toFixed(2)} log-odds
            </b>
          </div>
          <div className="contribution-track">
            <i style={{ width: `${Math.abs(item.contribution) / max * 100}%`, background: item.contribution >= 0 ? '#c57b66' : '#6f998b' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function TwinIndices({ twin }: { twin: Twin }) {
  return (
    <div className="indices">
      {twin.indices.map(index => (
        <div className="index" key={index.name}>
          <div>
            <span>{index.name}</span>
            <b>{index.value === null ? '—' : Math.round(index.value)}<small>/100</small></b>
          </div>
          <div className="index-track">
            <i style={{ width: `${index.value ?? 0}%`, background: index.direction === 'burden' ? '#c8836e' : '#71988a' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function PrintableSummary({
  patient,
  twin,
  review,
  onClose
}: {
  patient: Patient
  twin: Twin
  review: Review
  onClose: () => void
}) {
  const est = getRiskEstimate(twin.risk?.probability, twin.status)

  return (
    <div className="printable-modal-backdrop" onClick={onClose}>
      <div className="printable-modal" onClick={e => e.stopPropagation()}>
        <div className="printable-header-actions no-print">
          <button className="button primary" onClick={() => window.print()}>Print / Save as PDF</button>
          <button className="button secondary" onClick={onClose}>Close</button>
        </div>

        <div className="clinical-print-sheet">
          <div className="clinic-letterhead">
            <div className="letterhead-brand">
              <span className="letterhead-logo">CardioTwin-HF</span>
              <span className="letterhead-dept">Remote Heart Failure Monitoring & Triage Summary</span>
            </div>
            <div className="letterhead-meta">
              <span>Date: {new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}</span>
              <span>Workspace: Research Prototype (Synthetic EHR)</span>
            </div>
          </div>

          <hr className="print-rule" />

          <div className="print-patient-demographics">
            <div className="demo-col">
              <strong>Patient ID:</strong> {patient.patient_id}
            </div>
            <div className="demo-col">
              <strong>Name:</strong> {patient.name}
            </div>
            <div className="demo-col">
              <strong>Age / Sex:</strong> {patient.age}y / {patient.sex}
            </div>
            <div className="demo-col">
              <strong>Phenotype:</strong> {patient.hf_type} (NYHA {patient.nyha}, LVEF {patient.lvef}%)
            </div>
            <div className="demo-col">
              <strong>Creatinine:</strong> {patient.creatinine} mg/dL (eGFR {patient.egfr})
            </div>
            <div className="demo-col">
              <strong>Latest Reading:</strong> {twin.timestamp}
            </div>
          </div>

          <div className="print-section">
            <h3>7-Day Decompensation Risk Assessment</h3>
            <div className="print-risk-box">
              <div className="print-risk-metric">
                <span className="print-risk-val">{percent(twin.risk?.probability)}</span>
                <span className={`print-badge ${riskClass(est.label)}`}>{est.label}</span>
              </div>
              <div className="print-risk-details">
                {twin.risk?.ci_lower != null && (
                  <div><b>Calibrated 95% Confidence Interval:</b> [{percent(twin.risk.ci_lower)} – {percent(twin.risk.ci_upper)}]</div>
                )}
                <div><b>Sensor Telemetry Coverage:</b> {Math.round(twin.quality.coverage * 100)}% 7-day coverage</div>
                <div><b>Personal Baseline Status:</b> {twin.quality.baseline_ready ? '14-Day Median/MAD Frozen Baseline Established' : 'Baseline in Progress'}</div>
              </div>
            </div>
          </div>

          <div className="print-section">
            <h3>Latest Physiological Observations vs Baseline</h3>
            <table className="print-table">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Observed Value</th>
                  <th>Personal Baseline</th>
                  <th>Baseline Deviation</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {twin.signals.map(s => (
                  <tr key={s.key}>
                    <td><b>{s.label}</b></td>
                    <td>{s.value == null ? 'Missing' : `${s.value.toFixed(s.key === 'weight' ? 1 : 0)} ${s.unit}`}</td>
                    <td>{s.baseline == null ? '—' : `${s.baseline.toFixed(s.key === 'weight' ? 1 : 0)} ${s.unit}`}</td>
                    <td>
                      {s.delta == null ? '—' : `${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(s.key === 'weight' ? 1 : 0)} ${s.unit}`}
                    </td>
                    <td>{s.value == null ? 'Sensor gap' : Math.abs(s.delta ?? 0) > 1.5 ? 'Significant deviation' : 'Stable'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="print-section">
            <h3>Clinician Review & Triage State</h3>
            <div className="print-review-box">
              <p><b>Current Workflow State:</b> {review.state ? review.state.replace('_', ' ').toUpperCase() : 'UNREVIEWED'}</p>
              <p><b>Clinical Note / Triage Rationale:</b> {review.note || 'No clinical notes recorded.'}</p>
              <p><b>Last Recorded:</b> {review.updated_at ? new Date(review.updated_at).toLocaleString() : 'Pending review'}</p>
              <div className="clinician-signature-line">
                <span>Attending / Reviewing Clinician: ____________________________________</span>
                <span>Date: ______________</span>
              </div>
            </div>
          </div>

          <div className="print-footer-notice">
            <p><b>RESEARCH PROTOTYPE DISCLAIMER:</b> All data in CardioTwin-HF is synthetic. This tool is an engineering research proof-of-concept for personalized machine learning and digital twins. It provides no clinical diagnosis, treatment prescription, or causal intervention estimates.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Logo() {
  return (
    <div className="logo">
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <rect x="1" y="1" width="34" height="34" rx="7" fill="currentColor" />
        <path d="M6 19 H11 L14 11 L19 25 L23 16 L26 19 H30" stroke="#faf7f1" strokeWidth="1.8" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div>cardiotwin<span className="logo-hf"> / hf</span></div>
    </div>
  )
}

export function Loading() {
  return (
    <div className="loading" role="status" aria-label="Loading patient data">
      <span>Loading patient readings</span>
      <div className="skeleton-heading" />
      <div className="skeleton-grid">{[0, 1, 2].map(x => <i key={x} />)}</div>
      <div className="skeleton-table">{[0, 1, 2, 3].map(x => <i key={x} />)}</div>
    </div>
  )
}
