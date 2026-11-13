# MASTER PROMPT v2: Redesign & Refactor of the Smart Fish Feeder Dashboard

You are refactoring an existing, working Next.js (App Router) + Cloudflare Workers (`@opennextjs/cloudflare`) + Supabase application that controls a MeeGoo Smart Fish Feeder through the Tuya Cloud API. Read this entire file and inspect the current codebase before changing anything.

If anything here conflicts with current official documentation (Next.js, OpenNext for Cloudflare, Wrangler, Supabase, Tuya), follow the docs and tell me what you changed and why.

**Before you start:** create a git branch `redesign-v2` and commit the current state so nothing is lost.

---

## 0. What must be preserved from the current version

These parts work and must keep working exactly as they do now:

1. **`lib/tuya.ts`**: zero-dependency Tuya client using `fetch()` + Web Crypto HMAC-SHA256, Singapore data center (`https://openapi-sg.iotbing.com`), token caching, v2 shadow endpoint with v1 commands fallback. Do not rewrite the signing logic; only extend it.
2. **Latency methodology**: the triggering client measures its own round trip (`client_rtt_ms`) with `performance.now()` (or `millis()` on the ESP32), the server returns `server_total_ms` and `tuya_api_ms`, and the client reports RTT back via `POST /api/feed/rtt`. Never subtract a client clock from a server clock.
3. **Data integrity**:Charts, statistics, and exports use live data only unless the user explicitly enables demo data, in which case a clear "Demo data – not for report" banner is shown. Never estimate, invent, or clamp measured values. Unmeasured values are `NULL`.
4. **Security**: server-only secrets (never `NEXT_PUBLIC_`), `x-feed-token` header on all write endpoints, server-side cooldown, atomic inventory updates in Postgres, refund on failed Tuya calls, no silent simulation.
5. **Cloudflare compatibility**: `nodejs_compat`, no Node-only Tuya SDKs, client components for anything using browser APIs or charts.

---

## 1. Problems with the current version (fix all of these)

1. **Visual design looks AI-generated and cluttered**: neon colours, glowing badges, an icon on every heading, monospace text everywhere, purple buttons, developer jargon in the UI, everything stacked on one long page.
2. **Live ESP32 sensor stream flashes on and off** instead of showing a continuous stream. Diagnose the actual cause before fixing. Likely causes to check:
   - Latest telemetry kept in a module-level variable. Cloudflare Workers run multiple isolates, so some polls hit an isolate that has the data and others hit one that doesn't. **In-memory state must not be used for anything shared.**
   - The polling code replacing chart state with an empty response, or marking the device offline on a single failed or slow poll.
   - Polling interval shorter than the ESP32's send interval.
3. **Hopper level is tracked in grams with inconsistent history** (calibration values were changed mid-run, refills jump to arbitrary levels). It must be tracked in **whole portions**, with grams shown only as an estimate.
4. **Wording is technical and inconsistent** (see the glossary in §7).
5. **Downloads are limited** to one CSV. Sensor data in particular cannot be exported.
6. **Feeding is limited**: no portions-per-trigger setting, no schedule, no way to choose which trigger sources are active, no low-food notifications.
7. **ESP32 rows recently fell back to `v1_commands`** without recording why. Log the reason whenever the fallback is used.

---

## 2. Design system (strict)

### 2.1 Overall direction
A calm, professional monitoring dashboard, similar in spirit to Linear, Vercel, or Stripe's dashboards. **Black, white, and greys only.**

- Light theme by default: white page, near-black text, light grey borders. Provide a dark theme as the inverse (near-black page, white text, dark grey borders) following `prefers-color-scheme`, with a manual toggle in Settings.
- **One exception:** a single muted red (e.g. Tailwind `red-600` / `red-500` in dark) is used **only** for critical states: low food, empty hopper, failed feed, device offline. Nothing else is coloured.

### 2.2 Forbidden
- Gradients, glows, neon, coloured shadows, glassmorphism.
- Emoji anywhere.
- Icons beside headings or card titles. Allowed icons (lucide-react, 16px, stroke 1.5): navigation items, download, refresh, close, chevrons, and the menu button on mobile. Nothing else.
- Pill badges for everything. Status uses a small 6px dot + plain text (e.g. "● Online").
- Monospace for anything except IDs and raw values in the data table.
- Developer jargon in the UI (`performance.now()`, `client_rtt_ms`, `POST /api/...`, DP numbers, "LIVE HARDWARE").
- Marketing-style headings or taglines.

