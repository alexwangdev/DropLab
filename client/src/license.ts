import { LicenseManager } from 'ag-grid-enterprise';
import { LicenseManager as ChartsLicenseManager } from 'ag-charts-enterprise';

// Trial licence keys come from the server's environment (AG_GRID_LICENSE_KEY and BRYNTUM_LICENSE_KEY
// in the repo-root .env). The server returns them from GET /api/client-config. They are public trial
// keys, so they reach the browser, but they never live in client source.
//
// AG key: evaluation only, single application, deactivates 8 December 2026.
// Bryntum key: Enterprise trial, licence and support end 23 December 2026.

export interface ClientConfig {
  agGridLicenseKey: string | null;
  bryntumLicenseKey: string | null;
}

export async function loadClientConfig(): Promise<ClientConfig> {
  const r = await fetch('/api/client-config');
  if (!r.ok) throw new Error(`client config failed: HTTP ${r.status}`);
  return (await r.json()) as ClientConfig;
}

/** Applies the keys. Bryntum must get its key before its library loads, so main.tsx awaits this first. */
export function applyLicenses(cfg: ClientConfig): void {
  if (cfg.agGridLicenseKey) {
    LicenseManager.setLicenseKey(cfg.agGridLicenseKey);
    ChartsLicenseManager.setLicenseKey(cfg.agGridLicenseKey);
  }
  if (cfg.bryntumLicenseKey) {
    (globalThis as any).bryntum = (globalThis as any).bryntum ?? {};
    (globalThis as any).bryntum.licenseKey = cfg.bryntumLicenseKey;
  }
}
