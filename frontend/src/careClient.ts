export type Metric = {key:string;label:string;unit:string;bounds:[number,number]}
export type CareDay = {timestamp:string;source:string;values:Record<string,number>;missing:string[];coverage:number}
export type CareSubmission = {id:string;patient_id:string;enrollment_id:string;status:string;created:number;reviewed:number|null;review_note:string|null;days:CareDay[]}
export type Enrollment = {id:string;patient_id:string;status:string;expires:number;next_date:string|null;consent:{metrics:string[]}|null}
export type CareWorkspaceData = {enrollments:Enrollment[];submissions:CareSubmission[];events:{id:number;enrollment_id:string;kind:string;at:number}[]}
export type MemberData = {patient:{patient_id:string;name:string};status:string;next_date:string|null;consent:{metrics:string[]}|null;submissions:CareSubmission[]}
export type DayInput = {source:string;timestamp:string;readings:{metric:string;value:number;unit?:string}[]}
export async function care<T>(path:string,body?:unknown):Promise<T> {
  const response=await fetch(`/api/care${path}`, {credentials:'same-origin',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CardioTwin-Action':'1'},body:JSON.stringify(body)})})
  const result=await response.json()
  if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:Array.isArray(result.detail)?result.detail.map((e:{msg:string})=>e.msg).join('; '):'Unable to complete this step. Try again.')
  return result
}
export const sourceNames:Record<string,string>={manual:'Home readings',apple_health:'Apple Health export',health_connect:'Health Connect export',samsung_health:'Samsung Health export',google_health:'Google / Fitbit export',garmin:'Garmin export',oura:'Oura export'}
export const statusNames:Record<string,string>={invited:'Invitation sent',joined:'Choosing signals',active:'Sharing active',expired:'Invitation expired',revoked:'Sharing ended',pending:'Awaiting review',accepted:'Added to record',rejected:'Needs correction',withdrawn:'Withdrawn'}
export const dateTime=(seconds:number)=>new Date(seconds*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})

// Deliberately narrow interchange format: a daily summary, not a vendor's raw export.
export function parseDailyCsv(text:string,source:string,metrics:Metric[]):DayInput[] {
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(line=>line.trim())
  if(lines.length<2||lines.length>32)throw new Error('Use a header and between 1 and 31 daily rows.')
  if(text.includes('"'))throw new Error('Use the daily-summary template without quoted fields. Raw vendor exports need a separate adapter.')
  const headers=lines[0].split(',').map(v=>v.trim())
  if(headers[0]!=='date'||new Set(headers).size!==headers.length)throw new Error('The first column must be date, with no repeated columns.')
  if(headers.slice(1).some(h=>!metrics.some(m=>m.key===h)))throw new Error('This file contains unsupported columns. Download the daily-summary template.')
  return lines.slice(1).map((line,index)=>{
    const cells=line.split(',').map(v=>v.trim())
    if(cells.length!==headers.length)throw new Error(`Row ${index+2} has the wrong number of columns.`)
    const readings=headers.slice(1).flatMap((key,i)=>{
      if(!cells[i+1])return []
      const value=Number(cells[i+1])
      if(!Number.isFinite(value))throw new Error(`Row ${index+2}: ${key} must be a number.`)
      return [{metric:key,value,unit:metrics.find(m=>m.key===key)!.unit}]
    })
    return {source,timestamp:cells[0],readings}
  })
}

export function downloadCsv(date:string,metrics:Metric[]) {
  const content=`date,${metrics.map(m=>m.key).join(',')}\n${date},${metrics.map(()=>'').join(',')}\n`
  const url=URL.createObjectURL(new Blob([content],{type:'text/csv'}))
  const link=document.createElement('a');link.href=url;link.download='cardiotwin-daily-summary.csv';link.click();URL.revokeObjectURL(url)
}