### 2.3 Tokens (Tailwind)
- Font: Inter via `next/font` (self-hosted at build), fallback `system-ui, sans-serif`. Numbers use `tabular-nums`.
- Type scale: page title `text-xl font-semibold`, section title `text-sm font-medium`, body `text-sm`, captions `text-xs text-neutral-500`.
- Spacing on an 8px rhythm. Cards: `rounded-lg border border-neutral-200 bg-white p-5` (dark: `border-neutral-800 bg-neutral-950`). No card shadows.
- Buttons:
  - Primary: solid black (white text); inverted in dark mode.
  - Secondary: white with grey border.
  - Destructive: red text with border, used only for reset or delete, always with confirmation.
- Inputs: 36px height, grey border, black focus ring. Visible focus states everywhere.
- Max content width `max-w-7xl`, comfortable whitespace.

### 2.4 Charts
Tailwind cannot draw charts by itself, so keep **Recharts** but style it entirely to match the Tailwind theme:
- Use `currentColor` / CSS variables tied to Tailwind neutral shades. No default Recharts colours.
- Distinguish series by **line style and marker**, not colour: solid (Manual), dashed (Phone), dotted (ESP32), long-dash (Schedule), each with a different marker shape. Every chart has a legend.
- Thin 1px light-grey grid lines (horizontal only), small grey axis labels, no chart borders.
- Threshold and reference lines: dashed. The low-food line uses the muted red.
- Tooltips: white box, grey border, small text, values with units.
- Charts must be responsive and readable on mobile.

### 2.5 Layout
- **Desktop:** fixed left sidebar (220px) with the app name in plain text at the top and nav links. Content area on the right.
- **Mobile:** top bar with app name and a menu button that opens the nav as a sheet.
- Every page: page title + one-line description, then content in a consistent grid.
- Empty, loading (skeleton), and error states for every card and chart.
- Times shown in **Asia/Kuala_Lumpur (UTC+8)**, 24-hour format (`14:05:32`), dates as `13 Nov 2026`.

---

## 3. Information architecture (pages)

| Route | Page | Contents |
|---|---|---|
| `/` | **Overview** | Status summary, quick feed, alerts, recent activity |
| `/feeding` | **Feeding** | Feed now, trigger sources and their settings, safety limits |
| `/schedule` | **Schedule** | Daily feeding times, run history |
| `/hopper` | **Hopper** | Level chart, refill, calibration, refill history |
| `/sensors` | **Sensors** | ESP32 live stream, phone sensor link, sensor statistics |
| `/performance` | **Performance** | Latency charts and summary tables for my report |
| `/data` | **Data** | All downloads |
| `/notifications` | **Notifications** | Alert list and alert settings |
| `/settings` | **Settings** | Access token, feeder connection, theme, developer tools |
| `/sensor` | Phone sensor (standalone, mobile-first) | Unchanged purpose, redesigned |

### 3.1 Overview (`/`)
- **Top row, four stat cards:**
  1. **Hopper**: `32 portions left` (large), `≈ 56 g · 64%` (caption), thin progress bar (black fill, grey track, red when below threshold), and `About 4 days left at current schedule`.
  2. **Feeder**: Online/Offline (from Tuya), Live or Simulation mode, last feed time and source.
  3. **Next feed**: next scheduled time + portions, or "No schedule".
  4. **Today**: portions fed today / daily limit, with a breakdown by source.
- **Quick feed card**: portion stepper (1 to max) + "Feed" button. Shows the result inline ("Fed 2 portions · 812 ms").
- **Alerts card**: active unresolved alerts (low food, offline, failed feeds), each with an action (e.g. "Refill").
- **Recent activity**: last 10 events (feeds, refills, schedule runs, skips) as a simple list: time, event, source, portions, result.
- **Small hopper chart**: last 7 days.

### 3.2 Feeding (`/feeding`)
- **Feed now** with portion stepper and optional test label (for experiments).
- **Trigger sources** table, one row each for Manual, Schedule, ESP32 sensor, Phone sensor:
  - Enabled toggle.
  - Portions per trigger.
  - Cooldown (seconds).
  - Vibration threshold in g (sensor rows only).
  - Last triggered.
