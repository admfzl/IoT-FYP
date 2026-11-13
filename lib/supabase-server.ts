import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type TriggerSourceKey =
  | "MANUAL"
  | "SCHEDULE"
  | "ESP32_SENSOR"
  | "PHONE_SENSOR";

export type DataOrigin = "LIVE" | "SIMULATED" | "SEEDED";

export type FeedResult =
  | "PENDING"
  | "FED"
  | "FAILED"
  | "SKIPPED_COOLDOWN"
  | "SKIPPED_DISABLED"
  | "SKIPPED_EMPTY"
  | "SKIPPED_DAILY_LIMIT"
  | "SKIPPED_QUIET_HOURS";

export type TuyaEndpoint = "v2_shadow" | "v1_commands";

export interface FeederSettingsRow {
  id: number;
  capacity_portions: number;
  remaining_portions: number;
  grams_per_portion: number;
  grams_per_portion_sd: number | null;
  active_calibration_id: number | null;
  low_food_threshold_percent: number;
  daily_max_portions: number;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  skip_when_empty: boolean;
  simulation_mode: boolean;
  timezone: string;
  tuya_low_food: boolean | null;
  tuya_online: boolean | null;
  tuya_status_checked_at: string | null;
  tuya_manual_feed_min: number | null;
  tuya_manual_feed_max: number | null;
  daily_used_date: string | null;
  daily_used_portions: number;
  esp32_offline_minutes: number;
  sensor_retention_days: number;
  notify_browser: boolean;
  notify_telegram: boolean;
  notify_email: boolean;
  last_cleanup_at: string | null;
  last_tick_at: string | null;
  updated_at: string;
}

export interface TriggerSourceRow {
  source: TriggerSourceKey;
  enabled: boolean;
  portions_per_trigger: number;
  cooldown_seconds: number;
  threshold_g: number | null;
  last_triggered_at: string | null;
  last_skip_logged_at: string | null;
  updated_at: string;
}

export interface CalibrationRow {
  id: number;
  created_at: string;
  grams_per_portion: number;
  sd: number | null;
  sample_count: number | null;
  capacity_portions: number;
  notes: string | null;
}

export interface FeedScheduleRow {
  id: number;
  time_of_day: string;
  days_of_week: number[];
  portions: number;
  label: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeedEventRow {
  id: number;
  created_at: string;
  source: TriggerSourceKey;
  data_origin: DataOrigin;
  result: FeedResult;
  portions_requested: number | null;
  portions_dispensed: number | null;
  remaining_portions_after: number | null;
  calibration_id: number | null;
  schedule_id: number | null;
  scheduled_for: string | null;
  test_label: string | null;
  vibration_g: number | null;
  tuya_endpoint: TuyaEndpoint | null;
  fallback_reason: string | null;
  token_refreshed: boolean | null;
  tuya_api_ms: number | null;
  server_total_ms: number | null;
  client_rtt_ms: number | null;
  network_ms: number | null;
  error: string | null;
}

export interface RefillEventRow {
  id: number;
  created_at: string;
  data_origin: "LIVE" | "SEEDED";
  portions_before: number;
  portions_after: number;
  grams_added_measured: number | null;
  note: string | null;
}

export interface SensorReadingRow {
  id: number;
  device_id: string;
  recorded_at: string;
  ax: number | null;
  ay: number | null;
  az: number | null;
  dynamic_g_mean: number | null;
  dynamic_g_peak: number | null;
  rssi: number | null;
  batch_id: string | null;
}

export interface DeviceHeartbeatRow {
  device_id: string;
  last_seen_at: string;
  last_rssi: number | null;
  firmware: string | null;
  ip: string | null;
}

export interface NotificationRow {
  id: number;
  created_at: string;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  status: "active" | "resolved";
  resolved_at: string | null;
  read_at: string | null;
  dedupe_key: string | null;
  channels_sent: string[];
}

export interface ReserveFeedRpcResult {
  ok: boolean;
  reason: FeedResult | "UNKNOWN_SOURCE" | null;
  retry_after_ms: number | null;
  log_skip: boolean;
  portions_requested: number;
  portions_reserved: number;
  portions_decremented: number;
  remaining_after: number;
  capacity_portions: number;
  daily_used_portions: number;
  daily_max_portions: number;
  simulation_mode: boolean;
  calibration_id: number | null;
}

let cachedClient: SupabaseClient | null = null;
let cachedKey: string | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  const runtimeEnv = process.env as Record<string, string | undefined>;
  const url = (
    runtimeEnv["SUPABASE_URL"] ||
    runtimeEnv["NEXT_PUBLIC_SUPABASE_URL"] ||
    process.env.NEXT_PUBLIC_SUPABASE_URL
  )?.trim();
  const serviceKey = (
    runtimeEnv["SUPABASE_SERVICE_ROLE_KEY"] ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable."
    );
  }

  const cacheSignature = `${url}::${serviceKey}`;
  if (!cachedClient || cachedKey !== cacheSignature) {
    cachedClient = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    cachedKey = cacheSignature;
  }

  return cachedClient;
}

