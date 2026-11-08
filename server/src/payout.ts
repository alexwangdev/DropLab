// Payout idempotency decision. Pure: the HTTP route and the tests both use it.

export type PayoutDecision =
  | { action: 'reject'; status: 409; error: string }
  | { action: 'reuse'; batch_id: string }
  | { action: 'create' };

export function decidePayout(args: { orderStatus: string; hasCapture: boolean; existingBatchId: string | null }): PayoutDecision {
  if (args.orderStatus !== 'COMPLETED' || !args.hasCapture) {
    return { action: 'reject', status: 409, error: 'order must be captured (COMPLETED) before payouts' };
  }
  if (args.existingBatchId) return { action: 'reuse', batch_id: args.existingBatchId };
  return { action: 'create' };
}