- **Feeding mode presets** (buttons that set the toggles above): "Manual only", "Schedule only", "Sensor only (ESP32)", "Phone sensor only", "Schedule + sensor". The table is the source of truth; presets just fill it in.
- **Safety limits:**
  - Daily maximum portions (all sources combined).
  - Quiet hours (e.g. 22:00–06:00) during which **sensor-triggered** feeds are skipped. Rationale for my report: dissolved oxygen drops at night, and feeding then raises ammonia (from my FYP I report).
  - Skip feeding when the hopper is empty (on by default).

### 3.3 Schedule (`/schedule`)
- List of schedule entries: time, days of week, portions, label, enabled toggle, edit, delete.
- "Add feeding time" form: time picker, day checkboxes (default every day), portions, optional label.
- Summary line: `3 feeds per day · 6 portions per day · ≈ 10.6 g per day`.
- **Next 5 upcoming runs.**
- **Run history**: scheduled time, actual time, result (Fed / Skipped: reason / Failed: reason), portions, latency.

### 3.4 Hopper (`/hopper`)
- Current level card (same as Overview).
- **Refill** button opening a dialog with two options: "Full (N portions)" or "Custom: ___ portions". Optional "Measured grams added" field.
- **Hopper level chart**: step chart of remaining portions (left axis) and % (right axis) over time, with a dashed red line at the low-food threshold. Refills appear as vertical jumps and are marked on the x-axis. A filter selects a single refill cycle so a clean full-to-empty curve can be screenshotted.
- **Calibration:**
  - Grams per portion (measured mean) and its standard deviation.
  - Hopper capacity in portions.
  - A small helper: enter the weights of N test portions → computes mean and SD → "Use this value".
  - Calibration changes are versioned (`calibration_id` on each feed) so history stays consistent.
- **Refill history** table.
- Feeder's own low-food sensor reading (from the Tuya status, the current "DP 6"), shown as "Feeder low-food sensor: OK / Low". Use the correct DP code from the device specification rather than the number.

### 3.5 Sensors (`/sensors`)
- **ESP32 status line**: ● Online / Delayed / Offline, last reading time, signal strength, readings per minute.
- **Live chart**: dynamic vibration (g) over the last 2 minutes with the threshold line. Toggles for 2 min / 10 min / 1 h. Below it, current X, Y, Z (m/s²) and dynamic g as plain numbers.
- **Trigger markers**: vertical ticks on the live chart where a sensor feed was triggered.
- **Statistics for the selected range:** mean, peak, and 95th-percentile dynamic g; number of threshold crossings; number of feeds triggered.
- **Phone sensor card**: link to `/sensor`, short instructions, last phone trigger.
- **Download sensor data** button (goes to the Data page with the sensor dataset preselected).
- Remove the hard-coded local IP link to the ESP32 page from the main view. If kept, put it in Settings labelled "ESP32 local page (same Wi-Fi only)".

### 3.6 Performance (`/performance`)
This page is for my FYP report screenshots, so it must be clean and printable.
- Filters: date range, source, test label, include demo data (off by default).
- **Chart A: Command latency by source**: line chart of total latency (ms) per feed, one series per source.
- **Chart B: Latency breakdown**: stacked bars per source: network, Tuya API, server processing (averages).
- **Summary table**: source, n, min, mean, median, p95, max, mean Tuya API time, mean network time, success rate, token refreshes, fallback endpoint count.
- Schedule-triggered feeds have no client, so show their **server-side latency** (`server_total_ms`) in a separate small table, labelled clearly.
- A collapsible "How latency is measured" note in plain language (two or three sentences).
- "Download this table (CSV)" and "Download chart data (CSV)" buttons.
- Print stylesheet: hides the sidebar and controls so the page prints cleanly to PDF.

### 3.7 Data (`/data`)
One card per dataset, each with a date-range picker, a "Live data only" checkbox (on by default), and **Download CSV** (plus **Download JSON**):
1. Feed events (all columns, including latency breakdown, portions, source, result, schedule ID, calibration ID).
2. **Sensor readings** (timestamp, X, Y, Z, dynamic g mean/peak, RSSI, device ID). Large ranges are streamed, not loaded into memory.
3. Hopper level history + refill events.
4. Schedule runs.
5. Notifications.
6. Latency summary (same as the Performance table).

