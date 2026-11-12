# MASTER PROMPT — Smart Fish Feeder Actuation & Latency Study (FYP II)

You are helping me build, deploy, and document my Final Year Project tonight. Read this whole file before writing any code. Follow the rules exactly. If something here conflicts with current official documentation (Next.js, OpenNext for Cloudflare, Wrangler, Supabase, Tuya), follow the current docs and tell me what you changed.

---

## 1. Context

- **Student:** Mohamad Adam Bin Mohd Faizal (22002016), Bachelor of Information Technology (Hons), Universiti Teknologi PETRONAS.
- **FYP I title:** "Multi-Modal Smart IoT Gateway For High-Reliability". FYP I proposed a dual Raspberry Pi cluster with Keepalived/VRRP failover, chunked offline buffering, and a solar-powered IP67 enclosure for tilapia aquaculture.
- **FYP II scope change (approved by my supervisor):** The project now focuses on the actuation layer from FYP I Objective 4 ("a modular software stack with integration of an automatic fish feeding system"). It is a web application that triggers a real MeeGoo Smart Fish Feeder through the Tuya Cloud API, either manually or from a vibration (wave) trigger, and measures **actuation latency** and **feed inventory depletion**.
- **Domain:** Precision tilapia aquaculture in Malaysia; reducing overfeeding, biological waste, and improving Feed Conversion Ratio (FCR).

### Division of work

| Me (this codebase) | My partner (NOT in this codebase) |
|---|---|
| Next.js web app: dashboard, API, database | ESP32 + ADXL345 wave detection firmware |
| Tuya Cloud integration to drive the feeder | Wave detection accuracy / F1 score evaluation |
| Phone motion trigger page (`/sensor`) | Calling my `/api/feed` webhook from the ESP32 |
| Latency chart + feed-remaining chart | |

**Do NOT build any accuracy / F1 / `accuracy_trials` feature.** That is my partner's evaluation.

---

## 2. Non-negotiable rules

### 2.1 Data integrity (academic requirement)
1. Every number shown in a chart or summary table must come from a real measurement. **Never estimate, invent, clamp, or pad latency values.**
2. Every `feed_logs` row has `data_origin`: `'LIVE'`, `'SIMULATED'`, or `'SEEDED'`.
3. Charts, the summary table, and CSV export use **`LIVE` rows only** by default. A "Show demo data" toggle may display other rows, but then the dashboard must show a clear "DEMO / SIMULATED DATA — NOT FOR REPORT" banner.
4. If a latency field cannot be measured (e.g., the ESP32 does not report its round-trip time), store `NULL`. Do not substitute a guess.

### 2.2 Cloudflare Workers compatibility
1. Next.js App Router + TypeScript, deployed with `@opennextjs/cloudflare` and `wrangler`.
2. `wrangler.jsonc` must include `"compatibility_flags": ["nodejs_compat"]` and a `compatibility_date` of `2024-09-23` or later.
3. **Do NOT install `@tuya/tuya-connector-nodejs` or `tinytuya`** or any library depending on axios/Node `http`. Write a zero-dependency Tuya client using `fetch()` and Web Crypto (`crypto.subtle`).
4. Any component using recharts, browser APIs, or state must be a client component (`"use client"`).
5. Note: in Workers, `Date.now()` / `performance.now()` only advance across I/O. Timing around `fetch()` and database calls is valid; do not try to time pure CPU work.

### 2.3 Security
1. Secrets are **server-only**. Never prefix them with `NEXT_PUBLIC_`. Locally they go in `.dev.vars` (and `.env.local` for `next dev`); in production use `wrangler secret put`.
2. Add `.dev.vars`, `.env*`, and anything containing keys to `.gitignore`.
3. **Never** hardcode or commit the Tuya local key, client secret, or Supabase service role key.
4. `/api/feed` and all write endpoints require header `x-feed-token: <FEED_API_TOKEN>`. Return `401` otherwise.
5. Dashboard and `/sensor` pages ask for this token once (PIN-style input), keep it in `localStorage`, and send it in the header.
6. All database access happens **server-side** using the Supabase service role key. Enable Row Level Security on every table with **no** anon policies. The browser never talks to Supabase directly; it reads data through `GET /api/stats`.

