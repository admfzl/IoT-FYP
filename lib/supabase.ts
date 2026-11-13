import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type FeedSource = "MANUAL_APP" | "PHONE_SENSOR" | "ESP32_SENSOR";
export type DataOrigin = "LIVE" | "SIMULATED" | "SEEDED";
export type TuyaEndpoint = "v2_shadow" | "v1_commands";

export interface FeederState {
  id: number;
  remaining_grams: number;
  max_capacity_grams: number;
  grams_per_portion: number;
  cooldown_seconds: number;
  simulation_mode: boolean;
  last_feed_at: string | null;
  updated_at: string;
}

export interface FeedLog {
  id: number;
  created_at: string;
  source: FeedSource;
  data_origin: DataOrigin;
  run_label: string | null;
  vibration_g: number | null;
  tuya_endpoint: TuyaEndpoint | null;
  token_refreshed: boolean;
  tuya_api_ms: number | null;
  server_total_ms: number | null;
  client_rtt_ms: number | null;
  network_ms: number | null;
  tuya_success: boolean;
  tuya_error: string | null;
  remaining_grams: number;
  remaining_percent: number;
}

export interface ReservePortionResult {
  cooldown: boolean;
  retry_after_ms: number;
  remaining_grams: number;
  max_capacity_grams: number;
  grams_per_portion: number;
  cooldown_seconds: number;
  simulation_mode: boolean;
  last_feed_at: string | null;
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

