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
