import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchWithFallback, type McpSearch } from '../src/channel3-mcp.js';
import { mapProducts, type FoundProduct } from '../src/channel3.js';

const REST_PRODUCT: FoundProduct = {
  channel3_id: 'rest-1', title: 'REST tote', image_url: null, price_cents: 2800, currency: 'USD', retailer: 'rest.example', availability: 'InStock',
};
const MCP_PRODUCT: FoundProduct = {
  channel3_id: 'mcp-1', title: 'MCP tote', image_url: null, price_cents: 6900, currency: 'USD', retailer: 'mcp.example', availability: 'InStock',
};

test('MCP error falls back to REST: no throw, source rest, the exact MCP error is kept', async () => {
  const calls: string[] = [];
  const out = await searchWithFallback('beach tote', 6, null, {
    mcp: async () => {
      calls.push('mcp');
      throw new Error('MCP HTTP 503: upstream unavailable');
    },
    rest: async (q, limit) => {
      calls.push(`rest:${q}:${limit}`);
      return [REST_PRODUCT];
    },
  });
  assert.deepEqual(calls, ['mcp', 'rest:beach tote:6']);
  assert.equal(out.source, 'rest');
  assert.equal(out.mcp_error, 'MCP HTTP 503: upstream unavailable');
  assert.deepEqual(out.products, [REST_PRODUCT]);
});

test('a working MCP result is used and REST is not called', async () => {
  let restCalled = false;
  const mcpResult: McpSearch = { products: [MCP_PRODUCT], thread_id: 'thread-abc' };
  const out = await searchWithFallback('beach tote', 6, null, {
    mcp: async () => mcpResult,
    rest: async () => {
      restCalled = true;
      return [];
    },
  });
  assert.equal(restCalled, false);
  assert.equal(out.source, 'mcp');
  assert.equal(out.mcp_error, null);
  assert.equal(out.thread_id, 'thread-abc');
});

test('mapProducts drops products without an in-stock USD offer and keeps the first duplicate only', () => {
  const raw = [
    { id: 'a', title: 'Shirt', offers: [{ domain: 'x.com', price: { price: 20, currency: 'USD' }, availability: 'OutOfStock' }] },
    { id: 'b', title: 'Hat', offers: [{ domain: 'y.com', price: { price: 15, currency: 'EUR' }, availability: 'InStock' }] },
    { id: 'c', title: 'Tee', images: [{ url: 'https://img/1', is_main_image: true }], offers: [{ domain: 'z.com', price: { price: 30, currency: 'USD' }, availability: 'InStock' }] },
    { id: 'd', title: 'Tee', offers: [{ domain: 'z.com', price: { price: 30, currency: 'USD' }, availability: 'InStock' }] },
  ];
  const out = mapProducts(raw, 6);
  assert.deepEqual(out.map((p) => p.channel3_id), ['c']);
  assert.equal(out[0].price_cents, 3000);
  assert.equal(out[0].image_url, 'https://img/1');
});
