# Experiment Protocol — Smart Fish Feeder Actuation & Latency Study (FYP II)

Follow this step-by-step protocol to collect **real, verifiable (`LIVE`) data** for Chapters 3, 4, and 5 of the FYP II final report.

> [!IMPORTANT]
> - Before starting any experiment, open the **Tuya Smart / Smart Life** mobile app and **disable all automated feeding schedules** on the MeeGoo feeder (`a33d5216f7875b6d3er7kk`) so untracked feeds do not occur.
> - Confirm the dashboard badge displays **LIVE HARDWARE** (`simulation_mode = false`) and that **Show demo data** is unchecked.

---

## Step 1: Portion Weight & Hopper Capacity Calibration

Because the MeeGoo Smart Fish Feeder has no internal load cell, remaining feed inventory is tracked via open-loop portion subtraction calibrated against a digital kitchen scale (0.1 g resolution).

1. **Full Hopper Capacity (`max_capacity_grams`):**
   - Tare a container on the digital scale and weigh the full batch of tilapia pellets used to fill the hopper (or weigh the feeder before and after filling).
   - Record the measured full hopper mass $M_{\text{full}}$ in grams.
2. **Single-Portion Calibration ($n = 20$):**
   - Place a tared catch cup directly beneath the feeder chute.
   - Trigger **20 individual single-portion feeds** (`manual_feed = 1`), waiting at least 6 seconds between feeds.
   - After each feed $i \in \{1, \dots, 20\}$, record the dispensed pellet weight $w_i$ (in grams) in your calibration sheet.
   - Compute:
     - Sample mean: $\bar{w} = \frac{1}{20}\sum_{i=1}^{20} w_i$
     - Sample standard deviation: $s_w = \sqrt{\frac{1}{19}\sum_{i=1}^{20}(w_i - \bar{w})^2}$
     - Coefficient of variation: $\text{CV} = \frac{s_w}{\bar{w}} \times 100\%$
3. **Apply Calibration to Dashboard:**
   - Return the dispensed pellets to the hopper so it is at $M_{\text{full}}$.
   - In the dashboard **Calibration & Cooldown** panel, set:
     - `Portion (g)` (`grams_per_portion`) = $\bar{w}$
     - `Max Cap (g)` (`max_capacity_grams`) = $M_{\text{full}}$
     - `Cooldown (s)` (`cooldown_seconds`) = `5`
   - Click **Save**, then click **Refill Hopper** so `remaining_grams` equals $M_{\text{full}}$.

---

## Step 2: Latency Trial 1 — Manual Dashboard Actuation (`MANUAL_APP` over Wi-Fi)

1. Connect the laptop/phone running the dashboard `/` to the primary Wi-Fi network.
2. Set the `run_label` input to:
   ```
   manual-wifi
   ```
3. Press **Feed Now (1 Portion)** **30 times**, waiting at least 6 seconds (past the 5-second cooldown) between each press.
4. Verify in the **Recent Feed Logs** table that each row has:
   - `Origin = LIVE`
   - `Source = MANUAL_APP`
   - `Run Label = manual-wifi`
   - Non-null `Tuya (ms)`, `Server (ms)`, `Client RTT (ms)`, and `Network (ms)`.

---

## Step 3: Latency Trial 2 — Phone Motion Trigger (`PHONE_SENSOR` over Wi-Fi)

1. On a smartphone connected to Wi-Fi, open the deployed HTTPS URL:
   ```
   https://<your-worker>.workers.dev/sensor
   ```
2. Enter your `FEED_API_TOKEN` if prompted.
3. Set `run_label` to:
   ```
   phone-wifi
   ```
4. Keep the threshold at `0.30 g` (or adjust as needed) and tap **Start Sensor** (grant iOS motion permission if prompted).
5. Perform **30 shake triggers**, waiting at least 6 seconds between each trigger so the 5-second cooldown clears.

---

## Step 4: Latency Trial 3 — ESP32 Accelerometer Webhook (`ESP32_SENSOR`)

1. When your partner's ESP32 + ADXL345 unit is ready, configure it with `docs/esp32-example.ino` pointing to `https://<your-worker>.workers.dev/api/feed` and `/api/feed/rtt` with `runLabel = "esp32-wifi"`.
2. Trigger **30 wave/vibration events** (`n = 30`), waiting at least 6 seconds between triggers.

---

## Step 5: *(Optional, High-Impact)* Cellular 4G Network Comparison

1. Switch the triggering device from Wi-Fi to a **4G mobile hotspot / cellular connection**.
2. Set `run_label` on the dashboard to:
   ```
   manual-4g
   ```
3. Perform **15–30 Feed Now presses** waiting past the cooldown each time.
4. This enables a direct Wi-Fi vs. 4G comparison of `network_ms` vs. `tuya_api_ms` in Chapter 5.

---

## Step 6: *(Optional, High-Impact)* Slow-Motion Physical Actuation Delay ($n = 10$)

Because `client_rtt_ms` measures **trigger-to-cloud-acknowledgement latency** rather than physical motor completion:

1. Position a smartphone camera recording at **120 fps or 240 fps slow motion** so both the triggering screen (**Feed Now** button) and the MeeGoo feeder chute are visible in the same frame.
2. Record **10 feeds**.
3. For each trial, count the video frames from:
   - $f_0$: finger tap on **Feed Now**
   - $f_{\text{ack}}$: UI toast showing cloud acknowledgement
   - $f_{\text{drop}}$: first pellet visibly dropping from the impeller chute
4. Convert frame difference to milliseconds:
   $$\Delta t_{\text{physical}} = \frac{f_{\text{drop}} - f_0}{\text{fps}} \times 1000\text{ ms}$$

---

## Step 7: Open-Loop Inventory Depletion & Tracking Error Verification

1. Continue triggering live feeds until the dashboard's tracked level crosses **below the 20% "Low food" threshold** (and the red warning banner appears).
2. Note the dashboard's tracked remaining weight $R_{\text{tracked}}$ (in grams).
3. Empty the remaining pellets from the physical hopper onto the tared digital scale and measure the true remaining weight $R_{\text{actual}}$ (in grams).
4. Compute absolute error and percentage tracking error:
   $$\text{Absolute Error (g)} = |R_{\text{tracked}} - R_{\text{actual}}|$$
   $$\text{Tracking Error (\% of capacity)} = \frac{|R_{\text{tracked}} - R_{\text{actual}}|}{M_{\text{full}}} \times 100\%$$

---

## Step 8: Export Raw Data for Report Appendix

1. Click **Export LIVE CSV** (`/api/export.csv`) on the dashboard after completing your runs.
2. Save `feed_logs_live.csv` — all numbers in Chapters 4 & 5 must be derived strictly from this CSV and your calibration sheet.

