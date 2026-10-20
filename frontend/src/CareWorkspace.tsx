import { useEffect, useRef, useState } from 'react'
import type { Patient } from './types'
import { ArrowRight, Check, ShieldCheck } from './icons'
import { care, dateTime, sourceNames, statusNames } from './careClient'
import type { CareSubmission, CareWorkspaceData, Metric } from './careClient'

export default function CareWorkspace({patients,patientId,onSaved,onPatientOpen}:{patients:Patient[];patientId:string;onSaved:()=>Promise<void>;onPatientOpen:(id:string)=>void}) {
  const [data,setData]=useState<CareWorkspaceData|null>(null),[metrics,setMetrics]=useState<Metric[]>([])
  const [access,setAccess]=useState(''),[demo,setDemo]=useState(false),[patient,setPatient]=useState(patientId)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false)
  const [link,setLink]=useState(''),[selected,setSelected]=useState(''),[note,setNote]=useState('')
  const lock=useRef(false)
  const refresh=async()=>{setData(await care<CareWorkspaceData>('/workspace'))}
  useEffect(()=>{
    let active=true
    care<{metrics:Metric[];demo_access:boolean}>('/config').then(c=>{if(active){setMetrics(c.metrics);setDemo(c.demo_access)}}).catch(e=>{if(active)setError(e.message)})
    care<CareWorkspaceData>('/workspace').then(d=>{if(active)setData(d)}).catch(()=>{}).finally(()=>{if(active)setReady(true)})
    return()=>{active=false}
  },[])
  useEffect(()=>{
    if(patientId){setPatient(patientId);setLink('')}
  },[patientId])
  const run=async(action:()=>Promise<void>)=>{
    if(lock.current)return
    lock.current=true;setBusy(true);setError('');setNotice('')
    try{await action()}catch(e){setError((e as Error).message)}finally{lock.current=false;setBusy(false)}
  }
  const invite=async()=>{
    const result=await care<{token:string}>('/invitations',{patient_id:patient})
    setLink(`${location.origin}/#join/${result.token}`);await refresh();setNotice('Invitation created. The link expires in 48 hours and can be opened once.')
  }
  const review=data?.submissions.find(s=>s.id===selected)
  const decide=async(decision:string)=>{
    if(!review)return
    const result=await care<{status:string}>(`/submissions/${review.id}/review`,{decision,note})
    await refresh();setNote('');setNotice(result.status==='accepted'?'Readings added to the patient record. The twin will use the accepted days.':'Summary returned with your correction note.')
    if(result.status==='accepted')await onSaved()
  }
  return <section className="care-workspace" aria-labelledby="care-title">
    <div className="care-heading"><div><h2 id="care-title">Member sharing and review</h2><p>Invite a member, receive only the signals they choose to share, and review each summary before it enters the patient record.</p></div><span className="care-demo"><ShieldCheck size={17}/> Fictional-data workspace</span></div>
    <ol className="care-steps"><li>Invite a member</li><li>Member chooses signals</li><li>Daily readings arrive</li><li>Review & update the twin</li></ol>
    {error&&<div className="error" role="alert">{error}</div>}{notice&&<p className="care-notice" role="status"><Check size={17}/>{notice}</p>}
    {!ready?<p role="status">Loading sharing workspace…</p>:!data?<form className="care-signin" onSubmit={e=>{e.preventDefault();void run(async()=>{await care('/login',{access_key:demo?'demo-clinician':access});await refresh()})}}>
      <div><h3>Clinician workspace</h3><p>Member invitations and review decisions require a clinician session.</p></div>
      {demo?<p>This local demo uses a demo clinician session. Use fictional data only.</p>:<label>Clinician access key<input type="password" autoComplete="current-password" required value={access} onChange={e=>setAccess(e.target.value)}/></label>}
      <button className="button primary" disabled={busy} type="submit">{busy?'Opening…':demo?'Enter clinician demo':'Sign in'}<ArrowRight size={16}/></button>
    </form>:<>
      <div className="care-toolbar"><p>{data.submissions.filter(s=>s.status==='pending').length} awaiting review · {data.enrollments.filter(e=>e.status==='active').length} members sharing</p><div><button className="button secondary" disabled={busy} onClick={()=>void run(refresh)}>Refresh reviews</button><button className="button text" disabled={busy} onClick={()=>void run(async()=>{await care('/logout',{});setData(null);setLink('')})}>Sign out</button></div></div>
      <div className="care-columns">
        <section className="care-enrollment"><h3>Invite a member</h3><p>The invitation links their portal to exactly one patient.</p>
          <form onSubmit={e=>{e.preventDefault();void run(invite)}}><label htmlFor="care-patient">Patient record</label><select id="care-patient" value={patient} disabled={busy} onChange={e=>{setPatient(e.target.value);setLink('')}}>{patients.map(p=><option key={p.patient_id} value={p.patient_id}>{p.patient_id} · {p.name}</option>)}</select><button className="button primary" disabled={busy||!patient} type="submit">Create member invitation<ArrowRight size={16}/></button></form>
          {link&&<div className="care-invite-result"><label htmlFor="member-link">One-time member link</label><input id="member-link" readOnly value={link} onFocus={e=>e.target.select()}/><p>Share this link privately with the intended member. It grants access to that member’s submission portal.</p><div><button className="button secondary" onClick={()=>void run(async()=>{await navigator.clipboard.writeText(link);setNotice('Member link copied.')})}>Copy link</button><a className="button secondary" href={link} target="_blank" rel="noreferrer">Open member portal<ArrowRight size={15}/></a></div></div>}
          <h3 className="care-section-title">Sharing connections</h3>
          {!data.enrollments.length?<p>No invitations yet. Start with a fictional patient above.</p>:<ul className="connection-list">{data.enrollments.map(enrollment=><li key={enrollment.id}><div><strong>{enrollment.patient_id}</strong><span className={`care-status ${enrollment.status}`}>{statusNames[enrollment.status]}</span><p>{enrollment.consent?`${enrollment.consent.metrics.length} signals shared`:`Expires ${dateTime(enrollment.expires)}`}</p></div>{!['revoked','expired'].includes(enrollment.status)&&<button className="button text" disabled={busy} onClick={()=>void run(async()=>{await care(`/enrollments/${enrollment.id}/revoke`,{});setLink('');await refresh();setNotice('Sharing ended. Pending summaries were withdrawn.')})}>End sharing</button>}</li>)}</ul>}
        </section>
        <section className="care-inbox"><h3>Incoming summaries</h3><p>Received values remain separate from the patient record until accepted.</p>
          {!data.submissions.length?<div className="care-empty"><h4>Ready when your member is.</h4><p>After they open the invitation and send a daily summary, it will appear here with its source, coverage, and sharing history.</p></div>:<>
            <div className="submission-list">{data.submissions.map(s=><button key={s.id} className={`submission-row ${selected===s.id?'selected':''}`} onClick={()=>{setSelected(s.id);setNote('')}}><span><strong>{s.patient_id}</strong><small>{s.days[0].timestamp}{s.days.length>1?` → ${s.days.at(-1)!.timestamp}`:''} · {s.days.length} day{s.days.length===1?'':'s'}</small></span><span className={`care-status ${s.status}`}>{statusNames[s.status]}</span></button>)}</div>
            {review?<div className="submission-review"><div className="care-review-heading"><h4>{review.patient_id} · Summary review</h4><span>Received {dateTime(review.created)}</span></div><ReviewDays submission={review} metrics={metrics}/>
              {review.status==='pending'?<><label htmlFor="review-note">Review note <small>(required when requesting a correction)</small></label><textarea id="review-note" maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Explain a data-quality issue or record a review note."/><div className="care-actions"><button className="button primary" disabled={busy} onClick={()=>void run(()=>decide('accept'))}>Accept & update twin<Check size={16}/></button><button className="button secondary" disabled={busy||note.trim().length<3} onClick={()=>void run(()=>decide('reject'))}>Request correction</button></div><p className="care-small">Accepting appends the next consecutive days. It does not confirm a diagnosis or a treatment decision.</p></>:<><p className="care-note">{review.review_note||statusNames[review.status]}</p>{review.status==='accepted'&&<button className="button secondary" onClick={()=>onPatientOpen(review.patient_id)}>Open patient twin<ArrowRight size={16}/></button>}</>}
            </div>:<p className="care-small">Choose a summary to inspect its daily values and review it.</p>}
          </>}
        </section>
      </div>
      {!!data.events.length&&<details className="care-audit"><summary>Sharing activity · {data.events.length} recent events</summary><ul>{data.events.slice(0,15).map(event=><li key={event.id}><span>{event.kind.replaceAll('_',' ')}</span><time>{dateTime(event.at)}</time></li>)}</ul></details>}
    </>}
  </section>
}

export function ReviewDays({submission,metrics}:{submission:{days:CareSubmission['days']};metrics:Metric[]}) {
  return <div className="review-days">{submission.days.map(day=><details key={day.timestamp} open={submission.days.length===1}><summary>{day.timestamp} · {sourceNames[day.source]||day.source} · {Math.round(day.coverage*100)}% coverage</summary><dl>{Object.entries(day.values).map(([key,value])=><div key={key}><dt>{metrics.find(m=>m.key===key)?.label||key}</dt><dd>{value.toLocaleString(undefined,{maximumFractionDigits:3})} <small>{metrics.find(m=>m.key===key)?.unit}</small></dd></div>)}</dl>{!!day.missing.length&&<p className="care-small">Missing: {day.missing.map(key=>metrics.find(m=>m.key===key)?.label||key).join(', ')}. Missing readings stay missing; the risk model may abstain.</p>}</details>)}</div>
}
