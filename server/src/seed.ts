import type { NewProduct } from './store.js';

/**
 * Seeded DEMO fallback, used only when a live Channel3 call fails.
 * Clearly marked source: 'seed' so the UI shows it is not live data.
 * These are placeholder items, not real listings.
 */
export function seedProducts(): NewProduct[] {
  return [
    { channel3_id: 'seed-tote', title: '[SEED DEMO] Canvas beach tote', image_url: null, price_cents: 1800, currency: 'USD', retailer: 'seed-demo', availability: 'InStock', source: 'seed' },
    { channel3_id: 'seed-hat', title: '[SEED DEMO] Bucket hat', image_url: null, price_cents: 1500, currency: 'USD', retailer: 'seed-demo', availability: 'InStock', source: 'seed' },
    { channel3_id: 'seed-tee', title: '[SEED DEMO] Graphic tee', image_url: null, price_cents: 2200, currency: 'USD', retailer: 'seed-demo', availability: 'InStock', source: 'seed' },
    { channel3_id: 'seed-shades', title: '[SEED DEMO] Sunglasses', image_url: null, price_cents: 1200, currency: 'USD', retailer: 'seed-demo', availability: 'InStock', source: 'seed' },
  ];
}