CSV rules: UTF-8, header row, ISO-8601 timestamps **and** a Malaysia local-time column, file names like `feed-events_2026-11-13_to_2026-11-20.csv`.

### 3.8 Notifications (`/notifications`)
- List of alerts: time, type, message, status (active / resolved), mark-as-read.
- **Settings:**
  - Low-food threshold (% of capacity, default 20%).
  - Channels: in-app (always on), browser notifications (while the dashboard is open, using the Notification API), Telegram (bot token + chat ID as server secrets, with a "Send test message" button), email (optional, via Resend if `RESEND_API_KEY` is set).
- **Alert types:**
  - Low food: remaining ≤ threshold **or** the feeder's own low-food sensor reports low.
  - Hopper empty.
  - Feed failed (Tuya error).
  - Feeder offline (Tuya reports offline).
  - ESP32 sensor offline for more than N minutes (default 5).
  - Scheduled feed skipped (with reason).
  - Daily limit reached.
- **De-duplication:** one low-food alert per refill cycle, one offline alert per outage, with a "resolved" event when the condition clears. No spam.

### 3.9 Settings (`/settings`)
- Access token (change / clear).
- Feeder connection: Tuya configured yes/no, device online status, "Test connection" (fetches device status, does **not** feed), simulation mode toggle with confirmation.
- Theme: system / light / dark.
- Time zone (default Asia/Kuala_Lumpur).
- **Developer tools** (collapsed): seed demo data, clear demo data, run scheduler now, **reset database** (typed confirmation "RESET").

### 3.10 Phone sensor (`/sensor`)
Same behaviour as now (iOS permission request inside the click handler, gravity removal, wake lock, local and server cooldown, RTT follow-up), redesigned in the same black-and-white style:
- Large current g value, a small rolling chart, threshold slider.
- Start / Stop button.
- Portions per trigger shown (read-only, set on the Feeding page).
- List of recent triggers with result and latency.
- Clear messages if the Phone sensor source is disabled ("Phone sensor is turned off in Feeding settings").

---

## 4. Database: archive old data, then rebuild cleanly

Write two SQL files for me to paste into the Supabase SQL Editor, in order.

### 4.1 `supabase/01_archive.sql`
**Do not drop my existing data.** Rename current tables with a `legacy_` prefix and date suffix (e.g. `feed_logs` → `legacy_feed_logs_20261113`) and drop old functions. Tell me to export the current LIVE CSV before running it anyway.

### 4.2 `supabase/02_schema.sql`
Idempotent where reasonable. All timestamps `timestamptz`. RLS enabled on every table. No anon policies except a read-only `select` policy on `sensor_readings` if Supabase Realtime is used (§5.2).

**`feeder_settings`** (single row, `id = 1`, `check (id = 1)`):
`capacity_portions int` (default 40), `remaining_portions int` (default 40, `check >= 0`), `grams_per_portion numeric` (default 1.76), `grams_per_portion_sd numeric`, `active_calibration_id bigint`, `low_food_threshold_percent int` (default 20), `daily_max_portions int` (default 20), `quiet_hours_start time`, `quiet_hours_end time`, `skip_when_empty bool` (default true), `simulation_mode bool` (default false), `timezone text` (default `'Asia/Kuala_Lumpur'`), `tuya_low_food bool`, `tuya_online bool`, `tuya_status_checked_at timestamptz`, `updated_at`.

**`trigger_sources`** (one row per source, key `source text primary key`, values `MANUAL`, `SCHEDULE`, `ESP32_SENSOR`, `PHONE_SENSOR`):
`enabled bool`, `portions_per_trigger int` (default 1), `cooldown_seconds int` (default 5), `threshold_g numeric` (sensors only), `last_triggered_at timestamptz`.

**`calibrations`**: `id`, `created_at`, `grams_per_portion`, `sd`, `sample_count`, `capacity_portions`, `notes`.

**`feed_schedules`**: `id`, `time_of_day time`, `days_of_week smallint[]` (0 = Sunday … 6), `portions int`, `label text`, `enabled bool`, `created_at`, `updated_at`.

