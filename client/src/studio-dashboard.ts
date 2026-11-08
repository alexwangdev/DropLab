import type { Product } from './api';

// Pre-built AG Studio dashboard (state format verified in ag-studio 3.1.0 typings: AgReportState ->
// pages -> widgets / widgetLayout / layout). The schema exposes fields table-qualified, so every
// field id is "<table>.<column>". Bare ids fail validation with "does not exist in the schema".
//
// Chart-only dashboard. The Studio products-table widget was cut: the grid widget in ag-studio 3.1.0 renders
// no rows on a verified config (see docs/ag-grid-studio.md). The products are in the AG Grid table on the Drop page.
//
// Widgets:
//  - "prices": grouped column chart, average price (USD) by retailer (full width)

export const PRODUCTS_TABLE = 'products';

export function productRows(products: Product[]) {
  return products.map((p) => ({
    product: p.title,
    retailer: p.retailer,
    price_usd: p.price_cents / 100,
    stock: p.availability,
    search_query: p.search_query ?? 'seed demo data',
  }));
}

const f = (column: string) => ({ id: `${PRODUCTS_TABLE}.${column}` });

export function buildDashboardState() {
  return {
    selectedPageId: 'overview',
    pages: [
      {
        id: 'overview',
        widgets: {
          prices: {
            type: 'column-chart-grouped',
            format: { title: { text: 'Average price by retailer (USD, Channel3 results)', enabled: true } },
            dataMapping: {
              categoryKey: [f('retailer')],
              valueKey: [{ ...f('price_usd'), aggregation: 'avg' }],
            },
          },
        },
        widgetLayout: {
          prices: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 6 },
        },
        layout: { type: 'widget' as const, columns: 12, rowHeight: 40 },
      },
    ],
  };
}
