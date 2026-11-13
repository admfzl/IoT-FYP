import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, type FeedLog, type FeederState } from "@/lib/supabase";
import { computeSummaryBySource } from "@/lib/stats";
import { getTuyaHardwareStatus, isTuyaConfigured } from "@/lib/tuya";
import { getEsp32TelemetryState } from "@/lib/esp32-telemetry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const includeDemo = req.nextUrl.searchParams.get("includeDemo") === "1";

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

  // 1. Fetch feeder_state (id = 1), auto-inserting row id=1 if table exists but is empty
  let { data: stateRow, error: stateError } = await supabase
    .from("feeder_state")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (!stateError && !stateRow) {
    const { data: insertedState, error: insertStateErr } = await supabase
      .from("feeder_state")
      .insert({
        id: 1,
        remaining_grams: 60.0,
        max_capacity_grams: 60.0,
        grams_per_portion: 1.5,
        cooldown_seconds: 5,
        simulation_mode: false,
        last_feed_at: null
      })
      .select("*")
      .single();
    stateRow = insertedState;
    stateError = insertStateErr;
  }

  if (stateError || !stateRow) {
    return NextResponse.json(
      {
        error: `Failed to fetch feeder_state: ${stateError?.message ?? "row id=1 missing. Paste supabase/migration.sql into the Supabase SQL Editor and click Run."}`
      },
      { status: 500 }
    );
  }

  const feederState: FeederState = {
    id: Number(stateRow.id),
    remaining_grams: Number(stateRow.remaining_grams),
    max_capacity_grams: Number(stateRow.max_capacity_grams),
    grams_per_portion: Number(stateRow.grams_per_portion),
    cooldown_seconds: Number(stateRow.cooldown_seconds),
    simulation_mode: Boolean(stateRow.simulation_mode),
    last_feed_at: stateRow.last_feed_at,
    updated_at: stateRow.updated_at
  };

  // 2. Count total LIVE feeds
  const { count: totalLiveFeeds } = await supabase
    .from("feed_logs")
    .select("*", { count: "exact", head: true })
    .eq("data_origin", "LIVE");

  // 3. Fetch feed_logs (LIVE only by default, or all when includeDemo=1)
  let query = supabase
    .from("feed_logs")
    .select("*")
    .order("id", { ascending: false })
    .limit(500);

  if (!includeDemo) {
    query = query.eq("data_origin", "LIVE");
  }

  const { data: rawLogs, error: logsError } = await query;

  if (logsError) {
    return NextResponse.json(
      { error: `Failed to fetch feed_logs: ${logsError.message}` },
      { status: 500 }
    );
  }

  const allLogs: FeedLog[] = (rawLogs ?? []).map((row) => ({
    id: Number(row.id),
    created_at: String(row.created_at),
    source: row.source,
    data_origin: row.data_origin,
    run_label: row.run_label,
    vibration_g: row.vibration_g !== null ? Number(row.vibration_g) : null,
    tuya_endpoint: row.tuya_endpoint,
    token_refreshed: Boolean(row.token_refreshed),
    tuya_api_ms: row.tuya_api_ms !== null ? Number(row.tuya_api_ms) : null,
    server_total_ms:
      row.server_total_ms !== null ? Number(row.server_total_ms) : null,
    client_rtt_ms:
      row.client_rtt_ms !== null ? Number(row.client_rtt_ms) : null,
    network_ms: row.network_ms !== null ? Number(row.network_ms) : null,
    tuya_success: Boolean(row.tuya_success),
    tuya_error: row.tuya_error,
    remaining_grams: Number(row.remaining_grams),
    remaining_percent: Number(row.remaining_percent)
  }));

  const summaryBySource = computeSummaryBySource(allLogs);
  const tuyaHardwareStatus = await getTuyaHardwareStatus();
  const esp32Telemetry = getEsp32TelemetryState();

  return NextResponse.json({
    feederState,
    tuyaConfigured: isTuyaConfigured(),
    tuyaHardwareStatus,
    esp32Telemetry,
    totalLiveFeeds: totalLiveFeeds ?? 0,
    includeDemo,
    logs: allLogs.slice(0, 50), // Latest 50 for table (descending)
    chartLogs: [...allLogs].reverse(), // Chronological order for charts
    summaryBySource
  });
}