**`feed_events`** (replaces `feed_logs`):
`id bigint identity`, `created_at`, `source`, `data_origin` (`LIVE` / `SIMULATED` / `SEEDED`), `result` (`FED`, `FAILED`, `SKIPPED_COOLDOWN`, `SKIPPED_DISABLED`, `SKIPPED_EMPTY`, `SKIPPED_DAILY_LIMIT`, `SKIPPED_QUIET_HOURS`), `portions_requested int`, `portions_dispensed int`, `remaining_portions_after int`, `calibration_id`, `schedule_id` (nullable), `scheduled_for timestamptz` (nullable), `test_label text`, `vibration_g numeric`, `tuya_endpoint text`, `fallback_reason text`, `token_refreshed bool`, `tuya_api_ms int`, `server_total_ms int`, `client_rtt_ms int`, `network_ms int`, `error text`.
- Unique index on `(schedule_id, scheduled_for)` where `schedule_id is not null`, so a scheduled run can never fire twice.
- Indexes on `(data_origin, created_at)` and `(source, created_at)`.
- Skipped attempts are logged so the report can show how safety limits behaved, but the cooldown 429s from sensor spam may be logged at most once per cooldown window to avoid flooding.

**`refill_events`**: `id`, `created_at`, `portions_before`, `portions_after`, `grams_added_measured numeric` (nullable), `note`.

**`sensor_readings`**: `id bigint identity`, `device_id text`, `recorded_at timestamptz` (server receive time, plus per-sample offset from the batch), `ax`, `ay`, `az` (m/s², mean over the interval), `dynamic_g_mean`, `dynamic_g_peak`, `rssi int`, `batch_id uuid`. Index on `(device_id, recorded_at desc)`.

**`device_heartbeats`** (or columns on a `devices` table): `device_id`, `last_seen_at`, `last_rssi`, `firmware`, `ip`.

**`notifications`**: `id`, `created_at`, `type`, `severity` (`info` / `warning` / `critical`), `message`, `status` (`active` / `resolved`), `resolved_at`, `read_at`, `dedupe_key text`, `channels_sent text[]`. Partial unique index on `dedupe_key` where `status = 'active'`.

**Functions (via `supabase.rpc`):**
1. `reserve_feed(p_source text, p_portions int, p_now timestamptz)`: locks `feeder_settings` and the `trigger_sources` row; checks source enabled, per-source cooldown, daily maximum (sum of `portions_dispensed` today in the configured time zone), empty hopper; returns `{ ok, reason, portions_reserved, remaining_after }`. If `ok`, decrements `remaining_portions` (never below 0) and updates `last_triggered_at`. Partial dispense when fewer portions remain than requested is allowed only if `skip_when_empty` is false.
2. `refund_feed(p_source text, p_portions int)`.
3. `refill_hopper(p_portions_after int, p_grams_measured numeric, p_note text)`: inserts into `refill_events` and resolves active low-food / empty alerts.
4. `apply_calibration(...)`: inserts into `calibrations` and updates settings.

Quiet-hours checks can be done in TypeScript using the configured time zone before calling `reserve_feed`.

**Seed rows:** the `feeder_settings` row, four `trigger_sources` rows (Manual enabled; others disabled until I enable them), no schedules.

---

## 5. Sensor streaming (fix the flashing)

### 5.1 Ingestion
- `POST /api/esp32/telemetry` (requires `x-feed-token`) accepts a **batch**:
  ```json
  { "deviceId": "esp32-s3-1", "rssi": -55, "firmware": "1.2.0",
    "samples": [ { "offsetMs": 0, "ax": 0.42, "ay": 0.73, "az": -9.71, "gMean": 0.004, "gPeak": 0.011 }, ... ] }
  ```
- The ESP32 summarises internally (e.g. sample at 50–100 Hz, send one summary per second with mean axes, mean and peak dynamic g) and **posts one batch every 2 seconds**. Each request inserts all samples in one database call and updates the heartbeat.
- **Never store sensor state in memory in the Worker.**
- Trigger requests (`POST /api/feed`) stay separate from telemetry, so a feed is never delayed behind a telemetry upload.

