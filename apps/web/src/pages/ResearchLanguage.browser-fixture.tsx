/** Disposable Research UI; the browser test supplies fictional Runtime responses. */
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import ResearchPage from './Research';
import BenchmarkLab from './BenchmarkLab';
import { preferences, savePreferences } from '../lib/appContext';
import '../index.css';

export function language(value:'ja'|'en') { savePreferences({...preferences(),language:value}); }
export function mount(node:HTMLElement,value:'ja'|'en',theme:'light'|'dark',view:'research'|'benchmark'='research') {
  localStorage.setItem('kyalulu-execution-target','local');
  language(value);document.documentElement.dataset.theme=theme;
  const root=createRoot(node);
  root.render(<HashRouter><main style={{display:'flex',flexDirection:'column',minHeight:'100vh'}}>{view==='research'?<ResearchPage />:<BenchmarkLab />}</main></HashRouter>);
  return ()=>root.unmount();
}
