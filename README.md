# Fish Feeder — Monitoring, Scheduling & Latency Dashboard (v2)

**Student:** Mohamad Adam Bin Mohd Faizal (22002016)  
**Programme:** Bachelor of Information Technology (Hons), Universiti Teknologi PETRONAS  
**Hardware:** MeeGoo Smart Fish Feeder (`a33d5216f7875b6d3er7kk`, product `p8t4ieonxa7laylq`, category `cwwsq`) via Tuya Singapore OpenAPI (`https://openapi-sg.iotbing.com`) + ESP32-S3 with ADXL345 accelerometer.

---

## 1. Important Hardware Note: Disable Tuya/Smart Life App Schedules

**Disable all feeding schedules inside the Tuya / Smart Life mobile app.**  
All scheduled feeds must be managed exclusively from this dashboard's **Schedule** page (`/schedule`). If the feeder also runs an internal schedule in the Tuya app, it will dispense portions without notifying this server and the tracked hopper portion count will drift from reality.

---

## 2. Database Setup (Archive v1, Create v2 Schema)

1. **Before running any SQL:** if you have not already exported your v1 live logs, download your current LIVE CSV from the v1 dashboard and keep a backup copy.
2. Open your Supabase project → **SQL Editor**.
3. Paste and run [`supabase/01_archive.sql`](./supabase/01_archive.sql).
   - This renames `feed_logs` → `legacy_feed_logs_20261113` and `feeder_state` → `legacy_feeder_state_20261113` (no data is deleted) and drops the v1 RPC functions.
4. Paste and run [`supabase/02_schema.sql`](./supabase/02_schema.sql).
   - Creates `calibrations`, `feeder_settings`, `trigger_sources`, `feed_schedules`, `feed_events`, `refill_events`, `sensor_readings`, `device_heartbeats`, and `notifications` with RLS enabled and atomic RPC functions (`reserve_feed`, `refund_feed`, `refill_hopper`, `apply_calibration`, `ingest_telemetry`, `sensor_buckets`, `sensor_stats`, `export_sensor_chunk`, `cleanup_sensor_readings`, `dev_reset`).

---

## 3. Environment Variables & Cloudflare Secrets

Copy `.env.example` to `.env.local` (for `npm run dev`) and `.dev.vars.example` to `.dev.vars` (for `npm run preview`):

```ini
NEXT_PUBLIC_SUPABASE_URL=https://kgvzxravpwiwdrtcbzli.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=      # optional: only for Realtime read of sensor_readings
SUPABASE_SERVICE_ROLE_KEY=          # server only
TUYA_CLIENT_ID=
TUYA_CLIENT_SECRET=
TUYA_DEVICE_ID=a33d5216f7875b6d3er7kk
TUYA_BASE_URL=https://openapi-sg.iotbing.com
FEED_API_TOKEN=
CRON_SECRET=
TELEGRAM_BOT_TOKEN=                 # optional
TELEGRAM_CHAT_ID=                   # optional
RESEND_API_KEY=                     # optional
ALERT_EMAIL_TO=                     # optional
```

### `wrangler secret put` commands for Cloudflare Workers deployment

Run these commands to upload each server secret to Cloudflare Workers:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put TUYA_CLIENT_ID
npx wrangler secret put TUYA_CLIENT_SECRET
npx wrangler secret put FEED_API_TOKEN
npx wrangler secret put CRON_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ALERT_EMAIL_TO
```

If you also use Supabase Realtime on the Sensors page, set `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `wrangler.jsonc` under `"vars"` (or via `npx wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY`).

---

## 4. Running & Testing Locally (Including Cron Triggers)

```bash
npm install
npm run dev
```

To test the OpenNext Cloudflare Worker bundle and the `* * * * *` Cron Trigger locally:

```bash
npx @opennextjs/cloudflare build
npx wrangler dev --test-scheduled
```

Then trigger the scheduled handler manually in another terminal:

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

Or click **Settings → Developer tools → Run scheduler now** in the dashboard UI.

---

## 5. Cloudflare Workers Free Plan Request Budget & Storage Estimate

### 5.1 Daily Request Budget (Limit: 100,000 requests/day on Workers Free plan)

Static assets (`/_next/static/*`, fonts, icons) are served by Cloudflare Workers Static Assets and **do not count** toward the 100,000/day Worker invocation limit. Worker invocations by source:

| Source | Rate | Daily requests |
|---|---|---|
| ESP32 batched telemetry (`POST /api/esp32/telemetry`, 1 batch every 2 s) | 30 / min | **43,200 / day** |
| Cron trigger (`* * * * *` `scheduled()` handler) | 1 / min | **1,440 / day** |
| Dashboard live sensor viewing (Supabase Realtime preferred = 0 Worker polls; fallback polling `GET /api/esp32/readings` every 2 s for ~2 hours/day of active tab viewing) | 30 / min while open | **0 – 3,600 / day** |
| Feed triggers + RTT follow-ups + page API loads | ~100 / day | **~100 / day** |
| **Total estimated Worker requests** | | **44,740 – 48,340 / day (< 49% of the 100,000/day free limit)** |

### 5.2 Database Storage Estimate (30-Day Sensor Retention)

- At 1 summary row per second, the ESP32 produces $86,400$ rows/day, or $2,592,000$ rows over 30 days.
- Each `sensor_readings` row (`bigint` id, `text` device_id, `timestamptz`, five `real` columns, `smallint` rssi, `uuid` batch_id) plus its `(device_id, recorded_at desc)` B-tree index entry uses approximately **135–150 bytes**.
- **30-day total:** $\approx 350\text{–}390\text{ MB}$ (or proportionally less when the ESP32 is only powered during experiment sessions).
- The hourly cleanup step in `/api/cron/tick` calls `cleanup_sensor_readings(sensor_retention_days)` to delete rows older than 30 days (configurable in Settings).
