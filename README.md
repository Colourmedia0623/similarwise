# Similarwise

Competitor intelligence for Shopify brands, inside the Shopify admin. A
merchant adds the stores they compete with; Similarwise checks each one every
day and shows what changed.

## What it does today (Phase 1, first slice)

- **Competitors** (`/app/competitors`): add up to 5 stores by their website.
- **Store tracking**, from each competitor's public pages only:
  - the home page, for the platform, Shopify theme, well-known apps (Klaviyo,
    Judge.me, Recharge…) and the ad and analytics pixels it loads (Meta,
    Google Ads, TikTok, Pinterest…), which show where they are set up to
    advertise;
  - for Shopify stores, the public catalogue (`/products.json`), for product
    launches, price cuts and rises, and products taken down.
- **Overview** (`/app`): this week's changes across all competitors, each
  competitor's ad channels, product count and average price, and the latest
  activity.
- **Competitor page** (`/app/competitors/:id`): store details, ad channels,
  apps, change history, newest products and the catalogue over time.

Checks run when a competitor is added, on "Check now", and hourly in the
background for any competitor not checked in a day (`app/lib/tracker/schedule.server.ts`).

## Not yet

From the roadmap: traffic and keyword estimates and Google ads (DataForSEO),
Meta and TikTok ad libraries, ad spend estimates, alerts and the weekly
digest, plans and billing, and "you vs. them" benchmarks from the shop's own
data.

## Code

- `app/lib/tracker/` — URL checks, safe fetching (public addresses only),
  storefront detection, catalogue parsing, change detection and the checks.
- `app/lib/dashboard.server.ts` — the overview's numbers.
- `prisma/schema.prisma` — competitors, their products, events and snapshots.

## Develop

```
npm ci
npm run dev        # shopify app dev
npm test           # vitest, against a fresh SQLite database
npm run typecheck && npm run lint && npm run build
```

Deploying to EC2: see `deploy/README.md`.
