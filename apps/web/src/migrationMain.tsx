import React from 'react';
import ReactDOM from 'react-dom/client';
import Migration from './pages/Migration';
import MigrationExport from './mobile/MigrationExport';
import AppErrorBoundary from './components/AppErrorBoundary';
import { ThemeProvider } from './lib/theme';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><ThemeProvider>
  {import.meta.env.MODE==='mobile'?<MigrationExport/>:<Migration/>}
</ThemeProvider></AppErrorBoundary></React.StrictMode>);
