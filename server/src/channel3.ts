import { CHANNEL3_API_KEY } from './config.js';

export interface FoundProduct {
  channel3_id: string;
  title: string;
  image_url: string | null;
  price_cents: number;
  currency: string;
  retailer: string;
  availability: string;
}

/**
 * Channel3 POST /v1/search (docs: https://channel3.mintlify.dev/docs/api-reference/v1/search).
 * Price comes from offers[].price.price. Search prices are NOT re-checked here;
 * the pre-checkout re-check is a P1 item.
 */
export async function searchProducts(query: string, limit = 4): Promise<FoundProduct[]> {
  if (!CHANNEL3_API_KEY) throw new Error('CHANNEL3_API_KEY is not set');

  const res = await fetch('https://api.trychannel3.com/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CHANNEL3_API_KEY,
    },
    body: JSON.stringify({
      query,
      limit,
      config: { country: 'US', currency: 'USD', language: 'en' },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Channel3 search failed: HTTP ${res.status} ${text.slice(0, 300)}`);

  const json = JSON.parse(text) as { products?: any[] };
  const out: FoundProduct[] = [];
  const seen = new Set<string>();
  for (const p of json.products ?? []) {
    const offer = (p.offers ?? []).find(
      (o: any) => o?.price && typeof o.price.price === 'number' && o.price.currency === 'USD' && o.availability === 'InStock',
    );
    if (!offer) continue; // never invent a price: skip products without a usable offer
    // Channel3 returns the same listing more than once; keep the first copy only.
    const dedupeKey = `${String(p.title).toLowerCase()}|${offer.domain}|${offer.price.price}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const image = (p.images ?? []).find((i: any) => i.is_main_image)?.url ?? p.images?.[0]?.url ?? null;
    out.push({
      channel3_id: String(p.id),
      title: String(p.title),
      image_url: image,
      price_cents: Math.round(offer.price.price * 100),
      currency: 'USD',
      retailer: String(offer.domain ?? 'unknown'),
      availability: offer.availability,
    });
    if (out.length === limit) break;
  }
  return out;
}

/**
 * Pre-checkout re-check (spec §4): GET /v1/products/{id} for the live offer price.
 * Returns null when the product has no in-stock USD offer any more.
 */
export async function recheckProduct(channel3Id: string): Promise<{ price_cents: number; availability: string; retailer: string } | null> {
  if (!CHANNEL3_API_KEY) throw new Error('CHANNEL3_API_KEY is not set');
  const res = await fetch(`https://api.trychannel3.com/v1/products/${encodeURIComponent(channel3Id)}`, {
    headers: { 'x-api-key': CHANNEL3_API_KEY },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Channel3 product re-check failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  const p = JSON.parse(text);
  const offer = (p.offers ?? []).find(
    (o: any) => o?.price && typeof o.price.price === 'number' && o.price.currency === 'USD' && o.availability === 'InStock',
  );
  if (!offer) return null;
  return { price_cents: Math.round(offer.price.price * 100), availability: offer.availability, retailer: String(offer.domain ?? 'unknown') };
}