### 2.4 Feeder safety
1. Server-side cooldown: reject feeds within `cooldown_seconds` (default 5) of the last successful feed with HTTP `429`. This applies to every source (button, phone, ESP32).
2. Food decrement must be **atomic** (Postgres function with row lock). No read-then-write in TypeScript.
3. If the Tuya call fails, refund the reserved portion.
4. **No silent simulation.** Simulation only happens when `feeder_state.simulation_mode = true` (toggle on dashboard, clearly labelled). If Tuya credentials are missing or Tuya fails while simulation is OFF, return a clear error (`503` / `502`) and show it in the UI. Never report success unless Tuya returned `success: true`.

---

## 3. Environment variables

```
# Public (safe to expose)
NEXT_PUBLIC_SUPABASE_URL=

# Server-only secrets
SUPABASE_SERVICE_ROLE_KEY=
TUYA_CLIENT_ID=
TUYA_CLIENT_SECRET=
TUYA_DEVICE_ID=a33d5216f7875b6d3er7kk
TUYA_BASE_URL=https://openapi-sg.iotbing.com
FEED_API_TOKEN=            # long random string, shared with ESP32 + my phone
```

Provide a `.dev.vars.example` and `.env.example` with these keys and empty values.

---

## 4. Verified device facts

- Data center: Singapore, `https://openapi-sg.iotbing.com`
- Device ID: `a33d5216f7875b6d3er7kk`
- Product ID: `p8t4ieonxa7laylq`, category `cwwsq` (pet/fish feeder)
- Feeding has been verified working via Tuya platform "Send Property" with `manual_feed = 1`.
- No internal load cell: remaining food must be tracked by calibrated portion weight.

---

## 5. Database (Supabase) — one SQL migration file

Create `supabase/migration.sql` that I paste into the Supabase SQL Editor. It must be idempotent where reasonable (`create table if not exists`, `create or replace function`).

### 5.1 `feeder_state` (single row, `id = 1`)
| column | type | default |
|---|---|---|
| id | int primary key | 1, with `check (id = 1)` |
| remaining_grams | numeric | 60.0 |
| max_capacity_grams | numeric | 60.0 |
| grams_per_portion | numeric | 1.5 (placeholder until I calibrate) |
| cooldown_seconds | int | 5 |
| simulation_mode | boolean | false |
| last_feed_at | timestamptz | null |
| updated_at | timestamptz | now() |

Insert the initial row with `on conflict do nothing`.

### 5.2 `feed_logs`
| column | type | notes |
|---|---|---|
| id | bigint identity primary key | |
| created_at | timestamptz default now() | |
| source | text check in (`MANUAL_APP`, `PHONE_SENSOR`, `ESP32_SENSOR`) | |
| data_origin | text check in (`LIVE`, `SIMULATED`, `SEEDED`) | |
| run_label | text null | e.g. `"trial-wifi-1"` to group experiments |
| vibration_g | numeric null | null for manual |
| tuya_endpoint | text null | `v2_shadow` or `v1_commands` |
| token_refreshed | boolean | whether this request had to fetch a new Tuya token |
| tuya_api_ms | int null | round trip of Tuya command fetch only |
| server_total_ms | int null | request received → response ready (includes DB + Tuya) |
| client_rtt_ms | int null | measured by client, reported afterward (see §7) |
| network_ms | int null | `client_rtt_ms − server_total_ms`, computed when RTT arrives |
| tuya_success | boolean | |
| tuya_error | text null | |
| remaining_grams | numeric | after this feed |
| remaining_percent | numeric | `remaining_grams / max_capacity_grams * 100` |

Index on `(data_origin, created_at)`.

