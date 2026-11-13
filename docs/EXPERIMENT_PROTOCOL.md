# Experiment Protocol (FYP II)

## 1. Portion Weight Calibration
1. Place a clean weighing boat on a 0.01 g digital scale and tare to `0.00 g`.
2. Open the dashboard → **Feeding** and dispense **1 portion** (`source = MANUAL`).
3. Record the mass (in grams) of the dispensed pellets.
4. Repeat for $N = 10$ independent single-portion actuations.
5. Open **Hopper → Portion weight helper**, paste the 10 weights, and click **Use this value** → **Apply calibration**. This stores the sample mean $\bar{x}$, standard deviation $s$, sample count $N$, and creates a new `calibration_id` version.

## 2. Command Latency Comparison by Source
1. Ensure the feeder is online (**Settings → Test connection**) and **Live** mode is enabled.
2. On **Feeding**, set `Portions per trigger = 1` and `Cooldown = 5 s`.
3. Run $N \ge 20$ trials for each client-triggered source:
   - **Manual**: trigger from **Feeding** with test label `exp-manual`.
   - **Phone sensor**: open `/sensor` on a smartphone over HTTPS, set test label `exp-phone`, and trigger above the threshold.
   - **Vibration sensor (ESP32)**: flash `docs/esp32-example.ino` (with TLS keep-alive enabled) and trigger above the threshold.
4. Run $N \ge 5$ scheduled runs on **Schedule** to record server-side scheduled execution latency (`server_total_ms`).
5. Open **Performance** to view and print the latency charts and summary tables, or open **Data** to export `feed-events` and `latency-summary` as CSV.

## 3. Continuous Sensor Streaming & Safety Interlocks
1. Leave the **Sensors** page open for at least 5 minutes while the ESP32 posts 2-second batches (`POST /api/esp32/telemetry`) and verify the status remains `● Online` with no chart flashing.
2. Verify safety interlocks on **Feeding**:
   - Disable a trigger source and confirm triggers from that source return `409` (`SKIPPED_DISABLED`).
   - Trigger twice within the cooldown window and confirm `429` (`SKIPPED_COOLDOWN`).
   - Set quiet hours covering the current time and confirm sensor triggers are logged as `SKIPPED_QUIET_HOURS` while manual triggers still succeed.

