/** Real components against an isolated ASGI database through the loopback test broker. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import Publications from '../pages/Publications';
import Published, { PublishedDetail } from '../pages/Published';
import CommunityWorks from './CommunityWorks';
import Home from '../pages/Home';
import RuntimeGate from './RuntimeGate';
import { clearDeviceOwner, rememberOwner, preferences, savePreferences, type AppPreferences } from '../lib/appContext';
import { setCloud, setCloudOwner } from '../lib/cloudMode';
import '../index.css';

export function identity(owner:string,ticket:string,language:'ja'|'en'='ja'){
  localStorage.setItem('kyalulu-execution-target','cloud');localStorage.setItem('kyalulu-eligibility-ticket',ticket);
  setCloud(true);setCloudOwner(owner);if(owner)rememberOwner(owner);else clearDeviceOwner();savePreferences({...preferences(),language,country:'JP',age:20,accepted:true});
}
export function preference(value:Partial<AppPreferences>){savePreferences({...preferences(),...value});}
function Navigation({ready}:{ready:(go:(path:string)=>void)=>void}){const navigate=useNavigate();ready(navigate);return null;}
export function mount(node:HTMLElement,ready:(go:(path:string)=>void)=>void,path='/publications'){const root=createRoot(node);root.render(<StrictMode><MemoryRouter initialEntries={[path]}><Navigation ready={ready}/><Routes><Route path="/" element={<RuntimeGate><Home/></RuntimeGate>}/><Route path="/publications" element={<Publications/>}/><Route path="/published" element={<Published/>}/><Route path="/published/:publicationId" element={<PublishedDetail/>}/><Route path="/recommendations" element={<CommunityWorks/>}/></Routes></MemoryRouter></StrictMode>);return root;}