### 5.3 Postgres functions (called via `supabase.rpc`)
1. `reserve_portion()` — `select ... for update` on `feeder_state`. If `last_feed_at` is within `cooldown_seconds`, return a row indicating `cooldown = true` and do nothing else. Otherwise set `remaining_grams = greatest(0, remaining_grams - grams_per_portion)`, `last_feed_at = now()`, `updated_at = now()`, and return the new state with `cooldown = false`.
2. `refund_portion()` — adds one portion back (capped at `max_capacity_grams`), and resets `last_feed_at` to null so a retry is not blocked.
3. `refill_hopper()` — sets `remaining_grams = max_capacity_grams`.

Enable RLS on both tables, no policies (service role bypasses RLS).

---

## 6. `lib/tuya.ts` — zero-dependency Tuya client

Use Web Crypto only (`crypto.subtle.digest('SHA-256', …)`, `crypto.subtle.importKey` + `sign` with HMAC SHA-256). Output signatures as **uppercase hex**.

### 6.1 Signing (Tuya OpenAPI, HMAC-SHA256)
```
stringToSign = METHOD + "\n"
             + lowercaseHex(SHA256(body or ""))   // empty body hash = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
             + "\n"
             + ""                                  // no signed headers
             + "\n"
             + pathWithSortedQuery                 // e.g. /v1.0/token?grant_type=1

Token request:     sign = HMAC(secret, client_id + t + nonce + stringToSign).toUpperCase()
Business request:  sign = HMAC(secret, client_id + access_token + t + nonce + stringToSign).toUpperCase()
```
Headers: `client_id`, `sign`, `t` (ms timestamp string), `sign_method: HMAC-SHA256`, `nonce` (may be empty string, but must match what was signed), and `access_token` for business requests. `Content-Type: application/json` for POST.

### 6.2 Token
- `GET /v1.0/token?grant_type=1`.
- Cache `{ access_token, expiresAt }` in module scope; refresh when less than 60 s remain. Return whether a refresh happened so it can be logged as `token_refreshed`.
- Tuya returns HTTP 200 even on errors — always check `json.success`.
- If a business call fails with a token-invalid code (e.g. `1010`), refresh once and retry once.

### 6.3 Feed command
- Primary: `POST /v2.0/cloud/thing/{deviceId}/shadow/properties/issue` with body `{"properties": "{\"manual_feed\":1}"}` (note: `properties` is a JSON **string**).
- Fallback (only if primary returns `success: false` for a non-auth reason): `POST /v1.0/iot-03/devices/{deviceId}/commands` with body `{"commands":[{"code":"manual_feed","value":1}]}`.
- Measure `tuya_api_ms` around the command fetch only (not the token fetch).
- Export `feedOnce(): Promise<{ success, endpoint, tuyaApiMs, tokenRefreshed, error? }>`.
- Export `isTuyaConfigured()`.

---

## 7. Latency methodology (implement exactly)

Clocks on different devices are NOT synchronised, so never subtract a client timestamp from a server timestamp.

1. **Client** (dashboard button, phone page, ESP32) records `t0 = performance.now()` (ESP32: `millis()`) at the moment of the trigger, then immediately sends `POST /api/feed`.
2. **Server** records `start = Date.now()` on receipt, runs reserve → Tuya → insert log, records `server_total_ms = Date.now() - start` just before responding, updates the row, and returns `{ logId, success, serverTotalMs, tuyaApiMs, remainingGrams, remainingPercent }`.
3. **Client** records `t1` when the response arrives: `client_rtt_ms = t1 - t0`.
4. **Client** sends `POST /api/feed/rtt` with `{ logId, clientRttMs }`. Server stores it and computes `network_ms = client_rtt_ms - server_total_ms`.
5. **End-to-end latency reported in charts = `client_rtt_ms`** (trigger → Tuya cloud acknowledgement as seen by the triggering device). Label it exactly this way in the UI: *"Trigger-to-cloud-acknowledgement latency"*. Do not call it "food drop latency" — Tuya's ack does not prove the motor turned.
6. Rows with `client_rtt_ms IS NULL` are excluded from the latency chart and summary table (but still count for food tracking).

---

## 8. API routes

