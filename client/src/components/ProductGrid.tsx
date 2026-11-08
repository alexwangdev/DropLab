import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, type ColDef, type GridReadyEvent, type SelectionChangedEvent } from 'ag-grid-community';
import { AllEnterpriseModule } from 'ag-grid-enterprise';
import { droplabTheme } from '../theme';
import type { Product } from '../api';
import { money } from '../api';

ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule]);

/** Product thumbnail (image from Channel3). Shows a dash when Channel3 sent no image. */
function ThumbCell(p: ICellRendererParams<Product>) {
  if (!p.value) return <span>—</span>;
  return <img src={String(p.value)} alt="" width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} />;
}

interface Props {
  products: Product[];
  onSelectionChange: (selected: Product[]) => void;
}

export default function ProductGrid({ products, onSelectionChange }: Props) {
  const columnDefs = useMemo<ColDef<Product>[]>(
    () => [
      { field: 'image_url', headerName: 'Image', width: 80, filter: false, sortable: false, cellRenderer: ThumbCell },
      { field: 'title', headerName: 'Product', flex: 2 },
      { field: 'retailer', headerName: 'Retailer', flex: 1, enableRowGroup: true, enablePivot: true, filter: 'agSetColumnFilter' },
      {
        field: 'price_cents',
        headerName: 'Price',
        flex: 1,
        filter: 'agNumberColumnFilter',
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
