import type { Product } from './api';

// Pre-built AG Studio dashboard (state format verified in ag-studio 3.1.0 typings: AgReportState ->
// pages -> widgets / widgetLayout / layout). The schema exposes fields table-qualified, so every
// field id is "<table>.<column>". Bare ids fail validation with "does not exist in the schema".
//
// Widgets:
//  - "prices": grouped column chart, average price (USD) by retailer
//  - "products": grid of the products on this drop with price and stock

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
          products: {
            type: 'grid',
            format: { title: { text: 'Products on this drop', enabled: true } },
            dataMapping: {
              cols: [f('product'), f('retailer'), f('price_usd'), f('stock')],
            },
          },
        },
        widgetLayout: {
          prices: { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 6 },
          products: { xTrack: 6, yTrack: 0, xSpan: 6, ySpan: 6 },
        },
        layout: { type: 'widget' as const, columns: 12, rowHeight: 40 },
      },
    ],
  };
}
