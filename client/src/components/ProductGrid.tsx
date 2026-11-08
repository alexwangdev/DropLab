import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, type ColDef, type GridReadyEvent, type SelectionChangedEvent } from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';
import type { Product } from '../api';
import { money } from '../api';

// Enterprise features (grouping, pivot, sidebar) run without a key locally; a watermark shows.
// Set AG_GRID_LICENSE_KEY on the client only if you have a trial key (it is a public key, not a secret).
ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule]);

interface Props {
  products: Product[];
  onSelectionChange: (selected: Product[]) => void;
}

export default function ProductGrid({ products, onSelectionChange }: Props) {
  const columnDefs = useMemo<ColDef<Product>[]>(
    () => [
      { field: 'title', headerName: 'Product', flex: 2 },
      { field: 'retailer', headerName: 'Retailer', flex: 1, enableRowGroup: true, enablePivot: true },
      {
        field: 'price_cents',
        headerName: 'Price',
        flex: 1,
        // Group rows carry a sum (number); anything else prints blank instead of NaN.
        valueFormatter: (p) => (typeof p.value === 'number' ? money(p.value) : ''),
        sort: 'asc',
        enableValue: true,
        aggFunc: 'sum',
      },
      { field: 'availability', headerName: 'Stock', flex: 1 },
      { field: 'source', headerName: 'Data source', flex: 1 },
    ],
    [],
  );

  return (
    <div className="ag-theme-quartz grid-wrap">
      <AgGridReact<Product>
        rowData={products}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, filter: true, resizable: true }}
        autoGroupColumnDef={{ headerName: 'Retailer group', minWidth: 200 }}
        sideBar={{ toolPanels: ['columns', 'filters'] }}
        rowGroupPanelShow="always"
        initialState={{ rowGroup: { groupColIds: ['retailer'] } }}
        groupDefaultExpanded={1}
        rowSelection={{ mode: 'multiRow', checkboxes: true, headerCheckbox: true, enableClickSelection: false }}
        getRowId={(p) => p.data.id}
        onGridReady={(e: GridReadyEvent<Product>) => e.api.sizeColumnsToFit()}
        onSelectionChanged={(e: SelectionChangedEvent<Product>) =>
          onSelectionChange(e.api.getSelectedRows())
        }
      />
    </div>
  );
}
