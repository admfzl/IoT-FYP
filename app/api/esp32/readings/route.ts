import { NextRequest, NextResponse } from "next/server";
import {
  getSupabaseAdmin,
  type DeviceHeartbeatRow,
  type SensorReadingRow,
  type TriggerSourceRow
} from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);

    const deviceId = searchParams.get("deviceId") || "esp32-s3-1";
    const afterId = searchParams.get("after");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const bucketSecParam = searchParams.get("bucket");
    const limit = Math.min(
      500,
      Math.max(1, Number(searchParams.get("limit") || 200))
    );

    const now = new Date();
    const toIso = toParam || now.toISOString();
    const fromIso =
      fromParam || new Date(now.getTime() - 2 * 60_000).toISOString();

    const [
      { data: hbData },
      { data: espSourceData },
      { data: phoneSourceData },
      { data: lastPhoneFeedData }
    ] = await Promise.all([
      supabase
        .from("device_heartbeats")
        .select("*")
        .eq("device_id", deviceId)
        .maybeSingle(),
      supabase
        .from("trigger_sources")
        .select("*")
        .eq("source", "ESP32_SENSOR")
        .single(),
      supabase
        .from("trigger_sources")
        .select("*")
        .eq("source", "PHONE_SENSOR")
        .single(),
      supabase
        .from("feed_events")
        .select("id, created_at, result, vibration_g, client_rtt_ms, portions_dispensed")
        .eq("source", "PHONE_SENSOR")
        .order("created_at", { ascending: false })
        .limit(1)
    ]);

    const heartbeat = (hbData as DeviceHeartbeatRow | null) ?? null;
    const espSource = (espSourceData as TriggerSourceRow | null) ?? null;
    const phoneSource = (phoneSourceData as TriggerSourceRow | null) ?? null;
    const thresholdG = Number(espSource?.threshold_g ?? 0.3);

    // Readings per minute (last 60s)
    const oneMinAgoIso = new Date(now.getTime() - 60_000).toISOString();
    const { count: readingsLastMinute } = await supabase
      .from("sensor_readings")
      .select("id", { count: "exact", head: true })
      .eq("device_id", deviceId)
      .gte("recorded_at", oneMinAgoIso);

    // Trigger markers in the selected range
    const { data: triggerEventsData } = await supabase
      .from("feed_events")
      .select("id, created_at, result, vibration_g, portions_dispensed")
      .eq("source", "ESP32_SENSOR")
      .neq("result", "PENDING")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true })
      .limit(100);

    // Statistics for the selected range via RPC
    const { data: statsData } = await supabase.rpc("sensor_stats", {
      p_device_id: deviceId,
      p_from: fromIso,
      p_to: toIso,
      p_threshold: thresholdG
    });

    const bucketSeconds = bucketSecParam ? Number(bucketSecParam) : 0;

    if (bucketSeconds > 1 && !afterId) {
      // Downsampled buckets for 10 min / 1 h windows
      const { data: bucketRows, error: bucketErr } = await supabase.rpc(
        "sensor_buckets",
        {
          p_device_id: deviceId,
          p_from: fromIso,
          p_to: toIso,
          p_bucket_seconds: bucketSeconds
        }
      );
      if (bucketErr) {
        return NextResponse.json({ error: bucketErr.message }, { status: 500 });
      }

      const readings: SensorReadingRow[] = (bucketRows ?? []).map(
        (b: {
          bucket: string;
          ax: number;
          ay: number;
          az: number;
          dynamic_g_mean: number;
          dynamic_g_peak: number;
        }, i: number) => ({
          id: i + 1,
          device_id: deviceId,
          recorded_at: b.bucket,
          ax: b.ax,
          ay: b.ay,
          az: b.az,
          dynamic_g_mean: b.dynamic_g_mean,
          dynamic_g_peak: b.dynamic_g_peak,
          rssi: heartbeat?.last_rssi ?? null,
          batch_id: null
        })
      );

      return NextResponse.json({
        heartbeat,
        espSource,
        phoneSource,
        lastPhoneFeed: lastPhoneFeedData?.[0] ?? null,
        readingsPerMinute: readingsLastMinute ?? 0,
        readings,
        triggers: triggerEventsData ?? [],
        stats: {
          ...((statsData as Record<string, unknown>) ?? {}),
          feedsTriggered: (triggerEventsData ?? []).filter(
            (e) => e.result === "FED"
          ).length
        }
      });
    }

    // Raw readings (append-only polling `?after=<lastId>` or initial 2 min window)
    let query = supabase
      .from("sensor_readings")
      .select("*")
      .eq("device_id", deviceId);

    if (afterId && Number.isInteger(Number(afterId)) && Number(afterId) > 0) {
      query = query
        .gt("id", Number(afterId))
        .order("id", { ascending: true })
        .limit(limit);
    } else {
      query = query
        .gte("recorded_at", fromIso)
        .lte("recorded_at", toIso)
        .order("recorded_at", { ascending: true })
        .limit(limit);
    }

    const { data: readingsData, error: readErr } = await query;
    if (readErr) {
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }

    return NextResponse.json({
      heartbeat,
      espSource,
      phoneSource,
      lastPhoneFeed: lastPhoneFeedData?.[0] ?? null,
      readingsPerMinute: readingsLastMinute ?? 0,
      readings: (readingsData ?? []) as SensorReadingRow[],
      triggers: triggerEventsData ?? [],
      stats: {
        ...((statsData as Record<string, unknown>) ?? {}),
        feedsTriggered: (triggerEventsData ?? []).filter(
          (e) => e.result === "FED"
        ).length
      }
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to load ESP32 sensor readings."
      },
      { status: 500 }
    );
  }
}