All POST routes require `x-feed-token`. Validate input; return JSON errors.

### `POST /api/feed`
Body:
```json
{ "source": "MANUAL_APP" | "PHONE_SENSOR" | "ESP32_SENSOR", "vibrationG": 1.42, "runLabel": "optional" }
```
Flow:
1. Validate. `vibrationG` required for sensor sources.
2. `reserve_portion()`. If cooldown → `429 { error: "cooldown", retryAfterMs }`. Do not log.
3. If `simulation_mode` → skip Tuya, `data_origin='SIMULATED'`, `tuya_api_ms = null`.
   Else if Tuya not configured → `refund_portion()`, return `503`.
   Else `feedOnce()`. On failure → `refund_portion()`, still insert a log row with `tuya_success=false` and the error, return `502`.
4. Insert `feed_logs` row, compute `server_total_ms`, update row, respond.

### `POST /api/feed/rtt`
Body `{ logId, clientRttMs }`. Accept only `0 < clientRttMs < 60000`. Only update rows where `client_rtt_ms` is null.

### `GET /api/stats`
Returns `feeder_state`, recent `feed_logs` (default `data_origin='LIVE'`, `?includeDemo=1` for all), and per-source summary: `n`, `min`, `avg`, `median`, `p95`, `max` of `client_rtt_ms`, plus averages of `tuya_api_ms`, `network_ms`, and the Tuya success rate. Compute in TypeScript or SQL — either is fine.

### `POST /api/refill` — calls `refill_hopper()`.
### `POST /api/settings` — updates `grams_per_portion`, `max_capacity_grams`, `cooldown_seconds`, `simulation_mode`.
### `POST /api/demo/seed` and `POST /api/demo/clear` — insert/delete rows with `data_origin='SEEDED'` only (for UI testing). Seed must never touch `LIVE` rows or `feeder_state`.
### `GET /api/export.csv` — LIVE `feed_logs` as CSV for my report appendix.

---

## 9. Pages

Tailwind CSS, lucide-react icons, recharts. Clean, mobile-friendly, light/dark.

### 9.1 Dashboard `/`
- Token prompt if no token in `localStorage`.
- Status cards: remaining food (g and %), last feed time, Tuya mode (**LIVE** or **SIMULATION** badge, very visible), total live feeds.
- Buttons: **Feed Now** (measures RTT per §7), **Refill Hopper**, **Export CSV**.
- Settings panel: grams per portion, capacity, cooldown, simulation toggle (with confirmation).
- `run_label` text input (sent with manual feeds) so I can tag experiment batches.
- **Chart 1 — Trigger-to-cloud-acknowledgement latency (ms):** line chart over feed sequence, one series each for `MANUAL_APP`, `PHONE_SENSOR`, `ESP32_SENSOR`. Optional stacked bar view of `network_ms` vs `tuya_api_ms` vs remaining server time.
- **Latency summary table** below Chart 1: per source n / min / avg / median / p95 / max, plus Tuya success rate and how many requests had `token_refreshed = true`.
- **Chart 2 — Feeder quantity remaining:** step-after area chart of `remaining_percent` (secondary label in grams) over feed sequence; red dashed `ReferenceLine` at 20% labelled "Low food". Show a warning banner when below 20%.
- Feed log table (latest 50) with all latency columns and status.
- "Show demo data" toggle → when on, include SIMULATED/SEEDED rows and show the "NOT FOR REPORT" banner. Seed/Clear demo buttons live in a collapsed "Developer" section.
- Auto-refresh stats every 3 s (or after each action).

### 9.2 Phone motion trigger `/sensor`
Title it **"Phone Motion Trigger (simulated wave input)"** — it simulates the ESP32 trigger; it is not claimed to be a validated wave detector.
- Token prompt (same as dashboard).
- **Start Sensor** button. Inside the click handler (required for iOS): if `typeof DeviceMotionEvent.requestPermission === 'function'`, await it; on `granted`, add the `devicemotion` listener. On Android, just add the listener. Show clear messages for denied permission, non-HTTPS, or unsupported devices.
- Request a Screen **Wake Lock** while running (re-acquire on `visibilitychange`); release on stop.
- Dynamic acceleration (gravity removed):
  - Prefer `event.acceleration` (x, y, z in m/s²) when non-null.
  - Otherwise use `accelerationIncludingGravity` with a low-pass gravity estimate (`gravity = 0.9*gravity + 0.1*raw`, `linear = raw - gravity`).
  - `dynamicG = sqrt(x²+y²+z²) / 9.81`.
