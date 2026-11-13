import { NextRequest, NextResponse } from "next/server";
import {
  getSupabaseAdmin,
  type FeedEventRow
} from "@/lib/supabase-server";
import { buildCsvDocument } from "@/lib/csv";
import { formatLocalIsoTimestamp, getZonedParts } from "@/lib/time";
import {
  computeClientLatencyBySource,
  computeScheduleServerStats
} from "@/lib/stats";

export const dynamic = "force-dynamic";

type ExportDataset =
  | "feed-events"
  | "sensor-readings"
  | "hopper-history"
  | "schedule-runs"
  | "notifications"
  | "latency-summary";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ dataset: string }> }
) {
  try {
    const { dataset: rawDataset } = await context.params;
    const dataset = rawDataset as ExportDataset;

    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") === "json" ? "json" : "csv";
    const liveOnly = searchParams.get("liveOnly") !== "false";

    const now = new Date();
    const defaultFrom = new Date(
      now.getTime() - 30 * 86_400_000
    ).toISOString();
    const fromIso = searchParams.get("from") || defaultFrom;
    const toIso = searchParams.get("to") || now.toISOString();

    const supabase = getSupabaseAdmin();
    const { data: settings } = await supabase
      .from("feeder_settings")
      .select("timezone, capacity_portions, active_calibration_id")
      .eq("id", 1)
      .single();

    const tz = settings?.timezone ?? "Asia/Kuala_Lumpur";
    const fromDateStr = getZonedParts(fromIso, tz).dateStr;
    const toDateStr = getZonedParts(toIso, tz).dateStr;
    const fileBase = `${dataset}_${fromDateStr}_to_${toDateStr}.${format}`;

    // 1. Sensor readings: stream directly from Postgres via export_sensor_chunk RPC
    if (dataset === "sensor-readings") {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            if (format === "csv") {
              controller.enqueue(
                encoder.encode(
                  "id,recorded_at_utc,recorded_at_myt,device_id,ax_ms2,ay_ms2,az_ms2,dynamic_g_mean,dynamic_g_peak,rssi_dbm\n"
                )
              );
            } else {
              controller.enqueue(encoder.encode("[\n"));
            }

            let afterId = 0;
            let firstJsonChunk = true;
            const pageSize = 5000;

            for (;;) {
              const { data: chunkRes, error } = await supabase.rpc(
                "export_sensor_chunk",
                {
                  p_from: fromIso,
                  p_to: toIso,
                  p_after_id: afterId,
                  p_limit: pageSize,
                  p_tz: tz,
                  p_format: format
                }
              );

              if (error || !chunkRes) break;

              const n = Number(chunkRes.n ?? 0);
              const chunkText = String(chunkRes.chunk ?? "");
              const lastId = Number(chunkRes.last_id ?? 0);

              if (n <= 0 || !chunkText) break;

              if (format === "csv") {
                controller.enqueue(encoder.encode(chunkText + "\n"));
              } else {
                if (!firstJsonChunk) {
                  controller.enqueue(encoder.encode(",\n"));
                }
                controller.enqueue(encoder.encode(chunkText));
                firstJsonChunk = false;
              }

              afterId = lastId;
              if (n < pageSize) break;
            }

            if (format === "json") {
              controller.enqueue(encoder.encode("\n]\n"));
            }
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        }
      });

      return new NextResponse(stream, {
        headers: {
          "Content-Type":
            format === "json"
              ? "application/json; charset=utf-8"
              : "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileBase}"`
        }
      });
    }

    // 2. Feed events
    if (dataset === "feed-events") {
      let query = supabase
        .from("feed_events")
        .select("*")
        .neq("result", "PENDING")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .limit(10000);

      if (liveOnly) {
        query = query.eq("data_origin", "LIVE");
      }

      const { data, error } = await query;
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const rows = (data ?? []) as FeedEventRow[];

      if (format === "json") {
        const enriched = rows.map((r) => ({
          ...r,
          created_at_myt: formatLocalIsoTimestamp(r.created_at, tz)
        }));
        return makeDownloadResponse(
          JSON.stringify(enriched, null, 2),
          fileBase,
          "json"
        );
      }

      const headers = [
        "id",
        "created_at_utc",
        "created_at_myt",
        "source",
        "data_origin",
        "result",
        "portions_requested",
        "portions_dispensed",
        "remaining_portions_after",
        "calibration_id",
        "schedule_id",
        "scheduled_for_utc",
        "scheduled_for_myt",
        "test_label",
        "vibration_g",
        "tuya_endpoint",
        "fallback_reason",
        "token_refreshed",
        "tuya_api_ms",
        "server_total_ms",
        "client_rtt_ms",
        "network_ms",
        "error"
      ];

      const csvRows = rows.map((r) => [
        r.id,
        r.created_at,
        formatLocalIsoTimestamp(r.created_at, tz),
        r.source,
        r.data_origin,
        r.result,
        r.portions_requested,
        r.portions_dispensed,
        r.remaining_portions_after,
        r.calibration_id,
        r.schedule_id,
        r.scheduled_for,
        formatLocalIsoTimestamp(r.scheduled_for, tz),
        r.test_label,
        r.vibration_g,
        r.tuya_endpoint,
        r.fallback_reason,
        r.token_refreshed,
        r.tuya_api_ms,
        r.server_total_ms,
        r.client_rtt_ms,
        r.network_ms,
        r.error
      ]);

      return makeDownloadResponse(
        buildCsvDocument(headers, csvRows),
        fileBase,
        "csv"
      );
    }

    // 3. Hopper level history + refill events
    if (dataset === "hopper-history") {
      let feedsQ = supabase
        .from("feed_events")
        .select(
          "id, created_at, source, data_origin, portions_dispensed, remaining_portions_after, calibration_id"
        )
        .eq("result", "FED")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .limit(10000);

      let refillsQ = supabase
        .from("refill_events")
        .select("*")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .limit(2000);

      if (liveOnly) {
        feedsQ = feedsQ.eq("data_origin", "LIVE");
        refillsQ = refillsQ.eq("data_origin", "LIVE");
      }

      const [{ data: feeds }, { data: refills }] = await Promise.all([
        feedsQ,
        refillsQ
      ]);

      const combined: Array<{
        event_type: "FEED" | "REFILL";
        event_id: number;
        created_at_utc: string;
        created_at_myt: string;
        source: string;
        data_origin: string;
        portions_change: number;
        remaining_portions_after: number;
        grams_added_measured: number | null;
        calibration_id: number | null;
        note: string | null;
      }> = [];

      for (const f of feeds ?? []) {
        combined.push({
          event_type: "FEED",
          event_id: f.id,
          created_at_utc: f.created_at,
          created_at_myt: formatLocalIsoTimestamp(f.created_at, tz),
          source: f.source,
          data_origin: f.data_origin,
          portions_change: -(f.portions_dispensed ?? 0),
          remaining_portions_after: f.remaining_portions_after ?? 0,
          grams_added_measured: null,
          calibration_id: f.calibration_id ?? null,
          note: null
        });
      }
      for (const r of refills ?? []) {
        combined.push({
          event_type: "REFILL",
          event_id: r.id,
          created_at_utc: r.created_at,
          created_at_myt: formatLocalIsoTimestamp(r.created_at, tz),
          source: "REFILL",
          data_origin: r.data_origin,
          portions_change: r.portions_after - r.portions_before,
          remaining_portions_after: r.portions_after,
          grams_added_measured: r.grams_added_measured,
          calibration_id: null,
          note: r.note
        });
      }

      combined.sort(
        (a, b) =>
          new Date(a.created_at_utc).getTime() -
          new Date(b.created_at_utc).getTime()
      );

      if (format === "json") {
        return makeDownloadResponse(
          JSON.stringify(combined, null, 2),
          fileBase,
          "json"
        );
      }

      const headers = [
        "event_type",
        "event_id",
        "created_at_utc",
        "created_at_myt",
        "source",
        "data_origin",
        "portions_change",
        "remaining_portions_after",
        "grams_added_measured",
        "calibration_id",
        "note"
      ];
      const csvRows = combined.map((c) => [
        c.event_type,
        c.event_id,
        c.created_at_utc,
        c.created_at_myt,
        c.source,
        c.data_origin,
        c.portions_change,
        c.remaining_portions_after,
        c.grams_added_measured,
        c.calibration_id,
        c.note
      ]);
      return makeDownloadResponse(
        buildCsvDocument(headers, csvRows),
        fileBase,
        "csv"
      );
    }

    // 4. Schedule runs
    if (dataset === "schedule-runs") {
      let query = supabase
        .from("feed_events")
        .select("*")
        .eq("source", "SCHEDULE")
        .neq("result", "PENDING")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .limit(5000);

      if (liveOnly) {
        query = query.eq("data_origin", "LIVE");
      }

      const { data, error } = await query;
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const rows = (data ?? []) as FeedEventRow[];

      if (format === "json") {
        const enriched = rows.map((r) => ({
          ...r,
          scheduled_for_myt: formatLocalIsoTimestamp(r.scheduled_for, tz),
          created_at_myt: formatLocalIsoTimestamp(r.created_at, tz)
        }));
        return makeDownloadResponse(
          JSON.stringify(enriched, null, 2),
          fileBase,
          "json"
        );
      }

      const headers = [
        "id",
        "schedule_id",
        "label",
        "scheduled_for_utc",
        "scheduled_for_myt",
        "actual_time_utc",
        "actual_time_myt",
        "result",
        "portions_requested",
        "portions_dispensed",
        "server_total_ms",
        "tuya_api_ms",
        "tuya_endpoint",
        "fallback_reason",
        "error"
      ];
      const csvRows = rows.map((r) => [
        r.id,
        r.schedule_id,
        r.test_label,
        r.scheduled_for,
        formatLocalIsoTimestamp(r.scheduled_for, tz),
        r.created_at,
        formatLocalIsoTimestamp(r.created_at, tz),
        r.result,
        r.portions_requested,
        r.portions_dispensed,
        r.server_total_ms,
        r.tuya_api_ms,
        r.tuya_endpoint,
        r.fallback_reason,
        r.error
      ]);
      return makeDownloadResponse(
        buildCsvDocument(headers, csvRows),
        fileBase,
        "csv"
      );
    }

    // 5. Notifications
    if (dataset === "notifications") {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .limit(5000);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const rows = data ?? [];

      if (format === "json") {
        const enriched = rows.map((r) => ({
          ...r,
          created_at_myt: formatLocalIsoTimestamp(r.created_at, tz),
          resolved_at_myt: formatLocalIsoTimestamp(r.resolved_at, tz)
        }));
        return makeDownloadResponse(
          JSON.stringify(enriched, null, 2),
          fileBase,
          "json"
        );
      }

      const headers = [
        "id",
        "created_at_utc",
        "created_at_myt",
        "type",
        "severity",
        "message",
        "status",
        "resolved_at_utc",
        "resolved_at_myt",
        "read_at_utc",
        "dedupe_key",
        "channels_sent"
      ];
      const csvRows = rows.map((r) => [
        r.id,
        r.created_at,
        formatLocalIsoTimestamp(r.created_at, tz),
        r.type,
        r.severity,
        r.message,
        r.status,
        r.resolved_at,
        formatLocalIsoTimestamp(r.resolved_at, tz),
        r.read_at,
        r.dedupe_key,
        Array.isArray(r.channels_sent) ? r.channels_sent.join(";") : ""
      ]);
      return makeDownloadResponse(
        buildCsvDocument(headers, csvRows),
        fileBase,
        "csv"
      );
    }

    // 6. Latency summary
    if (dataset === "latency-summary") {
      let query = supabase
        .from("feed_events")
        .select("*")
        .neq("result", "PENDING")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .limit(10000);

      if (liveOnly) {
        query = query.eq("data_origin", "LIVE");
      }

      const { data, error } = await query;
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const events = (data ?? []) as FeedEventRow[];
      const clientStats = computeClientLatencyBySource(events);
      const scheduleStats = computeScheduleServerStats(events);

      if (format === "json") {
        return makeDownloadResponse(
          JSON.stringify(
            {
              from_utc: fromIso,
              to_utc: toIso,
              from_myt: formatLocalIsoTimestamp(fromIso, tz),
              to_myt: formatLocalIsoTimestamp(toIso, tz),
              live_only: liveOnly,
              client_sources: clientStats,
              schedule_server_side: scheduleStats
            },
            null,
            2
          ),
          fileBase,
          "json"
        );
      }

      const headers = [
        "source",
        "metric_basis",
        "from_utc",
        "to_utc",
        "from_myt",
        "to_myt",
        "n_measured",
        "min_ms",
        "mean_ms",
        "median_ms",
        "p95_ms",
        "max_ms",
        "mean_feeder_api_ms",
        "mean_network_ms",
        "mean_server_overhead_ms",
        "success_rate_percent",
        "token_renewed_count",
        "fallback_endpoint_count"
      ];

      const fromMyt = formatLocalIsoTimestamp(fromIso, tz);
      const toMyt = formatLocalIsoTimestamp(toIso, tz);

      const csvRows: Array<Array<unknown>> = clientStats.map((s) => [
        s.source,
        "client_rtt_ms",
        fromIso,
        toIso,
        fromMyt,
        toMyt,
        s.n,
        s.min,
        s.mean,
        s.median,
        s.p95,
        s.max,
        s.meanTuyaApiMs,
        s.meanNetworkMs,
        s.meanServerOverheadMs,
        s.successRate,
        s.tokenRefreshedCount,
        s.fallbackCount
      ]);

      csvRows.push([
        "SCHEDULE",
        "server_total_ms",
        fromIso,
        toIso,
        fromMyt,
        toMyt,
        scheduleStats.n,
        scheduleStats.minServerMs,
        scheduleStats.meanServerMs,
        scheduleStats.medianServerMs,
        scheduleStats.p95ServerMs,
        scheduleStats.maxServerMs,
        scheduleStats.meanTuyaApiMs,
        null,
        null,
        scheduleStats.successRate,
        scheduleStats.tokenRefreshedCount,
        scheduleStats.fallbackCount
      ]);

      return makeDownloadResponse(
        buildCsvDocument(headers, csvRows),
        fileBase,
        "csv"
      );
    }

    return NextResponse.json(
      { error: `Unknown export dataset: ${dataset}` },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Export failed."
      },
      { status: 500 }
    );
  }
}

function makeDownloadResponse(
  body: string,
  filename: string,
  format: "csv" | "json"
): NextResponse {
  return new NextResponse(body, {
    headers: {
      "Content-Type":
        format === "json"
          ? "application/json; charset=utf-8"
          : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}

