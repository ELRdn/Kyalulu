import React from 'react';
import ReactDOM from 'react-dom/client';
import MobileApp from './MobileApp';
import '../index.css';
import MigrationExport from './MigrationExport';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{new URL(location.href).searchParams.get('migrate')==='1'?<MigrationExport/>:<MobileApp/>}</React.StrictMode>);
