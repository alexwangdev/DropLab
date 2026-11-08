import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles.css';
import { applyLicenses, loadClientConfig } from './license';

// Licences first, then the app. The App import is dynamic so the Gantt and grid libraries load
// only after their keys are set.
async function start() {
  const root = ReactDOM.createRoot(document.getElementById('root')!);
  try {
    applyLicenses(await loadClientConfig());
  } catch (e) {
    console.error('[config] could not load licence keys; running unlicensed (watermarks):', (e as Error).message);
  }
  const { default: App } = await import('./App');
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
}

start();
