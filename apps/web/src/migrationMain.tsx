import React from 'react';
import ReactDOM from 'react-dom/client';
import Migration from './pages/Migration';
import MigrationExport from './mobile/MigrationExport';
import AppErrorBoundary from './components/AppErrorBoundary';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary>
  {import.meta.env.MODE==='mobile'?<MigrationExport/>:<Migration/>}
</AppErrorBoundary></React.StrictMode>);