### 5.2 Delivery to the dashboard
- Preferred: **Supabase Realtime** subscription on `sensor_readings` inserts (browser uses the anon key and a read-only RLS select policy on that table only). This avoids Worker requests for live streaming.
- Fallback: poll `GET /api/esp32/readings?after=<lastId>&limit=200` every 2 seconds **only while the tab is visible** (`document.visibilityState`).
- The client keeps a rolling buffer (append only, trim by time window). A failed or empty poll **never clears the chart**.
- Status is derived from `last_seen_at`: Online < 5 s, Delayed 5–30 s, Offline > 30 s. Show "Last reading 3 s ago".
- Downsample for longer windows (10 min, 1 h) on the server (`date_trunc` buckets with max of `dynamic_g_peak`).

### 5.3 Request budget
Check the current Cloudflare Workers free plan request limit (it has been 100,000 requests per day). Estimate total daily requests (ESP32 telemetry + triggers + dashboard polling + cron) in the README and keep it comfortably under the limit. Batching and Realtime exist for this reason.

### 5.4 Retention
Keep sensor readings for 30 days by default (configurable). A cleanup step in the cron job deletes older rows. Tell me how much space that uses.

---

## 6. Scheduler, device status, and notifications (background jobs)

### 6.1 Running jobs every minute
Use **Cloudflare Cron Triggers** with `"triggers": { "crons": ["* * * * *"] }` in `wrangler.jsonc`. OpenNext's generated worker only handles `fetch`, so follow the current OpenNext documentation for a **custom worker entry** that re-exports the OpenNext `fetch` handler and adds a `scheduled()` handler. The `scheduled()` handler calls the internal job runner (or `fetch`es `/api/cron/tick` with header `x-cron-secret: <CRON_SECRET>`).

If that approach is not supported by the installed OpenNext version, use **Supabase `pg_cron` + `pg_net`** to call `/api/cron/tick` every minute instead, and explain the setup steps.

Locally, provide a "Run scheduler now" button in Developer tools and explain how to test the cron with `wrangler dev --test-scheduled`.

### 6.2 What `/api/cron/tick` does
1. **Schedules:** find enabled schedules due in the current minute, **or missed within the last 5 minutes**, in the configured time zone (cron runs in UTC). Insert the run with the unique `(schedule_id, scheduled_for)` constraint first so it can never double-fire, then feed using the normal feed pipeline (`source = SCHEDULE`). Record skips with their reason.
2. **Feeder status (every 5 minutes):** fetch device online status and the feeder's low-food status from Tuya (look up the correct endpoints and DP codes from the device specification, e.g. `GET /v1.0/iot-03/devices/{id}/specification` and status). Save to `feeder_settings`. **This must never send a feed command.**
3. **Sensor heartbeat:** raise or resolve the "ESP32 offline" alert.
4. **Low food:** raise or resolve alerts based on remaining % and the feeder's own sensor.
5. **Cleanup:** sensor retention (once per hour is enough).

### 6.3 Shared feed pipeline
Refactor so **every** source (manual, phone, ESP32, schedule) goes through one server function:
```
feed({ source, portions?, vibrationG?, testLabel?, scheduleId?, scheduledFor? })
  → quiet-hours check → reserve_feed() → Tuya (or simulation) → refund on failure
  → insert feed_events → evaluate alerts → return result
```
- **Portions per command:** read the `manual_feed` value range from the device specification. Send the requested portions as the command value in **one** command when within range; split into sequential commands only if above the maximum. Log `portions_dispensed`.
- When the v2 endpoint fails and v1 is used, store the v2 error in `fallback_reason`.
- **Disable all feeding schedules in the Tuya/Smart Life app**, and say so in the README, so the feeder does not also feed on its own schedule (that would make the hopper tracking wrong).

### 6.4 Notification delivery
`lib/notify.ts`: `raise(type, message, dedupeKey)` and `resolve(dedupeKey)`. Sends to enabled channels:
- **Telegram:** `fetch` to `https://api.telegram.org/bot<TOKEN>/sendMessage`. Works from Workers with no dependencies. Primary channel.
- **Email:** Resend REST API via `fetch`, only if configured.
- **Browser:** the dashboard polls active alerts and shows a `Notification` if permission was granted.

