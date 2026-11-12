# Smart Fish Feeder — Actuation & Latency Study (FYP II)

**Student:** Mohamad Adam Bin Mohd Faizal (22002016)  
**Programme:** Bachelor of Information Technology (Hons), Universiti Teknologi PETRONAS  
**Target Hardware:** MeeGoo Smart Fish Feeder (`a33d5216f7875b6d3er7kk`, product `p8t4ieonxa7laylq`, category `cwwsq`) via Tuya Singapore OpenAPI (`https://openapi-sg.iotbing.com`).

---

## 1. Architecture Overview

```
[Manual Dashboard (/)] ──┐
[Phone Sensor (/sensor)]─┼──► POST /api/feed (+ POST /api/feed/rtt)
[ESP32 + ADXL345] ───────┘         │
                                   ▼
                     Cloudflare Workers (Next.js App Router)
                        ├── Atomic RPC: reserve_portion() / refund_portion() ──► Supabase Postgres (RLS enabled)
                        └── Zero-Dep Web Crypto HMAC-SHA256 Client ───────────► Tuya Cloud (Singapore)
                                                                                      │
                                                                                      ▼
                                                                           MeeGoo Smart Fish Feeder (Wi-Fi)
```

---

## 2. Quick Setup

### 2.1 Database Migration (Supabase)
1. Open your Supabase project → **SQL Editor**.
2. Paste the contents of [`supabase/migration.sql`](./supabase/migration.sql) and click **Run**.

### 2.2 Local Environment Variables
Copy `.env.example` to `.env.local` (for `npm run dev`) and `.dev.vars.example` to `.dev.vars` (for `npm run preview`):

```bash
cp .env.example .env.local
cp .dev.vars.example .dev.vars
```

Fill in your credentials:
```ini
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
TUYA_CLIENT_ID=<your-tuya-access-id>
TUYA_CLIENT_SECRET=<your-tuya-access-secret>
TUYA_DEVICE_ID=a33d5216f7875b6d3er7kk
TUYA_BASE_URL=https://openapi-sg.iotbing.com
FEED_API_TOKEN=<choose-a-strong-secret-token>
```

### 2.3 Install & Run Locally
```bash
npm install
npm run dev
```
Open `http://localhost:3000`, enter your `FEED_API_TOKEN`, and press **Feed Now**.

To test in the local Cloudflare Workers runtime before deploying:
```bash
npm run preview
```

---

## 3. Deploy to Cloudflare Workers

1. Authenticate Wrangler (if not already logged in):
   ```bash
   npx wrangler login
   ```
2. Upload each server-only secret to Cloudflare Workers:
   ```bash
   npx wrangler secret put NEXT_PUBLIC_SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put TUYA_CLIENT_ID
   npx wrangler secret put TUYA_CLIENT_SECRET
   npx wrangler secret put TUYA_DEVICE_ID
   npx wrangler secret put TUYA_BASE_URL
   npx wrangler secret put FEED_API_TOKEN
   ```
3. Build and deploy with OpenNext for Cloudflare:
   ```bash
   npm run deploy
   ```
   Wrangler will print your live `https://fish-feeder.<subdomain>.workers.dev` URL.

---

## 4. Smoke Tests (`curl`)

Replace `<BASE_URL>` with `http://localhost:3000` or your `https://*.workers.dev` URL, and `<TOKEN>` with your `FEED_API_TOKEN`:

1. **Unauthorized check (expects `401`):**
   ```bash
   curl -i -X POST <BASE_URL>/api/feed \
     -H "Content-Type: application/json" \
     -d '{"source":"MANUAL_APP"}'
   ```
2. **Authorized feed trigger (expects `200` and physical food drop):**
   ```bash
   curl -i -X POST <BASE_URL>/api/feed \
     -H "Content-Type: application/json" \
     -H "x-feed-token: <TOKEN>" \
     -d '{"source":"MANUAL_APP","runLabel":"smoke-test"}'
   ```
3. **Cooldown enforcement check (run twice within 5 seconds → second call returns `429`):**
   ```bash
   curl -i -X POST <BASE_URL>/api/feed \
     -H "Content-Type: application/json" \
     -H "x-feed-token: <TOKEN>" \
     -d '{"source":"MANUAL_APP","runLabel":"cooldown-test"}'
   ```
4. **Stats endpoint check (`GET /api/stats`):**
   ```bash
   curl -s <BASE_URL>/api/stats | head -c 500
   ```
5. **Verify no secrets leaked into client bundle (after `npm run preview` or `npm run deploy`):**
   ```bash
   grep -rn "<YOUR_TUYA_CLIENT_SECRET>" .open-next/assets/ || echo "Clean: no secrets in client assets"
   ```

