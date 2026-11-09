import { useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, type ColDef, type GridApi, type GridReadyEvent, type SelectionChangedEvent } from 'ag-grid-community';
import { AllEnterpriseModule, AiToolkitModule } from 'ag-grid-enterprise';
import { droplabTheme } from '../theme';
import type { Product } from '../api';
import { money } from '../api';

ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule, AiToolkitModule]);

/** Product thumbnail (image from Channel3). Shows a dash when Channel3 sent no image. */
function ThumbCell(p: ICellRendererParams<Product>) {
  if (!p.value) return <span>—</span>;
  return <img src={String(p.value)} alt="" width={56} height={56} style={{ objectFit: 'contain', borderRadius: 6, background: '#f3f5f8' }} />;
}

interface Props {
  products: Product[];
  onSelectionChange: (selected: Product[]) => void;
  /** W-4: the page can set the selection (after a substitute). Optional; the grid still owns its own selection. */
  selectedIds?: string[];
}

export default function ProductGrid({ products, onSelectionChange, selectedIds }: Props) {
  const gridApi = useRef<GridApi<Product> | null>(null);
  useEffect(() => {
    const api = gridApi.current;
    if (!api || !selectedIds) return;
    const want = new Set(selectedIds);
    api.forEachNode((n) => n.setSelected(!!n.id && want.has(n.id)));
  }, [selectedIds]);
  const [aiSchema, setAiSchema] = useState<string | null>(null);
  const columnDefs = useMemo<ColDef<Product>[]>(
    () => [
      // U-3: explicit widths and minimums so every header shows in full on a 1200px page.
      { field: 'image_url', headerName: 'Image', width: 96, minWidth: 96, filter: false, sortable: false, cellRenderer: ThumbCell },
      { field: 'title', headerName: 'Product', flex: 2, minWidth: 220 },
      { field: 'retailer', headerName: 'Retailer', flex: 1, minWidth: 130, enableRowGroup: true, enablePivot: true, filter: 'agSetColumnFilter' },
      {
        field: 'price_cents',
        headerName: 'Price',
        width: 140,
        minWidth: 140,
        filter: 'agNumberColumnFilter',
        // Group rows carry a sum (number); anything else prints blank instead of NaN.
        valueFormatter: (p) => (typeof p.value === 'number' ? money(p.value) : ''),
        sort: 'asc',
        enableValue: true,
        aggFunc: 'sum',
      },
      { field: 'availability', headerName: 'Stock', width: 140, minWidth: 140 },
      { field: 'search_query', headerName: 'Search', width: 180, minWidth: 150, filter: 'agSetColumnFilter' },
      { field: 'source', headerName: 'Data source', width: 160, minWidth: 150 },
    ],
    [],
  );

  // AG Grid AI Toolkit (installed in ag-grid-enterprise): the grid's structured schema for AI services. Not AG Studio.
  function showAiSchema() {
    if (!gridApi.current) return;
    const schema = gridApi.current.getStructuredSchema();
    setAiSchema(JSON.stringify(schema, null, 2).slice(0, 4000));
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button data-demo="ai-schema" onClick={showAiSchema}>Show AI Toolkit schema</button>
      </div>
      {aiSchema && <pre style={{ maxHeight: 220, overflow: 'auto', background: '#f8fafc', padding: 8, fontSize: 12 }}>{aiSchema}</pre>}
    <div className="grid-wrap">
      <AgGridReact<Product>
        theme={droplabTheme}
        rowData={products}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, filter: true, resizable: true }}
        autoGroupColumnDef={{ headerName: 'Retailer group', minWidth: 200 }}
        sideBar={{ toolPanels: ['columns', 'filters'] }}
        rowGroupPanelShow="always"
        initialState={{ rowGroup: { groupColIds: ['retailer'] } }}
        groupDefaultExpanded={1}
        // Only product rows are selectable. Retailer group rows get no checkbox, so a tick always means one product.
        rowSelection={{ mode: 'multiRow', checkboxes: true, headerCheckbox: true, enableClickSelection: false, isRowSelectable: (node) => !node.group, hideDisabledCheckboxes: true }}
        getRowId={(p) => p.data.id}
        onGridReady={(e: GridReadyEvent<Product>) => {
          gridApi.current = e.api;
          e.api.sizeColumnsToFit();
        }}
        onSelectionChanged={(e: SelectionChangedEvent<Product>) =>
          onSelectionChange(e.api.getSelectedRows())
        }
      />
    </div>
    </div>
  );
}
