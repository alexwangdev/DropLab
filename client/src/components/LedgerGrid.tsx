import { useMemo, useRef, useState } from 'react';
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
  // W-A: only entries that arrive after the page loaded slide in, and only the newest one.
  const baseline = useRef<number | null>(null);
  if (baseline.current === null && entries.length > 0) baseline.current = Math.max(...entries.map((e) => e.seq));
  const newest = entries.length ? Math.max(...entries.map((e) => e.seq)) : 0;
  // W-A verify: spinner while the chain is checked, then a check mark.
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  function onVerifyClick() {
    setVerified(false);
    setVerifying(true);
    Promise.resolve(onVerify()).finally(() => {
      setTimeout(() => {
        setVerifying(false);
        setVerified(true);
      }, 300);
    });
  }

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
        <button onClick={onVerifyClick} disabled={verifying}>Verify chain</button>
        {verifying && <span className="spinner" aria-label="verifying" />}
        {!verifying && verified && <span className="check-in">✓</span>}
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
          getRowClass={(p) => (p.data && p.data.seq === newest && baseline.current !== null && newest > baseline.current ? 'ledger-new' : undefined)}
        />
      </div>
    </div>
  );
}
