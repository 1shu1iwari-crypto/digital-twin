import { ArrowUpRight, ArrowDownRight, Minus } from './icons'
import type { Contribution, Observation, Signal, Twin } from './types'

export const percent = (value:number|null|undefined) => value == null ? '—' : `${Math.round(value*100)}%`
export const riskClass = (status:string) => status === 'High risk' ? 'high' : status === 'Watch' ? 'watch' : status === 'Stable' ? 'stable' : 'unknown'
export function Badge({status}:{status:string}) { return <span className={`badge ${riskClass(status)}`}><i/>{status}</span> }

export function HeartVisual({twin, small=false}:{twin?:Twin|null; small?:boolean}) {
  return <div className={`heart-visual ${small?'small':''}`}>
    <svg viewBox="0 0 300 280" role="img" aria-label="Decorative ink study of a heart; not a physiological model output">
      <path d="M192 62 C254 87 263 154 215 211 C179 259 105 248 78 203 C48 152 83 72 130 61 C154 53 175 54 192 62Z" fill="#eedfd5"/>
      <g fill="none" stroke="#6d443a" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M139 89 C107 72 88 91 86 117 C70 149 86 178 109 202 C127 220 151 243 170 232 C197 214 222 167 214 136 C207 107 184 99 165 105 C157 100 149 93 139 89Z"/>
        <path d="M139 91 C134 74 134 53 146 39 L162 41 L162 65 C157 75 160 91 167 105 M146 39 L147 24 M154 40 L157 23 M162 41 L169 27"/>
        <path d="M155 83 C168 57 188 59 194 74 L183 87 L198 100 M185 64 L192 48 M191 70 L205 60"/>
        <path d="M141 91 C119 100 123 126 133 148 C145 173 161 197 171 231 M151 109 C167 117 177 141 178 158 C183 178 193 189 194 205"/>
        <path d="M129 129 L109 141 L98 161 M132 146 L119 165 L113 185 M146 169 L129 190 M174 138 L191 153 L207 160 M179 160 L196 177"/>
        <path d="M95 102 C99 92 115 88 128 93 M96 110 C99 100 112 96 125 97" strokeWidth=".8"/>
        <path d="M199 125 C207 139 208 154 201 170 M199 132 C202 144 202 154 199 163" strokeWidth=".8"/>
      </g>
      <path d="M36 132 H62 M226 177 H264 M81 225 H48" stroke="#b8a89a" strokeWidth=".8"/>
      <text x="24" y="121" fontSize="8" fill="#8b796b" fontFamily="monospace">01</text><text x="265" y="180" fontSize="8" fill="#8b796b" fontFamily="monospace">02</text>
    </svg>
    <div className="heart-caption">{twin?.quality.baseline_ready?'Personal baseline established':'A patient-specific model'}<span>Illustration, not measured anatomy</span></div>
  </div>
}

export function TrendChart({rows,signal='risk',baseline,unit='%',compact=false}:{rows:Observation[];signal?:string;baseline?:number|null;unit?:string;compact?:boolean}) {
  const data = rows.map((row,i)=>({x:i,y:typeof row[signal]==='number' ? Number(row[signal])*(signal==='risk'?100:1):null}))
  const valid = data.filter(p=>p.y!==null)
  if (!valid.length) return <div className="empty-chart">Waiting for enough sensor data</div>
  let min = signal==='risk'?0:Math.min(...valid.map(p=>p.y!),baseline??Infinity)
  let max = signal==='risk'?100:Math.max(...valid.map(p=>p.y!),baseline??-Infinity)
  const pad = Math.max((max-min)*.2,1); if(signal!=='risk'){min-=pad;max+=pad}
  const w=compact?300:680,h=compact?90:208,left=compact?5:72,right=compact?5:15,top=compact?10:24,bottom=compact?10:30
  const x=(i:number)=>left+(i/Math.max(1,rows.length-1))*(w-left-right)
  const y=(v:number)=>h-bottom-((v-min)/(max-min))*(h-top-bottom)
  let connected=false
  const path=data.map(p=>{if(p.y===null){connected=false;return ''}const command=connected?'L':'M';connected=true;return `${command}${x(p.x)},${y(p.y)}`}).join(' ')
  const last = valid[valid.length-1]
  return <svg className="trend-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${signal} trend across ${rows.length} days; gaps indicate missing readings`}>
    {!compact&&[0,.25,.5,.75,1].map(t=><g key={t}><line x1={left} y1={y(min+(max-min)*t)} x2={w-right} y2={y(min+(max-min)*t)} stroke="#e8e9e3" strokeDasharray="3 4"/><text x={left-8} y={y(min+(max-min)*t)+4} textAnchor="end" className="chart-label">{Math.round(min+(max-min)*t)}{signal==='risk'?'%':''}</text></g>)}
    {baseline!=null&&<line x1={left} y1={y(baseline)} x2={w-right} y2={y(baseline)} stroke="#91aaa0" strokeDasharray="6 4"/>}
    <path d={path} fill="none" stroke={signal==='risk'?'#c36952':'#376e61'} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx={x(last.x)} cy={y(last.y!)} r="4.5" fill={signal==='risk'?'#c36952':'#376e61'} stroke="#fff" strokeWidth="2"/>
    {!compact&&[0,Math.floor((rows.length-1)/2),rows.length-1].map((i,j)=><text key={j} x={x(i)} y={h-5} textAnchor={j===0?'start':j===2?'end':'middle'} className="chart-label">{rows[i]?.timestamp?.slice(5)}</text>)}
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

export function Logo(){return <div className="logo"><svg viewBox="0 0 36 36" aria-hidden="true"><rect x="1" y="1" width="34" height="34" rx="7" fill="currentColor"/><path d="M6 19 H11 L14 11 L19 25 L23 16 L26 19 H30" stroke="#faf7f1" strokeWidth="1.8" fill="none" strokeLinejoin="round" strokeLinecap="round"/></svg><div>cardiotwin<span className="logo-hf"> / hf</span></div></div>}
export function Loading(){return <div className="loading" role="status" aria-label="Loading patient data"><span>Loading patient readings</span><div className="skeleton-heading"/><div className="skeleton-grid">{[0,1,2].map(x=><i key={x}/>)}</div><div className="skeleton-table">{[0,1,2,3].map(x=><i key={x}/>)}</div></div>}
