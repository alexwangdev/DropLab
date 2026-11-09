import { useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, type ColDef, type GridReadyEvent } from 'ag-grid-community';
import { AllEnterpriseModule, IntegratedChartsModule } from 'ag-grid-enterprise';
import { AgChartsEnterpriseModule } from 'ag-charts-enterprise';
import { droplabTheme } from '../theme';
import { money } from '../api';

// Integrated charts need the AG Charts Enterprise module, registered via IntegratedChartsModule.with().
ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule, IntegratedChartsModule.with(AgChartsEnterpriseModule)]);

export interface SplitRow {
  role: string;
  amount_cents: number;
  /** The supplier share of a staged order: not paid by this batch, released by milestone. */
  staged?: boolean;
}

/**
 * AG Grid Enterprise integrated pie chart of the latest payout split.
 * Source: the 'payout' entry in the ledger (its detail.splits), written from the real Payouts batch.
 * Nothing here is assumed: no margin, no estimated cost.
 */
export default function PayoutChart({ split, batchRef }: { split: SplitRow[] | null; batchRef: string | null }) {
  const chartHost = useRef<HTMLDivElement>(null);

  if (!split || split.length === 0) {
    return <p className="muted">No payout yet. The split chart appears after a sandbox payout completes.</p>;
  }

  // A staged share is labelled, so the pie never shows it as paid.
  const rows = split.map((r) => (r.staged ? { ...r, role: `${r.role} (staged)` } : r));

  const columnDefs: ColDef<SplitRow>[] = [
    { field: 'role', headerName: 'Share', flex: 1 },
    { field: 'amount_cents', headerName: 'Amount', flex: 1, valueFormatter: (p) => money(Number(p.value)), aggFunc: 'sum' },
  ];

  function onGridReady(e: GridReadyEvent<SplitRow>) {
    if (!chartHost.current) return;
    try {
      e.api.createRangeChart({
      cellRange: { columns: ['role', 'amount_cents'] },
      chartType: 'pie',
      chartContainer: chartHost.current,
      chartThemeName: 'ag-default',
    });
    } catch (err) {
      console.error('[payout-chart] createRangeChart failed:', (err as Error).message);
    }
  }

  return (
    <div>
      <p className="muted">
        Source: payout batch <code>{batchRef ?? '—'}</code> (ledger payout entry). The split comes from server math; a staged supplier share is released by milestone.
      </p>
      <div className="grid-wrap" style={{ height: 160 }}>
        <AgGridReact<SplitRow>
          theme={droplabTheme}
          rowData={rows}
          columnDefs={columnDefs}
          enableCharts={true}
          cellSelection={true}
          onGridReady={onGridReady}
        />
      </div>
      <div ref={chartHost} data-demo="payout-pie" style={{ height: 300, marginTop: 12 }} />
    </div>
  );
}
