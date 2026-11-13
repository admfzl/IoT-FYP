import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import {
  getSupabaseAdmin,
  type TriggerSourceKey
} from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// Deterministic SEEDED rows for UI preview. Never touches LIVE rows or feeder_settings.
const DEMO_FEED_SPEC: Array<{
  source: TriggerSourceKey;
  portions: number;
  vibration_g: number | null;
  token_refreshed: boolean;
  endpoint: "v2_shadow" | "v1_commands";
  fallback_reason: string | null;
  tuya_api_ms: number;
  server_total_ms: number;
  client_rtt_ms: number | null;
}> = [
  { source: "MANUAL", portions: 2, vibration_g: null, token_refreshed: true, endpoint: "v2_shadow", fallback_reason: null, tuya_api_ms: 410, server_total_ms: 520, client_rtt_ms: 595 },
  { source: "MANUAL", portions: 1, vibration_g: null, token_refreshed: false, endpoint: "v2_shadow", fallback_reason: null, tuya_api_ms: 215, server_total_ms: 295, client_rtt_ms: 355 },
  { source: "PHONE_SENSOR", portions: 1, vibration_g: 0.48, token_refreshed: false, endpoint: "v2_shadow", fallback_reason: null, tuya_api_ms: 230, server_total_ms: 312, client_rtt_ms: 382 },
  { source: "ESP32_SENSOR", portions: 1, vibration_g: 0.62, token_refreshed: false, endpoint: "v2_shadow", fallback_reason: null, tuya_api_ms: 220, server_total_ms: 305, client_rtt_ms: 410 },
  { source: "SCHEDULE", portions: 2, vibration_g: null, token_refreshed: false, endpoint: "v2_shadow", fallback_reason: null, tuya_api_ms: 205, server_total_ms: 285, client_rtt_ms: null },
  { source: "MANUAL", portions: 1, vibration_g: null, token_refreshed: false, endpoint: "v2_shadow", fallback_reason: null, tuya_api_ms: 198, server_total_ms: 278, client_rtt_ms: 340 },
  { source: "PHONE_SENSOR", portions: 1, vibration_g: 0.55, token_refreshed: false, endpoint: "v2_shadow", fallback_reason: null, tuya_api_ms: 245, server_total_ms: 330, client_rtt_ms: 405 },
  { source: "ESP32_SENSOR", portions: 2, vibration_g: 0.74, token_refreshed: false, endpoint: "v1_commands", fallback_reason: "v2_shadow [2009]: shadow issue timeout", tuya_api_ms: 340, server_total_ms: 430, client_rtt_ms: 545 },
  { source: "SCHEDULE", portions: 2, vibration_g: null, token_refreshed: false, endpoint: "v2_shadow", fallback_reason: null, tuya_api_ms: 212, server_total_ms: 292, client_rtt_ms: null },
  { source: "MANUAL", portions: 1, vibration_g: null, token_refreshed: false, endpoint: "v2_shadow", fallback_reason: null, tuya_api_ms: 225, server_total_ms: 302, client_rtt_ms: 365 },
  { source: "PHONE_SENSOR", portions: 1, vibration_g: 0.51, token_refreshed: false, endpoint: "v2_shadow", fallback_reason: null, tuya_api_ms: 218, server_total_ms: 298, client_rtt_ms: 368 },
  { source: "ESP32_SENSOR", portions: 1, vibration_g: 0.69, token_refreshed: false, endpoint: "v2_shadow", fallback_reason: null, tuya_api_ms: 232, server_total_ms: 315, client_rtt_ms: 420 }
];

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  const supabase = getSupabaseAdmin();
  const { data: settings } = await supabase
    .from("feeder_settings")
    .select("capacity_portions, active_calibration_id")
    .eq("id", 1)
    .single();

  const capacity = settings?.capacity_portions ?? 40;
  const calId = settings?.active_calibration_id ?? null;
  let remaining = capacity;
  const baseTime = Date.now() - DEMO_FEED_SPEC.length * 3600_000;

  const feedRows = DEMO_FEED_SPEC.map((item, idx) => {
    remaining = Math.max(0, remaining - item.portions);
    const ts = new Date(baseTime + idx * 3600_000).toISOString();
    return {
      created_at: ts,
      source: item.source,
      data_origin: "SEEDED" as const,
      result: "FED" as const,
      portions_requested: item.portions,
      portions_dispensed: item.portions,
      remaining_portions_after: remaining,
      calibration_id: calId,
      scheduled_for: item.source === "SCHEDULE" ? ts : null,
      test_label: "demo-seed",
      vibration_g: item.vibration_g,
      tuya_endpoint: item.endpoint,
      fallback_reason: item.fallback_reason,
      token_refreshed: item.token_refreshed,
      tuya_api_ms: item.tuya_api_ms,
      server_total_ms: item.server_total_ms,
      client_rtt_ms: item.client_rtt_ms,
      network_ms:
        item.client_rtt_ms !== null
          ? item.client_rtt_ms - item.server_total_ms
          : null,
      error: null
    };
  });

  const { data, error } = await supabase
    .from("feed_events")
    .insert(feedRows)
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: `Failed to seed demo rows: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    insertedCount: data?.length ?? feedRows.length
  });
}

