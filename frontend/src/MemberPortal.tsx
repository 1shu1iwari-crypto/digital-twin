import { useEffect, useRef, useState } from 'react'
import { Logo } from './components'
import { ArrowRight, Check, ShieldCheck } from './icons'
import { care, dateTime, downloadCsv, parseDailyCsv, sourceNames, statusNames } from './careClient'
import type { CareDay, DayInput, MemberData, Metric } from './careClient'
import { ReviewDays } from './CareWorkspace'

export default function MemberPortal({invitation}:{invitation:string|null}) {
  const [token,setToken]=useState(invitation),[data,setData]=useState<MemberData|null>(null),[metrics,setMetrics]=useState<Metric[]>([])
  const [selected,setSelected]=useState<string[]>([]),[ack,setAck]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[mode,setMode]=useState<'form'|'csv'>('form')
  const [source,setSource]=useState('manual'),[date,setDate]=useState(''),[values,setValues]=useState<Record<string,string>>({})
  const [csv,setCsv]=useState(''),[fileName,setFileName]=useState(''),[preview,setPreview]=useState<CareDay[]|null>(null)
  const draft=useRef<{days:DayInput[]}|null>(null),lock=useRef(false)
  const refresh=async()=>{
    const member=await care<MemberData>('/member');setData(member);setDate(member.next_date||new Date().toISOString().slice(0,10))
  }
  useEffect(()=>{
    let active=true
    care<{metrics:Metric[]}>('/config').then(c=>{if(active)setMetrics(c.metrics)}).catch(e=>{if(active)setError(e.message)})
    if(token){setLoaded(true);return()=>{active=false}}
    care<MemberData>('/member').then(d=>{if(active){setData(d);setDate(d.next_date||new Date().toISOString().slice(0,10))}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoaded(true)})
    return()=>{active=false}
  },[token])
  const invalidate=()=>{setPreview(null);draft.current=null;setError('');setNotice('')}
  const run=async(action:()=>Promise<void>)=>{
    if(lock.current)return
    lock.current=true;setBusy(true);setError('');setNotice('')
    try{await action()}catch(e){setError((e as Error).message)}finally{lock.current=false;setBusy(false)}
  }
  const acceptInvite=async()=>{
    await care('/member/exchange',{token});history.replaceState(null,'','#member');setToken(null)
  }
  const shared=metrics.filter(m=>data?.consent?.metrics.includes(m.key))
  const sampleValues:Record<string,number>={resting_hr:72,hrv:42,respiratory_rate:17,spo2:97,steps:5400,weight:70,systolic_bp:120,diastolic_bp:78,sleep_hours:7.5}
  const sample=()=>{
    invalidate()
    if(mode==='form')setValues(Object.fromEntries(shared.map(m=>[m.key,String(sampleValues[m.key])])))
    else {setCsv(`date,${shared.map(m=>m.key).join(',')}\n${date},${shared.map(m=>sampleValues[m.key]).join(',')}`);setFileName('Fictional example · one day')}
  }
  const inspect=async()=>{
    invalidate()
    const days=mode==='csv'?parseDailyCsv(csv,source,metrics):[{source,timestamp:date,readings:shared.filter(m=>values[m.key]?.trim()).map(m=>({metric:m.key,value:Number(values[m.key]),unit:m.unit}))}]
    if(days.some(day=>day.readings.some(r=>!Number.isFinite(r.value))))throw new Error('Readings must be finite numbers.')
    const payload={days},result=await care<{days:CareDay[]}>('/member/preview',payload)
    draft.current=payload;setPreview(result.days)
  }
  const send=async()=>{
    if(!draft.current)return
    await care('/member/submissions',draft.current)
    setPreview(null);draft.current=null;setValues({});setCsv('');setFileName('');await refresh()
    setNotice('Delivered to your care team. Your readings are awaiting review.')
  }
  const pending=data?.submissions.some(s=>s.status==='pending')
  return <div className="member-shell">
    <header className="member-header"><Logo/><span>Member space · fictional-data demo</span></header>
    <main className="member-main">
      <div className="member-intro"><h1>Your day.<br/><em>Your choice to share.</em></h1><p>Send the daily readings you choose to your CardioTwin demo care team. You can see what was received and stop sharing at any time.</p></div>
      <ol className="care-steps member-steps"><li className={data?'complete':''}>Open invitation</li><li className={data?.consent?'complete':''}>Choose signals</li><li className={data?.submissions.length?'complete':''}>Send a summary</li><li>Care team reviews</li></ol>
      {error&&<div className="error" role="alert">{error}</div>}{notice&&<p className="care-notice" role="status"><Check size={18}/>{notice}</p>}
      {!loaded?<p role="status">Opening your member space…</p>:token?<section className="member-invitation"><ShieldCheck size={28}/><h2>You’ve been invited to share.</h2><p>This invitation opens one patient’s submission portal. Opening it does not share any readings. You’ll choose the signals on the next step.</p><p className="care-small">The link is single use and expires after 48 hours. This local demo accepts fictional data only.</p><button className="button primary" disabled={busy} onClick={()=>void run(acceptInvite)}>Open my invitation<ArrowRight size={16}/></button></section>:!data?<section className="care-empty"><h2>Start with your invitation.</h2><p>Ask the demo care team for a fresh member link. If this browser session expired, they can end the previous connection and create a new one.</p></section>:<>
        <div className="member-identity"><div><strong>{data.patient.name}</strong><span>{data.patient.patient_id} · CardioTwin demo care team</span></div><span className={`care-status ${data.status}`}>{statusNames[data.status]}</span></div>
        {data.status==='joined'&&<section className="member-consent"><h2>Choose what your care team receives.</h2><p>Select only the daily signals you want to share. These choices apply to uploads and typed readings in this portal.</p>
          <form onSubmit={e=>{e.preventDefault();void run(async()=>{await care('/member/consent',{metrics:selected,acknowledged:ack});await refresh();setNotice('Sharing choices saved. You can now send a daily summary.')})}}>
            <fieldset disabled={busy} className="metric-choices"><legend className="sr-only">Signals to share</legend>{metrics.map(m=><label key={m.key}><input type="checkbox" checked={selected.includes(m.key)} onChange={e=>setSelected(old=>e.target.checked?[...old,m.key]:old.filter(key=>key!==m.key))}/><span>{m.label}<small>{m.unit}</small></span></label>)}</fieldset>
            <div className="consent-explanation"><h3>How sharing works</h3><p>Your selected daily values go to the CardioTwin demo care team for this patient’s monitoring demonstration. They review each summary before it enters the patient record. No raw sensor stream, password, or provider token is requested.</p><p>Ending sharing stops new submissions and withdraws pending ones. Readings already accepted remain in the patient’s demo record. Device permissions are managed separately on your phone.</p></div>
            <label className="consent-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} disabled={busy}/><span>I choose to share the selected daily signals with this demo care team, and understand how to stop sharing.</span></label>
            <div className="care-actions"><button className="button primary" type="submit" disabled={busy||!ack||!selected.length}>Save sharing choices<ArrowRight size={16}/></button><button className="button text" type="button" disabled={busy} onClick={()=>void run(async()=>{await care('/member/revoke',{});await refresh()})}>Decline invitation</button></div>
          </form>
        </section>}
        {data.status==='active'&&<>
          <section className="member-send"><div className="care-review-heading"><div><h2>Send your daily summary.</h2><p>Next date for this record: <strong>{data.next_date||'Your first reading'}</strong></p></div><span className="care-small">{shared.length} signals selected</span></div>
            {pending?<div className="care-empty"><h3>Your summary is with the care team.</h3><p>Wait for their review before sending the next summary. Use Refresh status below to check for an update.</p></div>:<>
              <div className="member-input-tabs" role="tablist" aria-label="How to send readings"><button role="tab" aria-selected={mode==='form'} onClick={()=>{setMode('form');invalidate()}}>Enter daily readings</button><button role="tab" aria-selected={mode==='csv'} onClick={()=>{setMode('csv');invalidate()}}>Upload daily CSV</button></div>
              <fieldset disabled={busy} className="member-input-fields"><legend className="sr-only">Daily summary input</legend>
                <label>Reading source<select value={source} onChange={e=>{setSource(e.target.value);invalidate()}}>{Object.entries(sourceNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
                <p className="care-small">The source is supplied by you; it is not a verified device connection. Automatic Apple and Android sync needs the mobile companion.</p>
                {mode==='form'?<><label>Reading date<input aria-label="Reading date" type="date" required value={date} onChange={e=>{setDate(e.target.value);invalidate()}}/></label><div className="member-reading-grid">{shared.map(m=><label key={m.key}>{m.label} <small>({m.unit})</small><input type="number" aria-label={m.label} min={m.bounds[0]} max={m.bounds[1]} step="any" value={values[m.key]||''} placeholder="Not measured" onChange={e=>{setValues(old=>({...old,[m.key]:e.target.value}));invalidate()}}/><small>{m.bounds[0]}–{m.bounds[1]} {m.unit} · demo input range</small></label>)}</div></>:<div className="member-csv"><h3>A daily file, ready to review.</h3><p>Use one row per consecutive date, up to 31 days, in the units shown below. Leave unmeasured cells blank. This template is a common daily-summary format; raw Apple Health XML and vendor archives need an adapter first.</p><button className="button secondary" type="button" onClick={()=>downloadCsv(date,shared)}>Download daily CSV template</button><label>Choose daily-summary CSV<input aria-label="Choose daily-summary CSV" type="file" accept=".csv,text/csv" onChange={e=>{const file=e.target.files?.[0];if(!file)return;void run(async()=>{invalidate();if(file.size>65536)throw new Error('Choose a CSV smaller than 64 KB.');const text=await file.text();parseDailyCsv(text,source,metrics);setCsv(text);setFileName(file.name)})}}/></label>{fileName&&<p className="care-notice">{fileName}</p>}<p className="care-small">{shared.map(m=>`${m.label}: ${m.unit}`).join(' · ')}</p></div>}
                <div className="care-actions"><button className="button secondary" type="button" disabled={mode==='csv'&&!csv} onClick={()=>void run(inspect)}>Preview my summary<ArrowRight size={16}/></button><button className="button text" type="button" onClick={sample}>Use fictional example</button></div>
              </fieldset>
              {preview&&<section className="member-preview"><h3>Check before sending.</h3><p>Nothing has been delivered yet. Only the values below will be shared.</p><ReviewDays submission={{days:preview}} metrics={metrics}/><button className="button primary" disabled={busy} onClick={()=>void run(send)}>Send to care team<ArrowRight size={16}/></button></section>}
            </>}
          </section>
          <details className="member-sharing"><summary>Your sharing choices · {shared.length} signals</summary><p>{shared.map(m=>m.label).join(', ')}</p><p>Stop new uploads and withdraw pending summaries. Accepted readings remain in the demo record. This does not change permissions in Apple Health, Health Connect, or another provider.</p><button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await care('/member/revoke',{});invalidate();await refresh();setNotice('Sharing ended. No new summaries can be sent through this connection.')})}>Stop sharing & withdraw pending</button></details>
        </>}
        {data.status==='revoked'&&<section className="care-empty"><h2>Your sharing has ended.</h2><p>New submissions are blocked and pending summaries have been withdrawn. Previously accepted readings remain in the demo record. Ask the care team for a new invitation if you want to start again.</p></section>}
        <section className="member-history"><div className="care-review-heading"><div><h2>Your delivery history</h2><p>See what was received and what the care team did with it.</p></div><button className="button secondary" disabled={busy} onClick={()=>void run(refresh)}>Refresh status</button></div>{!data.submissions.length?<p className="care-small">No summaries sent yet.</p>:data.submissions.map(s=><article key={s.id}><div className="care-review-heading"><strong>{s.days[0].timestamp}{s.days.length>1?` → ${s.days.at(-1)!.timestamp}`:''}</strong><span className={`care-status ${s.status}`}>{statusNames[s.status]}</span></div><p>Sent {dateTime(s.created)} · {s.days.length} day{s.days.length===1?'':'s'}</p>{s.review_note&&<p className="care-note">Care team: {s.review_note}</p>}<ReviewDays submission={s} metrics={metrics}/></article>)}</section>
      </>}
      <footer className="member-footer">Synthetic-data research demonstration · Not an emergency service · No treatment advice</footer>
    </main>
  </div>
}
