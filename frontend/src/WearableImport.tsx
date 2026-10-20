import { useRef, useState } from 'react'
import type { Patient } from './types'
import { ArrowRight, Check } from './icons'

type Preview = {
  patient_id:string; source:string; timestamp:string; day:number
  normalized:Record<string,number>; units:Record<string,string>
  missing_metrics:string[]; coverage:number; persisted:false
}
const labels:Record<string,string> = {resting_hr:'Resting heart rate',hrv:'Heart rate variability',respiratory_rate:'Respiration',spo2:'Oxygen saturation',steps:'Steps',weight:'Weight',systolic_bp:'Systolic pressure',diastolic_bp:'Diastolic pressure',sleep_hours:'Sleep'}

async function request<T>(path:string, payload?:unknown):Promise<T> {
  const response = await fetch(`/api${path}`, payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
  const body = await response.json()
  if (!response.ok) {
    const detail = typeof body.detail==='string' ? body.detail : Array.isArray(body.detail)
      ? body.detail.map((item:{loc:(string|number)[];msg:string})=>`${item.loc.filter(x=>x!=='body').join('.')}: ${item.msg}`).join('; ')
      : 'The summary could not be processed. Please try again.'
    throw new Error(detail)
  }
  return body
}

export default function WearableImport({patients,patientId,onPatientChange,onSaved}:{patients:Patient[];patientId:string;onPatientChange:(id:string)=>void;onSaved:()=>Promise<void>}) {
  const [text,setText]=useState(''), [preview,setPreview]=useState<Preview|null>(null)
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [success,setSuccess]=useState('')
  const lock=useRef(false)
  const payload=useRef<unknown>(null)
  const patient=patients.find(p=>p.patient_id===patientId)
  const change=(value:string)=>{setText(value);setPreview(null);payload.current=null;setError('');setSuccess('')}
  async function run(action:()=>Promise<void>) {
    if(lock.current)return
    lock.current=true;setBusy(true);setError('');setSuccess('')
    try { await action() } catch(e) { setError((e as Error).message) }
    finally { lock.current=false;setBusy(false) }
  }
  async function sample() {
    const detail=await request<{twin:{timestamp:string|null}}>(`/patients/${patientId}`)
    const date=detail.twin.timestamp ? new Date(`${detail.twin.timestamp}T00:00:00Z`) : new Date('2026-01-01T00:00:00Z')
    if(detail.twin.timestamp)date.setUTCDate(date.getUTCDate()+1)
    change(JSON.stringify({source:'apple_health',timestamp:date.toISOString().slice(0,10),readings:[
      {metric:'resting_heart_rate',value:72,unit:'bpm'}, {metric:'hrv',value:42,unit:'ms'},
      {metric:'respiration',value:17,unit:'/min'}, {metric:'oxygen_saturation',value:0.97,unit:'fraction'},
      {metric:'steps',value:5400,unit:'steps'}, {metric:'body_weight',value:154.324,unit:'lb'},
      {metric:'systolic',value:120,unit:'mmHg'}, {metric:'diastolic',value:78,unit:'mmHg'},
      {metric:'sleep_minutes',value:450,unit:'min'},
    ]},null,2))
  }
  async function inspect() {
    setPreview(null);payload.current=null
    let parsed:unknown
    try { parsed=JSON.parse(text) } catch { throw new Error('This is not valid JSON. Check the commas and quotation marks, or load the fictional example.') }
    const result=await request<Preview>(`/patients/${patientId}/wearables/preview`,parsed)
    payload.current=parsed;setPreview(result)
  }
  async function save() {
    if(!preview||!payload.current)return
    await request(`/patients/${patientId}/wearables/ingest`,payload.current)
    const message=`Saved ${preview.timestamp} for ${preview.patient_id}. The daily ledger and twin have been updated.`
    setPreview(null);payload.current=null;setText('');setSuccess(message)
    try { await onSaved() } catch { setError('The summary was saved, but the patient list could not refresh. Reload the page to see the latest readings.') }
  }
  return <section className="summary-import" aria-labelledby="import-title">
    <div className="import-heading"><div><h2 id="import-title">Try a daily summary.</h2><p>Use fictional data to preview the gateway, then save one day to a patient’s ledger.</p></div><span className="subtle-tag">Demo workspace</span></div>
    <div className="import-layout">
      <div className="import-editor">
        <label htmlFor="import-patient">Patient</label>
        <select id="import-patient" disabled={busy} value={patientId} onChange={e=>onPatientChange(e.target.value)}>
          {patients.map(p=><option key={p.patient_id} value={p.patient_id}>{p.patient_id} · {p.name}</option>)}
        </select>
        <p className="import-hint">Latest stored day: {patient?.timestamp||'No readings yet'}. Each summary must add the next calendar day.</p>
        <div className="import-editor-label"><label htmlFor="summary-json">Daily summary JSON</label><button className="button text" disabled={busy||!patientId} onClick={()=>void run(sample)}>Load fictional example</button></div>
        <textarea id="summary-json" value={text} disabled={busy} maxLength={32768} spellCheck={false} aria-describedby="summary-hint" placeholder={'{ "source": "apple_health", "timestamp": "YYYY-MM-DD", "readings": […] }'} onChange={e=>change(e.target.value)}/>
        <p id="summary-hint" className="import-hint">One source, one date, up to 32 daily metrics. Blank units use the metric’s default. Never paste credentials or real patient data.</p>
        <button className="button secondary" disabled={busy||!text.trim()||!patientId} onClick={()=>void run(inspect)}>{busy?'Processing…':'Preview summary'}<ArrowRight size={15}/></button>
      </div>
      <div className="import-review" aria-live="polite" aria-busy={busy}>
        {error&&<div className="error" role="alert">{error}</div>}
        {success&&<div className="import-success" role="status"><Check size={20}/><p>{success}</p></div>}
        {preview?<>
          <h3>Review before saving</h3><p>{preview.patient_id} · {preview.timestamp} · {preview.source.replaceAll('_',' ')}</p>
          <dl className="normalized-readings">{Object.entries(preview.normalized).map(([key,value])=><div key={key}><dt>{labels[key]||key}</dt><dd>{value.toLocaleString(undefined,{maximumFractionDigits:4})} <small>{preview.units[key]}</small></dd></div>)}</dl>
          <p className="import-hint">{Math.round(preview.coverage*100)}% of supported signals supplied. {preview.missing_metrics.length?`Missing: ${preview.missing_metrics.map(key=>labels[key]||key).join(', ')}. Missing values stay missing; risk may be unavailable.`:'All nine supported signals are present.'}</p>
          <p className="import-hint">Preview complete. Nothing has been saved. Saving appends day {preview.day} and recomputes the twin.</p>
          <button className="button primary" disabled={busy} onClick={()=>void run(save)}><Check size={16}/>Save summary & update twin</button>
        </>:!success&&<div className="import-empty"><h3>See exactly what will be saved.</h3><p>The preview converts supported units, checks input ranges, and lists missing signals before anything reaches the ledger.</p><p>Try the example to see pounds become kilograms, sleep minutes become hours, and oxygen fractions become percentages.</p></div>}
      </div>
    </div>
  </section>
}