Message style: plain and short, e.g. `Hopper low: 7 portions left (18%). Refill soon.`

---

## 7. Wording

Use plain, professional language. Sentence case for all labels. Replace current wording as follows:

| Current | New |
|---|---|
| Smart Fish Feeder Actuation & Latency Study | Fish Feeder |
| Remaining Hopper Feed | Hopper |
| LIVE HARDWARE | Live |
| Tuya Sensor (DP 6 status): NO (Sufficient) | Feeder low-food sensor: OK |
| Manual Actuation & Experiment Tagging | Feed now |
| Experiment run_label | Test label (optional) |
| Feed Now (1 Portion) | Feed |
| Refill Hopper (100g) | Refill |
| Calibration & Cooldown | Calibration |
| ESP32-S3 + ADXL345 Live Sensor Stream | Vibration sensor (ESP32) |
| Dynamic Vib (g) | Vibration |
| Auto-Trigger ON | Feeding enabled |
| Chart 1 — Trigger-to-cloud-acknowledgement latency (ms) | Command latency |
| Chart 2 — Feeder quantity remaining | Hopper level |
| Client RTT (ms) | Total (ms) |
| Network (ms) / Tuya (ms) / Server (ms) | Network / Feeder API / Server |
| Token refresh | Token renewed |
| Endpoint v2_shadow / v1_commands | Method: Standard / Fallback |
| Phone Motion Trigger (/sensor) | Phone sensor |
| Developer Tools (UI Demo Seed / Clear — Never touches LIVE rows) | Developer tools |
| Show demo data | Include demo data |
| Export LIVE CSV | Download |

Remove all explanatory developer text from the UI (API paths, function names, column names). Metric definitions live only in the "How latency is measured" note on the Performance page.

---

## 8. API routes (final list)

All writes require `x-feed-token`. Cron route requires `x-cron-secret`. Validate all input (use `zod` only if it bundles fine on Workers, otherwise hand-written validation).

```
POST   /api/feed                     { source, portions?, vibrationG?, testLabel? }
POST   /api/feed/rtt                 { feedEventId, clientRttMs }
GET    /api/overview
GET    /api/feed-events              ?from&to&source&label&includeDemo&limit&cursor
GET    /api/trigger-sources          PUT /api/trigger-sources/:source
GET    /api/schedules                POST /api/schedules   PUT/DELETE /api/schedules/:id
GET    /api/hopper/history           POST /api/hopper/refill   POST /api/hopper/calibration
POST   /api/esp32/telemetry          GET /api/esp32/readings ?after&from&to&bucket
GET    /api/performance              ?from&to&source&label&includeDemo
GET    /api/notifications            POST /api/notifications/:id/read
PUT    /api/settings                 POST /api/settings/test-connection
POST   /api/notify/test              { channel }
GET    /api/export/:dataset          ?from&to&format=csv|json&liveOnly
POST   /api/cron/tick                (x-cron-secret)
POST   /api/dev/seed | /api/dev/clear-demo | /api/dev/reset   (typed confirmation)
```

---

## 9. ESP32 contract (give this section to my partner)

```
Telemetry, every 2 s:
POST /api/esp32/telemetry   headers: x-feed-token
{ "deviceId":"esp32-s3-1","rssi":-55,"firmware":"1.2.0",
  "samples":[{"offsetMs":0,"ax":..,"ay":..,"az":..,"gMean":..,"gPeak":..}, ...] }

Feed trigger, when vibration ≥ threshold:
POST /api/feed   { "source":"ESP32_SENSOR","vibrationG":0.45 }
→ { feedEventId, result, serverTotalMs, ... }
POST /api/feed/rtt { "feedEventId":123, "clientRttMs": millis_after - millis_before }

Config, read every 60 s:
GET /api/trigger-sources → use enabled + threshold_g for ESP32_SENSOR
```
Notes for the partner:
- Current data shows ESP32 network time averaging around 1,600 ms versus about 250 ms from the browser. The likely cause is a new TLS handshake on every request. **Reuse the HTTPS connection** (keep-alive, e.g. `HTTPClient::setReuse(true)` with a persistent `WiFiClientSecure`) and re-test.
- Respect `429` (cooldown) and `409` (source disabled) responses.
- Read the threshold from the server so it can be changed from the dashboard.