- Show live dynamicG value and a small rolling chart (last ~10 s) with the threshold line.
- Threshold slider: range 0.05–2.0 g, default 0.30 g. Also show raw total G for reference.
- When `dynamicG >= threshold` and the local 5-second cooldown has passed, send `POST /api/feed` with `source: 'PHONE_SENSOR'`, `vibrationG`, then the RTT follow-up (§7). Server cooldown still applies; display 429 responses as "cooldown".
- Show a list of the last triggers with their RTT and result.

---

## 10. ESP32 webhook contract (give this section to my partner)

```
POST https://<my-worker>.workers.dev/api/feed
Headers: Content-Type: application/json
         x-feed-token: <FEED_API_TOKEN>
Body:    {"source":"ESP32_SENSOR","vibrationG":1.85}

Response 200: {"logId":123,"success":true,"serverTotalMs":...,"tuyaApiMs":...,...}
Then:
POST /api/feed/rtt  {"logId":123,"clientRttMs":<millis() after response − millis() at trigger>}
```
- HTTPS is required; the ESP32 can use `WiFiClientSecure` (`setInsecure()` acceptable for the prototype — state this as a limitation).
- If the partner skips the RTT follow-up, those rows will have null latency and be excluded from Chart 1. Nothing is estimated.
- The ESP32 should also respect the 429 cooldown response.

Include a minimal Arduino example in `docs/esp32-example.ino` showing both calls.

---

## 11. Project structure

```
app/
  page.tsx                  # dashboard (client components inside)
  sensor/page.tsx
  api/feed/route.ts
  api/feed/rtt/route.ts
  api/stats/route.ts
  api/refill/route.ts
  api/settings/route.ts
  api/demo/seed/route.ts
  api/demo/clear/route.ts
  api/export.csv/route.ts
components/                 # charts, tables, token gate, etc.
lib/
  tuya.ts
  supabase.ts               # server-only client (import 'server-only')
  auth.ts                   # x-feed-token check
  stats.ts
supabase/migration.sql
docs/esp32-example.ino
docs/EXPERIMENT_PROTOCOL.md
wrangler.jsonc
open-next.config.ts
.dev.vars.example
.env.example
README.md
```

---

## 12. Commands to give me (verify against current docs)

1. Scaffold (preferred): `npm create cloudflare@latest -- fish-feeder --framework=next`, or add `@opennextjs/cloudflare` + `wrangler` to a fresh `create-next-app` project.
2. Install: `recharts lucide-react @supabase/supabase-js server-only`.
3. `package.json` scripts: `dev` (next dev), `preview` (opennextjs-cloudflare build && opennextjs-cloudflare preview), `deploy` (opennextjs-cloudflare build && opennextjs-cloudflare deploy).
4. Local run: `npm run dev`, then `npm run preview` to test in the Workers runtime.
5. Secrets: `npx wrangler secret put <NAME>` for each server-only variable.
6. Deploy: `npm run deploy`; print the `*.workers.dev` URL.
7. Smoke tests with `curl` for `/api/feed` (with and without token), `/api/stats`, and cooldown (two calls within 5 s → second returns 429).

---

## 13. `docs/EXPERIMENT_PROTOCOL.md` (write this file)

A short procedure I follow tonight to collect **real** data:

