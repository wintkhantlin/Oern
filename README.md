# Oern: Door-to-door delivery platform

Oern connects customers, riders, managers, sellers, and support staff in a live delivery workflow. Customers track parcels from pickup to delivery. Operations teams coordinate dispatch, fleet readiness, payments, and support.

- **Live app:** https://oern.vercel.app
- **Demo app:** https://oern-app.vercel.app
- **Demo video:** 90-second hackathon walkthrough in [`remotion-demo/`](remotion-demo/); see the [storyboard](remotion-demo/STORYBOARD.md)
- **Pitch video:** [Google Drive folder](https://drive.google.com/drive/folders/1z0_khOiw90ut2f7kGJ0RGgGg520V0kng)
- **Repository:** https://github.com/wintkhantlin/Oern

## The problem

Delivery workflows often leave customers without updates after handoff. Drivers may plan routes manually, managers reconcile cash and fleet status by hand, and sellers and support teams lack a unified view of local and provider orders. These gaps can lead to uncertain ETAs, missing cash-on-delivery records, idle vehicles, and support cases without delivery context.

## How Oern works

Oern provides five role-based workspaces backed by shared delivery data. Supabase Auth handles sign-in, and row-level security (RLS) limits access by role. Tracking starts when a rider receives a parcel and continues until delivery closes.

Dispatch recommendations consider rider availability, workload, proximity, and parcel capacity. Oern recalculates ETAs using route progress, vehicle speed, and manager-verified road reports.

## Features

- **Customer:** Request a pickup in three steps, track an order on a live map, review status history and ETA, view cash-on-delivery (COD) details, and receive status and arrival notifications.
- **Driver/Rider:** Review assigned tasks, confirm pickups, share GPS location for collected parcels, navigate with Google Maps, plan multi-stop routes, record COD, and complete or report failed deliveries.
- **Manager:** Create orders with optional map pins, assign riders and vehicles, manage rider availability, monitor active riders, and oversee fleet readiness, maintenance, and delivery costs.
- **Seller:** Submit delivery requests, register commerce channels, import external orders, and monitor a unified order queue.
- **Support:** Search delivery history, review local and provider shipment context, assign cases, and record resolutions. Complaint classification uses Jev via OpenRouter, with a pattern-based fallback.
- **Operations:** Estimate fuel- and battery-aware routes from saved pins and vehicle range or reserve; register commerce providers and import orders; and track COD and mobile wallet settlements for KBZPay, WavePay, AYA Pay, and CB Pay.

## Data attribution and limitations

Yangon traffic inputs draw on the Japan International Cooperation Agency (JICA) YUTRA study, including survey data from 2013. Treat these as historical inputs, not live traffic observations. The extracted values and cited source tables have not been independently reconciled against the report.

## Technology

- **Frontend:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4, and MUI
- **Backend and data:** Supabase PostgreSQL, RLS, Realtime WebSockets, and Supabase SSR
- **Maps:** Mapbox GL v3, OpenStreetMap fallback, and Mapbox Matrix API
- **Routing and AI:** Adaptive Large Neighborhood Search (ALNS) vehicle-routing solver and Jev complaint classification via OpenRouter
- **Tooling:** Bun 1.4, Biome, Playwright, Vitest, and the Node.js test runner
- **Demo video:** Remotion

## Architecture

```text
src/
  app/            # Next.js routes: /, /rider, /manager, /seller, /support, /api/*
  components/     # Role workspaces and shared UI
  lib/            # Delivery logic, routing, classification, Supabase clients
supabase/
  migrations/     # Versioned schema for profiles, orders, fleet, routes, COD, and more
  tests/          # Transactional SQL workflow checks
docs/             # Architecture, schema, API, operations, and testing
remotion-demo/    # Hackathon demo video
```

Role redirects and data access are enforced by Supabase RLS. Workspaces load live Supabase data; they do not substitute browser-side demo data.

## Get started

Install dependencies, configure the environment, and start the development server:

```bash
bun install
cp .env.example .env.local
bun run dev
```

Add your project values to `.env.local`, then open http://localhost:3000.

### Environment variables

```dotenv
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_public_token
MAPBOX_SERVER_TOKEN=your_mapbox_server_token
OPENROUTER_API_KEY=your_openrouter_api_key
```

Mapbox and OpenRouter settings are optional. Without a public Mapbox token, the app uses OpenStreetMap. `MAPBOX_SERVER_TOKEN` enables `/api/dispatch/plan`. `OPENROUTER_API_KEY` enables AI complaint classification.

## Checks and tests

Run the main checks with:

```bash
bun run lint
bun run test
bun run typecheck
bun run build
```

- **Unit and regression tests:** `bun run test` uses the Node.js built-in test runner and TypeScript stripping. Node.js 22.18 or later is required.
- **End-to-end tests:** `bun run test:e2e` runs Playwright with Supabase mocked in `e2e/support/supabase-mock.ts`.
- **SQL workflows:** `supabase/tests/delivery_workflows.sql` runs in a transaction and rolls back its fixtures.
- **End-to-end typecheck:** `bun run typecheck:e2e`

## Documentation

The [documentation index](docs/README.md) links to the architecture guide, database schema and RLS notes, API reference, operations manual, COD and payment guide, delivery lifecycle, and testing documentation. See [PROJECT_APP.md](PROJECT_APP.md) for the app feature catalog.

## Demo access

The hosted demo may require a VPN, depending on your network, because it connects to Supabase.

| Role | Email | Password |
| --- | --- | --- |
| Rider | `rider.testing@oern.example` | `password` |
| Manager | `manager.testing@oern.example` | `password` |
| Customer | `wintkhantlin@gmail.com` | `password` |

## References

- Japan International Cooperation Agency (JICA), [official YUTRA study summary](https://openjicareport.jica.go.jp/pdf/12182754.pdf)