Update `docs/esp32-example.ino` accordingly.

---

## 10. Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=      # only for Realtime read of sensor_readings
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
Update `.dev.vars.example` and `.env.example`. Give me the `wrangler secret put` commands for each secret.

---

## 11. Code organisation

```
app/(dashboard)/layout.tsx           sidebar + top bar
app/(dashboard)/page.tsx             overview
app/(dashboard)/feeding/page.tsx
app/(dashboard)/schedule/page.tsx
app/(dashboard)/hopper/page.tsx
app/(dashboard)/sensors/page.tsx
app/(dashboard)/performance/page.tsx
app/(dashboard)/data/page.tsx
app/(dashboard)/notifications/page.tsx
app/(dashboard)/settings/page.tsx
app/sensor/page.tsx                  phone sensor (standalone)
app/api/...                          routes from §8
components/ui/                       Button, Card, Input, Switch, Select, Dialog, Table, Stat, StatusDot, EmptyState, Skeleton
components/charts/                   LineChart, StepChart, StackedBar, LiveChart (shared monochrome theme)
lib/tuya.ts  lib/feed.ts  lib/notify.ts  lib/schedule.ts  lib/time.ts  lib/csv.ts  lib/supabase-server.ts  lib/auth.ts  lib/stats.ts
supabase/01_archive.sql  supabase/02_schema.sql
worker.ts (custom entry for cron)    wrangler.jsonc
docs/esp32-example.ino  docs/EXPERIMENT_PROTOCOL.md  README.md
```
Build small reusable UI components first and use them everywhere so the design stays consistent. No inline one-off styling.

---

## 12. Build order (verify each step before moving on)

1. Branch + commit. Archive SQL, new schema SQL; I run them in Supabase.
2. Design system: tokens, UI components, layout with sidebar, empty pages with titles.
3. Shared `feed()` pipeline with portions, sources, limits, quiet hours; Feeding page. **Verify the real feeder dispenses the chosen number of portions.**
4. Hopper page with portions, refill, calibration helper.
5. Sensor ingestion batching + Realtime/polling; Sensors page. **Verify the live chart stays continuous for 5 minutes.**
6. Cron entry + scheduler + Schedule page. **Verify a schedule set 2 minutes ahead fires exactly once.**
7. Notifications (in-app, Telegram, browser).
8. Performance page, Data page exports.
9. Overview page.
10. Phone sensor page redesign.
11. Settings + developer tools. Deploy and run the acceptance checklist.

---

## 13. Acceptance checklist

- [ ] No gradients, glows, emoji, neon, or decorative icons. Only black, white, greys, and red for critical states.
- [ ] Light and dark themes both look correct; layout works at 375px wide.
- [ ] Hopper shows whole portions; grams appear only as an estimate.
- [ ] Portions per trigger works for each source and the feeder dispenses that amount.
- [ ] Each trigger source can be enabled or disabled; disabled sources return a clear message and do not feed.
- [ ] Scheduled feeds fire on time (Malaysia time), exactly once, and appear in run history.
- [ ] Daily limit, quiet hours, cooldown, and empty-hopper skip work and are logged.
- [ ] Live sensor chart stays continuous for 5+ minutes with no flashing; status reads Online.
- [ ] Low-food alert appears once when crossing the threshold, is delivered to Telegram (if configured), and resolves after refill.
- [ ] Every dataset downloads as CSV for a chosen date range, including sensor readings.
- [ ] Performance page prints cleanly and only uses LIVE data by default.
- [ ] Old data is preserved in `legacy_` tables.
- [ ] No secrets in the client bundle.
- [ ] Daily request estimate is documented and under the Workers plan limit.

---

## 14. Report support (after the refactor)

When I ask for help with report chapters, use only real exported data and my calibration measurements. Use placeholders like `[MEAN_MANUAL_MS]` where data is missing. New features to describe in Chapter 4: portion-based inventory with versioned calibration, multi-source trigger control, server-side scheduler with exactly-once execution, safety interlocks (cooldown, daily limit, quiet hours, empty-hopper skip), alerting, batched sensor telemetry, and the export pipeline. Keep the limitations from the previous version (cloud dependency, acknowledgement ≠ physical dispensing, open-loop inventory, phone page simulates wave input).
