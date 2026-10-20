import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import MemberPortal from './MemberPortal'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/newsreader/wght-italic.css'
import './styles.css'
import './care.css'
function Root() {
  const [hash,setHash]=React.useState(location.hash)
  React.useEffect(()=>{const update=()=>setHash(location.hash);addEventListener('hashchange',update);return()=>removeEventListener('hashchange',update)},[])
  const member=hash==='#member'||hash.startsWith('#join/')
  return member?<MemberPortal key={hash.startsWith('#join/')?hash:'member'} invitation={hash.startsWith('#join/')?hash.slice(6):null}/>:<App/>
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>)
