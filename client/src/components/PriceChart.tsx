import { useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, type ColDef, type GridReadyEvent } from 'ag-grid-community';
import { AllEnterpriseModule, IntegratedChartsModule } from 'ag-grid-enterprise';
import { AgChartsEnterpriseModule } from 'ag-charts-enterprise';
import { droplabTheme } from '../theme';
import type { Product } from '../api';
import { money } from '../api';

// Integrated charts are registered in PayoutChart.tsx too; registering again is a no-op.
ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule, IntegratedChartsModule.with(AgChartsEnterpriseModule)]);

interface Row {
  title: string;
  retailer: string;
  price_usd: number; // price in dollars for the chart axis; cents stay the stored value
}

/**
 * Bar chart: one bar per product, price in USD, from the Channel3 results on this drop.
 * Source label is shown in the UI. Nothing here is margin or assumed cost.
 */
export default function PriceChart({ products }: { products: Product[] }) {
  const host = useRef<HTMLDivElement>(null);
  const rows: Row[] = products.map((p) => ({ title: p.title, retailer: p.retailer, price_usd: p.price_cents / 100 }));
  if (rows.length === 0) return <p className="muted">No products yet. The price chart appears once Channel3 results load.</p>;

  const columnDefs: ColDef<Row>[] = [
    { field: 'title', headerName: 'Product', flex: 2 },
    { field: 'retailer', headerName: 'Retailer', flex: 1 },
    { field: 'price_usd', headerName: 'Price (USD)', flex: 1, valueFormatter: (p) => money(Math.round(Number(p.value) * 100)) },
  ];

  function onGridReady(e: GridReadyEvent<Row>) {
    if (!host.current) return;
    e.api.createRangeChart({
      cellRange: { columns: ['title', 'price_usd'] },
      chartType: 'bar',
      chartContainer: host.current,
      chartThemeName: 'ag-default',
    });
  }

  return (
    <div>
      <p className="muted">Source: Channel3 search results for this drop (price per product, USD). Not margin: no supplier cost data is used.</p>
      <div className="grid-wrap" style={{ height: 180 }}>
        <AgGridReact<Row>
          theme={droplabTheme}
          rowData={rows}
          columnDefs={columnDefs}
          enableCharts={true}
          cellSelection={true}
          onGridReady={onGridReady}
        />
      </div>
      <div ref={host} style={{ height: 320, marginTop: 12 }} />
    </div>
  );
}
