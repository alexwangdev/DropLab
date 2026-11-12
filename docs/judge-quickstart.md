# Judge quickstart

DropLab is a creator-side pop-up drop planner. It runs on PayPal **sandbox** only. No real money moves.

**Live URL:** https://droplab-5d3k.onrender.com. You can also run it locally (see the README, "Run locally").

## Four steps (a few minutes once the app is running)

1. **Open the storefront.** On the create page, press **Load demo drop**, then **Open storefront** on the drop page. You see the buyer's page: products with real Channel3 prices, a countdown and sell-through (`#N of M`).
2. **Reserve with the sandbox buyer.** Press **Reserve with PayPal** on a product. On PayPal, log in with the sandbox buyer account below and approve. DropLab captures the order, and the page shows **You're in — #N of M** with the PayPal order ID.
3. **Watch the money split.** Press **Pay creator + platform now**. One PayPal Payouts batch pays the Organizer 70% and DropLab 10%. The Supplier's 20% bucket is marked **STAGED · released by milestone**. The order, capture and batch IDs are listed once below.
4. **Release the supplier by milestone.** Go back to the drop page. In **Supplier tranches**, press **Mark complete & release** on **Ship**: the supplier gets 40% of the pool as its own Payouts batch, the batch ID and ledger number appear, and the Ship bar on the Gantt turns green. Sell and Payout release the rest the same way, in order.

The two-minute figure is not timed yet. Time it on a fresh run before quoting it.

## Sandbox buyer account

- Email: `<sandbox buyer email: ask the presenter>`
- Password: **ask the presenter for the sandbox buyer password.** It is not stored in this repository.

This is a PayPal sandbox account. It has no real funds.

## Notes

- The demo drop is created with fixed values: "3-day beach pop-up in Toronto, budget $500", capacity 50, and a closing date 3 days from today.
- The browser remembers the demo drop it created, so **Load demo drop** opens that drop again instead of creating a duplicate. A fresh browser creates a new one.
- Products come from Channel3. If Channel3 is unavailable, the drop uses labelled `SEED DEMO` products, shown with a badge.
- Nothing in this repository is a secret. Keys live in the server environment (`.env`, or Render's environment settings).
