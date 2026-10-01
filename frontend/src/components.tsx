import { Activity, HeartPulse, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import type { Contribution, Observation, Signal, Twin } from './types'

export const percent = (value:number|null|undefined) => value == null ? '—' : `${Math.round(value*100)}%`
export const riskClass = (status:string) => status === 'High risk' ? 'high' : status === 'Watch' ? 'watch' : status === 'Stable' ? 'stable' : 'unknown'
export function Badge({status}:{status:string}) { return <span className={`badge ${riskClass(status)}`}><i/>{status}</span> }

export function HeartVisual({twin, small=false}:{twin?:Twin|null; small?:boolean}) {
  return <div className={`heart-visual ${small?'small':''}`}>
    <svg viewBox="0 0 320 300" role="img" aria-label="Illustrated digital heart with a monitoring pulse">
      <defs><linearGradient id="heartFill" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#dc7e6b"/><stop offset="1" stopColor="#a34442"/></linearGradient><linearGradient id="heartLobe"><stop stopColor="#f4b29c"/><stop offset="1" stopColor="#c66458"/></linearGradient><radialGradient id="heartGlow"><stop stopColor="#d77d67" stopOpacity=".15"/><stop offset="1" stopColor="#d77d67" stopOpacity="0"/></radialGradient></defs>
      <circle cx="160" cy="158" r="127" fill="url(#heartGlow)"/><circle cx="160" cy="158" r="113" fill="none" stroke="#dfdad0" strokeDasharray="3 7"/><circle cx="160" cy="158" r="87" fill="none" stroke="#e5dfd4"/>
      <path d="M151 92 C146 64 151 44 170 42 L183 44 L181 71 C171 78 174 98 181 110" fill="#bf655b" stroke="#f1c2af" strokeWidth="2"/>
      <path d="M164 88 C179 59 193 63 202 78 L190 94 L204 101" fill="#e09177" stroke="#f1c2af" strokeWidth="2"/>
      <path className="heart-shape" d="M156 96 C122 74 94 96 93 130 C76 164 105 201 129 223 C143 237 167 257 180 243 C204 221 227 178 224 145 C223 117 194 102 176 113 C171 108 164 101 156 96 Z" fill="url(#heartFill)" stroke="#b9695e" strokeWidth="1.5"/>
      <path d="M154 101 C126 109 131 150 144 174 C157 202 165 226 180 243 C204 213 216 183 213 157 C210 129 187 113 174 116" fill="url(#heartLobe)" opacity=".75"/>
      <path d="M155 101 C168 127 153 153 166 174 C175 193 183 208 185 232 M163 145 L188 157 L206 178 M163 145 L144 165 L130 190 M167 178 L155 198" stroke="#914b45" strokeWidth="2.4" fill="none" opacity=".7"/>
      <path d="M103 119 C102 102 120 96 134 99" stroke="#f6c2ae" strokeWidth="6" strokeLinecap="round" fill="none" opacity=".7"/>
      <path d="M38 158 H75 L83 147 L94 177 L107 125 L119 158 H150" fill="none" stroke="#426f62" strokeWidth="2"/>
      <path d="M218 158 H248 L257 150 L265 164 L274 158 H291" fill="none" stroke="#426f62" strokeWidth="2"/>
      <circle cx="38" cy="158" r="3" fill="#426f62"/><circle cx="291" cy="158" r="3" fill="#426f62"/>
    </svg>
    <div className="heart-caption"><span className="live-dot"/> {twin?.quality.baseline_ready?'Personal baseline established':'Patient-specific state'}</div>
  </div>
}

export function TrendChart({rows,signal='risk',baseline,unit='%',compact=false}:{rows:Observation[];signal?:string;baseline?:number|null;unit?:string;compact?:boolean}) {
  const data = rows.map((row,i)=>({x:i,y:typeof row[signal]==='number' ? Number(row[signal])*(signal==='risk'?100:1):null}))
  const valid = data.filter(p=>p.y!==null)
  if (!valid.length) return <div className="empty-chart">Waiting for enough sensor data</div>
  let min = signal==='risk'?0:Math.min(...valid.map(p=>p.y!),baseline??Infinity)
  let max = signal==='risk'?100:Math.max(...valid.map(p=>p.y!),baseline??-Infinity)
  const pad = Math.max((max-min)*.2,1); if(signal!=='risk'){min-=pad;max+=pad}
  const w=680,h=compact?130:208,left=40,right=15,top=15,bottom=30
  const x=(i:number)=>left+(i/Math.max(1,rows.length-1))*(w-left-right)
  const y=(v:number)=>h-bottom-((v-min)/(max-min))*(h-top-bottom)
  let connected=false
  const path=data.map(p=>{if(p.y===null){connected=false;return ''}const command=connected?'L':'M';connected=true;return `${command}${x(p.x)},${y(p.y)}`}).join(' ')
  const last = valid[valid.length-1]
  return <svg className="trend-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${signal} trend across ${rows.length} days; gaps indicate missing readings`}>
    {[0,.25,.5,.75,1].map(t=><g key={t}><line x1={left} y1={y(min+(max-min)*t)} x2={w-right} y2={y(min+(max-min)*t)} stroke="#e8e9e3" strokeDasharray="3 4"/><text x={left-8} y={y(min+(max-min)*t)+4} textAnchor="end" className="chart-label">{Math.round(min+(max-min)*t)}{signal==='risk'?'%':''}</text></g>)}
    {baseline!=null&&<line x1={left} y1={y(baseline)} x2={w-right} y2={y(baseline)} stroke="#91aaa0" strokeDasharray="6 4"/>}
    <path d={path} fill="none" stroke={signal==='risk'?'#c36952':'#376e61'} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx={x(last.x)} cy={y(last.y!)} r="4.5" fill={signal==='risk'?'#c36952':'#376e61'} stroke="#fff" strokeWidth="2"/>
    {[0,Math.floor((rows.length-1)/2),rows.length-1].map((i,j)=><text key={j} x={x(i)} y={h-5} textAnchor={j===0?'start':j===2?'end':'middle'} className="chart-label">{rows[i]?.timestamp?.slice(5)}</text>)}
    <title>{unit} · personal baseline shown as a dashed line where available</title>
  </svg>
}

export function SignalCard({signal,onClick,active}:{signal:Signal;onClick:()=>void;active:boolean}) {
  const down=(signal.delta??0)<0
  const Icon=signal.delta===null?Minus:down?ArrowDownRight:ArrowUpRight
  return <button className={`signal-card ${active?'active':''}`} onClick={onClick}>
    <span className="signal-label">{signal.label}</span><strong>{signal.value===null?'—':signal.key==='steps'?Math.round(signal.value).toLocaleString():signal.value.toFixed(signal.key==='weight'||signal.key==='sleep_hours'?1:0)} <small>{signal.unit}</small></strong>
    <span className="signal-delta"><Icon size={13}/>{signal.delta===null?'Reading missing':`${signal.delta>=0?'+':''}${signal.delta.toFixed(signal.key==='weight'?1:0)} vs personal baseline`}</span>
  </button>
}

export function Contributions({values,limit=6}:{values:Contribution[];limit?:number}) {
  const items=values.slice(0,limit),max=Math.max(...items.map(x=>Math.abs(x.contribution)),.001)
  return <div className="contributions">{items.map(item=><div className="contribution" key={item.feature}><div><span>{item.label}</span><b className={item.contribution>=0?'text-coral':'text-green'}>{item.contribution>0?'+':''}{item.contribution.toFixed(2)}</b></div><div className="contribution-track"><i style={{width:`${Math.abs(item.contribution)/max*100}%`,background:item.contribution>=0?'#c57b66':'#6f998b'}}/></div></div>)}</div>
}

export function TwinIndices({twin}:{twin:Twin}) {
  return <div className="indices">{twin.indices.map(index=><div className="index" key={index.name}><div><span>{index.name}</span><b>{index.value===null?'—':Math.round(index.value)}<small>/100</small></b></div><div className="index-track"><i style={{width:`${index.value??0}%`,background:index.direction==='burden'?'#c8836e':'#71988a'}}/></div></div>)}</div>
}

export function Logo(){return <div className="logo"><span><HeartPulse size={22}/></span><div>CardioTwin<small>HEART FAILURE INTELLIGENCE</small></div></div>}
export function Loading(){return <div className="loading"><Activity className="pulse" size={30}/><span>Connecting to the patient twins…</span></div>}
