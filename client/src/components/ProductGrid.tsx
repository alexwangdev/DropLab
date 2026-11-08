import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, type ColDef, type GridReadyEvent, type SelectionChangedEvent } from 'ag-grid-community';
import { AllEnterpriseModule } from 'ag-grid-enterprise';
import { droplabTheme } from '../theme';
import type { Product } from '../api';
import { money } from '../api';

// Enterprise features run on the trial watermark. TODO: call LicenseManager.setLicenseKey() here only once a
// trial key has been requested and provided. No key is set in this repo yet.
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