1. **Calibration:** Fill hopper, weigh it (or weigh food added). Trigger 20 single portions, catching each on a tared kitchen scale. Record each weight; compute mean and standard deviation. Set `grams_per_portion` to the mean and `max_capacity_grams` to the measured full amount.
2. **Latency — manual:** 30 Feed Now presses, `run_label = manual-wifi`, waiting past the cooldown each time.
3. **Latency — phone sensor:** 30 shake triggers, `run_label = phone-wifi`.
4. **Latency — ESP32:** 30 triggers if partner is ready, `run_label = esp32-wifi`.
5. *(Optional, strong)* Repeat manual trials on phone 4G hotspot (`run_label = manual-4g`) to compare networks.
6. *(Optional, strong)* Film 10 trials in slow motion with the phone screen and feeder in frame; count frames from tap to food drop to estimate **physical actuation latency** beyond the cloud acknowledgement.
7. **Depletion:** Continue triggering until the tracked level crosses 20%; weigh the actual remaining food and compare against the tracked value (tracking error %).
8. Disable all feeding schedules in the Tuya/Smart Life app during experiments so untracked feeds don't occur.
9. Export CSV after each run.

---

## 14. Build order for tonight (priority)

1. SQL migration → run in Supabase.
2. `lib/tuya.ts` + a temporary test route; confirm the real feeder drops food from `npm run dev`.
3. `/api/feed` + `/api/feed/rtt` + `/api/stats` with cooldown, atomic reserve, refund.
4. Dashboard: Feed Now, status, Chart 2, Chart 1, summary table.
5. Deploy to Workers; confirm feeding works from the live URL.
6. `/sensor` page; test on my second phone over the `workers.dev` HTTPS URL.
7. Export CSV, settings, demo seed/clear, ESP32 doc.

After each step, tell me exactly how to verify it before moving on.

---

## 15. Acceptance checklist

- [ ] Pressing Feed Now on the deployed site physically drops food.
- [ ] Shaking the second phone on `/sensor` (iOS and Android) physically drops food.
- [ ] Second trigger within 5 s returns 429 and does not move the feeder.
- [ ] Requests without `x-feed-token` return 401.
- [ ] Wrong/missing Tuya credentials with simulation OFF → visible error, no fake success.
- [ ] Simulation ON → badge visible, rows marked SIMULATED, excluded from charts by default.
- [ ] Charts and summary table use only LIVE rows with measured `client_rtt_ms`.
- [ ] No secret appears in client bundles (search `.open-next` output for the secret values).
- [ ] CSV export works.

---

## 16. Report writing (after the app works)

Help me draft Chapter 3 (Methodology), Chapter 4 (System Design & Implementation), Chapter 5 (Results, Discussion & Conclusion). Rules:

1. Use **only** numbers from my exported LIVE CSV and calibration measurements. If I haven't given you data yet, write placeholders like `[MEAN_MANUAL_RTT_MS]` — never invent values.
2. Explain the scope change as a supervisor-approved refocus on FYP I Objective 4 (actuation and modular software), building on the FYP I literature on smart feeders and overfeeding.
3. Describe architecture honestly: trigger devices → Next.js API on Cloudflare Workers → Supabase → Tuya Cloud (Singapore) → MeeGoo feeder over Wi-Fi.
4. Define the latency metric precisely (trigger-to-cloud-acknowledgement, client-measured round trip, decomposed into network, Tuya API, and server time), and explain why client/server clock subtraction was avoided.
5. Discuss: manual vs sensor latency differences; Tuya API share of total latency; token refresh effect; Wi-Fi vs 4G if measured; physical actuation delay if filmed; portion weight variance and tracking error from calibration.
6. **Limitations to state explicitly:** dependency on internet and Tuya Cloud (single point of failure — contrasts with FYP I's offline-resilience goal); acknowledgement ≠ physical dispensing; open-loop food estimation without a load cell; phone page simulates wave input rather than validated wave sensing; ESP32 TLS verification disabled in the prototype; small sample size.
7. **Future work:** local LAN control as a cloud-free fallback, the FYP I dual-node failover and offline buffering, a load cell for closed-loop food measurement, and water-quality interlocks (e.g., suspend feeding on low dissolved oxygen).
8. Wave detection accuracy/F1 is my partner's result — reference it as their contribution, do not generate it.
