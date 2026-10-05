import { useEffect, useState } from 'react'
import { Activity, ArrowRight, Info, ShieldCheck, Wifi } from './icons'

type Source = {
  id:string
  label:string
  platform:string
  gateway:string
  mode:string
  description:string
  metrics:string[]
}

export default function WearablesPage({patientId}:{patientId:string}) {
  const [sources,setSources]=useState<Source[]>([])
  const [error,setError]=useState('')
  useEffect(()=>{
    fetch('/api/wearables/sources')
      .then(async response=>{
        const body=await response.json()
        if(!response.ok) throw new Error(body.detail||'Unable to load wearable sources')
        return body
      })
      .then(body=>setSources(body.sources||[]))
      .catch(e=>setError(e.message))
  },[])

  const primary=sources.filter(source=>['apple_health','health_connect','samsung_health','google_health'].includes(source.id))
  const optional=sources.filter(source=>!primary.includes(source))

  return <div className="wearables-page">
    <section className="wearable-hero">
      <div>
        <span className="eyebrow">YOUR DATA, WITH PERMISSION</span>
        <h2>Bring your everyday health data into one living twin.</h2>
        <p>CardioTwin uses a phone-first gateway: the member approves access on their device, the mobile companion creates a small daily summary, and the backend normalizes it before the existing risk model sees it.</p>
        <div className="wearable-hero-pills">
          <span><ShieldCheck size={15}/> Consent-first</span>
          <span><Wifi size={15}/> Daily sync</span>
          <span><Activity size={15}/> One signal model</span>
        </div>
      </div>
      <div className="sync-orbit" aria-label="Wearable data flows from device to phone to CardioTwin">
        <div className="orbit-core"><strong>CT</strong><small>living twin</small></div>
        <span className="orbit-node apple">Apple</span>
        <span className="orbit-node samsung">Samsung</span>
        <span className="orbit-node google">Google</span>
        <span className="orbit-node other">+</span>
      </div>
    </section>

    {error&&<div className="error" role="alert">{error}</div>}

    <section className="wearable-flow">
      <span>01 <b>Member approves access</b></span>
      <ArrowRight size={18}/>
      <span>02 <b>Phone/provider summarizes</b></span>
      <ArrowRight size={18}/>
      <span>03 <b>Signals normalize</b></span>
      <ArrowRight size={18}/>
      <span>04 <b>Twin updates</b></span>
    </section>

    <div className="wearable-layout">
      <section>
        <div className="card-heading"><div><h2>Connect the data you already use.</h2><p>Primary mobile paths for the first production companion.</p></div><span className="subtle-tag">{patientId||'Select a patient'} · demo</span></div>
        <div className="source-grid">
          {primary.map(source=><article className="source-card" key={source.id}>
            <div className="source-card-top"><div className="source-mark">{source.label.slice(0,1)}</div><div><h3>{source.label}</h3><p>{source.platform}</p></div><span className="source-mode">{source.gateway}</span></div>
            <p>{source.description}</p>
            <div className="metric-list">{source.metrics.slice(0,5).map(metric=><span key={metric}>{metric}</span>)}</div>
            <button className="button secondary full" type="button" disabled title="Native permission flow belongs in the mobile companion">Mobile setup required <ArrowRight size={14}/></button>
          </article>)}
        </div>
      </section>

      <aside className="wearable-side">
        <section className="wearable-note">
          <Info size={18}/>
          <div><h3>Why the phone is the gateway</h3><p>Apple HealthKit and Android Health Connect are native device APIs. A web page cannot safely request those permissions. Keeping that handoff native also lets CardioTwin avoid collecting raw provider credentials in this prototype.</p></div>
        </section>
        <section className="stack-card">
          <span className="eyebrow">DATA PLANE</span>
          <h3>Built for a larger health stack.</h3>
          <div className="stack-lines">
            <span>Mobile <b>React Native + TypeScript</b></span>
            <span>Gateway <b>HealthKit + Health Connect</b></span>
            <span>API <b>FastAPI + Pydantic</b></span>
            <span>Storage path <b>Postgres + TimescaleDB</b></span>
            <span>Raw archive <b>S3 + Parquet</b></span>
            <span>ML <b>XGBoost → PyTorch</b></span>
            <span>Interoperability <b>FHIR export</b></span>
          </div>
          <p className="micro-note">The current hackathon runtime still uses SQLite for reproducible local demos. The adapter boundary is designed so storage can move to TimescaleDB without changing the model input contract.</p>
        </section>
      </aside>
    </div>

    {!!optional.length&&<section className="provider-row">
      <div><span className="eyebrow">OPTIONAL PROVIDERS</span><h2>Ready to grow beyond the phone gateway.</h2></div>
      <div>{optional.map(source=><span key={source.id}><b>{source.label}</b><small>{source.gateway}</small></span>)}</div>
    </section>}
  </div>
}
