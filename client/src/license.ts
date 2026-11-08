import { LicenseManager } from 'ag-grid-enterprise';
import { LicenseManager as ChartsLicenseManager } from 'ag-charts-enterprise';

// AG Grid and AG Charts Enterprise trial key for this application (evaluation only).
// The key is public (it ships in the client bundle), not a secret. It is a single-application
// developer licence and deactivates on 8 December 2026. Judging runs to 15 December 2026, so
// request an extension or a production key before then.
export const AG_LICENSE_KEY =
  'REDACTED_KEY';

/** Applies the key to both AG Grid and AG Charts. Call once, before any grid renders. */
export function applyAgLicense(): void {
  LicenseManager.setLicenseKey(AG_LICENSE_KEY);
  ChartsLicenseManager.setLicenseKey(AG_LICENSE_KEY);
}

// Bryntum Gantt Enterprise trial key (evaluation). Public, like the AG key, not a secret.
// Set on the global before the first Gantt is created. Licence expires 23 December 2026 (per the key payload).
export const BRYNTUM_LICENSE_KEY =
  'REDACTED_KEY';

/**
 * Sets the Bryntum key on the global. Must run before the Gantt library loads, so main.tsx imports
 * this module first (side effect at import time).
 */
export function applyBryntumLicense(): void {
  (globalThis as any).bryntum = (globalThis as any).bryntum ?? {};
  (globalThis as any).bryntum.licenseKey = BRYNTUM_LICENSE_KEY;
}

// Side effect: set the Bryntum key as soon as this module loads, before any Gantt import.
applyBryntumLicense();
