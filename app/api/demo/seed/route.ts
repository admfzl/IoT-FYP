import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin, type FeedSource } from "@/lib/supabase";

//Deterministic sample rows marked exclusively as SEEDED for UI layout testing.
//Never touches LIVE rows or feeder_state.
const DEMO_SEED_SPEC: Array<{
  source: FeedSource;
  vibration_g: number | null;
  token_refreshed: boolean;
  tuya_api_ms: number;
  server_total_ms: number;
  client_rtt_ms: number;
}> = [
  { source: "MANUAL_APP", vibration_g: null, token_refreshed: true, tuya_api_ms: 410, server_total_ms: 520, client_rtt_ms: 595 },
  { source: "MANUAL_APP", vibration_g: null, token_refreshed: false, tuya_api_ms: 215, server_total_ms: 295, client_rtt_ms: 355 },
  { source: "PHONE_SENSOR", vibration_g: 0.48, token_refreshed: false, tuya_api_ms: 230, server_total_ms: 312, client_rtt_ms: 382 },
  { source: "ESP32_SENSOR", vibration_g: 1.32, token_refreshed: false, tuya_api_ms: 220, server_total_ms: 305, client_rtt_ms: 390 },
  { source: "MANUAL_APP", vibration_g: null, token_refreshed: false, tuya_api_ms: 198, server_total_ms: 278, client_rtt_ms: 340 },
  { source: "PHONE_SENSOR", vibration_g: 0.62, token_refreshed: false, tuya_api_ms: 245, server_total_ms: 330, client_rtt_ms: 405 },
  { source: "ESP32_SENSOR", vibration_g: 1.54, token_refreshed: false, tuya_api_ms: 210, server_total_ms: 290, client_rtt_ms: 372 },
  { source: "MANUAL_APP", vibration_g: null, token_refreshed: false, tuya_api_ms: 225, server_total_ms: 302, client_rtt_ms: 365 },
  { source: "PHONE_SENSOR", vibration_g: 0.55, token_refreshed: false, tuya_api_ms: 218, server_total_ms: 298, client_rtt_ms: 368 },
  { source: "ESP32_SENSOR", vibration_g: 1.19, token_refreshed: false, tuya_api_ms: 232, server_total_ms: 315, client_rtt_ms: 398 },
  { source: "MANUAL_APP", vibration_g: null, token_refreshed: false, tuya_api_ms: 205, server_total_ms: 284, client_rtt_ms: 348 },
  { source: "PHONE_SENSOR", vibration_g: 0.74, token_refreshed: false, tuya_api_ms: 260, server_total_ms: 342, client_rtt_ms: 420 }
];

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Database configuration error on server."
      },
      { status: 500 }
    );
  }

  const maxCap = 60.0;
  const portion = 4.5; // Drops across 12 demo feeds to demonstrate the 20% low-food threshold line
  let remaining = maxCap;
  const baseTime = Date.now() - DEMO_SEED_SPEC.length * 15_000;

  const rowsToInsert = DEMO_SEED_SPEC.map((item, idx) => {
    remaining = Math.max(0, Math.round((remaining - portion) * 10) / 10);
    const pct = Math.round((remaining / maxCap) * 1000) / 10;
    return {
      created_at: new Date(baseTime + idx * 15_000).toISOString(),
      source: item.source,
      data_origin: "SEEDED" as const,
      run_label: "demo-ui-seed",
      vibration_g: item.vibration_g,
      tuya_endpoint: "v2_shadow" as const,
      token_refreshed: item.token_refreshed,
      tuya_api_ms: item.tuya_api_ms,
      server_total_ms: item.server_total_ms,
      client_rtt_ms: item.client_rtt_ms,
      network_ms: item.client_rtt_ms - item.server_total_ms,
      tuya_success: true,
      tuya_error: null,
      remaining_grams: remaining,
      remaining_percent: pct
    };
  });

  const { data, error } = await supabase
    .from("feed_logs")
    .insert(rowsToInsert)
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: `Failed to seed demo rows: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    insertedCount: data?.length ?? rowsToInsert.length
  });
}

