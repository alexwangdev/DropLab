import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { AllEnterpriseModule } from 'ag-grid-enterprise';
import type { LedgerEntry } from '../api';
import { money } from '../api';
import { droplabTheme } from '../theme';
import { VerdictPill } from './VerdictPill';

ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule]);

/** Links to the real PayPal object where one exists. Never invents an ID. */
function paypalUrl(ref: string | null, kind: string): string | null {
  if (!ref) return null;
  if (kind === 'capture') return `https://www.sandbox.paypal.com/activity/payment/${ref}`;
  if (kind === 'order_created') return `https://www.sandbox.paypal.com/checkoutnow?token=${ref}`;
  return null;
}

/** React cell renderer: real PayPal ref, linked where a sandbox page exists. */
function PayPalRefCell(p: ICellRendererParams<LedgerEntry>) {
  if (!p.value) return <span>—</span>;
  const url = paypalUrl(String(p.value), p.data?.kind ?? '');
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      {String(p.value)}
    </a>
  ) : (
    <span>{String(p.value)}</span>
  );
}

interface Props {
  entries: LedgerEntry[];
  chain: { ok: boolean; entries: number; broken_at_seq: number | null } | null;
  onVerify: () => void;
}

export default function LedgerGrid({ entries, chain, onVerify }: Props) {
  const columnDefs = useMemo<ColDef<LedgerEntry>[]>(
    () => [
      { field: 'seq', headerName: '#', width: 80, sort: 'asc' },
      { field: 'created_at', headerName: 'Time', flex: 1, valueFormatter: (p) => new Date(String(p.value)).toLocaleTimeString() },
      { field: 'kind', headerName: 'Kind', flex: 1, enableRowGroup: true },
      { field: 'actor', headerName: 'Actor', width: 110, enableRowGroup: true },
      { field: 'amount_cents', headerName: 'Amount', width: 110, valueFormatter: (p) => money(Number(p.value)) },
      { field: 'paypal_ref', headerName: 'PayPal ref', flex: 1.2, cellRenderer: PayPalRefCell },
      { field: 'verdict', headerName: 'Verdict', width: 120, cellRenderer: VerdictPill },
      { field: 'hash', headerName: 'Hash', width: 130, valueFormatter: (p) => String(p.value ?? '').slice(0, 12) },
    ],
    [],
  );

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={onVerify}>Verify chain</button>
        {chain && chain.ok && <span className="badge badge-live">Chain verified: {chain.entries} entries</span>}
        {chain && !chain.ok && <span className="badge badge-broken">CHAIN BROKEN at #{chain.broken_at_seq}</span>}
      </div>
      <div className="grid-wrap" style={{ height: 320 }}>
        <AgGridReact<LedgerEntry>
          theme={droplabTheme}
          rowData={entries}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          sideBar={{ toolPanels: ['columns', 'filters'] }}
          rowGroupPanelShow="always"
          getRowId={(p) => p.data.id}
        />
      </div>
    </div>
  );
}
