"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  SectionHeader,
  Skeleton,
  StatCard,
  StatusDot
} from "@/components/ui";
import { LiveChart } from "@/components/charts";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import {
  formatDateTimeMYT,
  formatRelativeAgo,
  formatTimeMYT
} from "@/lib/time";
import type {
  DeviceHeartbeatRow,
  SensorReadingRow,
  TriggerSourceRow
} from "@/lib/supabase-server";

type RangeWindow = "2m" | "10m" | "1h";

interface SensorReadingsApiResponse {
  heartbeat: DeviceHeartbeatRow | null;
  espSource: TriggerSourceRow | null;
  phoneSource: TriggerSourceRow | null;
  lastPhoneFeed: {
    id: number;
    created_at: string;
    result: string;
    vibration_g: number | null;
    client_rtt_ms: number | null;
    portions_dispensed: number | null;
  } | null;
  readingsPerMinute: number;
  readings: SensorReadingRow[];
  triggers: Array<{
    id: number;
    created_at: string;
    result: string;
    vibration_g: number | null;
    portions_dispensed: number | null;
  }>;
  stats: {
    count?: number;
    mean?: number | null;
    peak?: number | null;
    p95?: number | null;
    crossings?: number;
    feedsTriggered?: number;
  };
}

export default function SensorsPage() {
  const [rangeWindow, setRangeWindow] = useState<RangeWindow>("2m");
  const [readings, setReadings] = useState<SensorReadingRow[]>([]);
  const [heartbeat, setHeartbeat] = useState<DeviceHeartbeatRow | null>(null);
  const [espSource, setEspSource] = useState<TriggerSourceRow | null>(null);
  const [phoneSource, setPhoneSource] = useState<TriggerSourceRow | null>(null);
  const [lastPhoneFeed, setLastPhoneFeed] =
    useState<SensorReadingsApiResponse["lastPhoneFeed"]>(null);
  const [readingsPerMinute, setReadingsPerMinute] = useState(0);
  const [triggers, setTriggers] = useState<
    SensorReadingsApiResponse["triggers"]
  >([]);
  const [stats, setStats] = useState<SensorReadingsApiResponse["stats"]>({});
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const lastIdRef = useRef<number>(0);

  // Tick local clock every second so "Last reading X s ago" and Online/Delayed/Offline stay live
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const windowDurationMs =
    rangeWindow === "2m"
      ? 2 * 60_000
      : rangeWindow === "10m"
        ? 10 * 60_000
        : 60 * 60_000;

  // Full load for selected window (2m raw, 10m 5s buckets, 1h 30s buckets)
  const fetchFullWindow = useCallback(async () => {
    try {
      const now = new Date();
      const fromIso = new Date(
        now.getTime() - windowDurationMs
      ).toISOString();
      const bucketParam =
        rangeWindow === "10m" ? "&bucket=5" : rangeWindow === "1h" ? "&bucket=30" : "";
      const res = await fetch(
        `/api/esp32/readings?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(now.toISOString())}${bucketParam}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const json = (await res.json()) as SensorReadingsApiResponse;
      setHeartbeat(json.heartbeat);
      setEspSource(json.espSource);
      setPhoneSource(json.phoneSource);
      setLastPhoneFeed(json.lastPhoneFeed);
      setReadingsPerMinute(json.readingsPerMinute ?? 0);
      setTriggers(json.triggers ?? []);
      setStats(json.stats ?? {});
      if (Array.isArray(json.readings) && json.readings.length > 0) {
        setReadings(json.readings);
        const maxId = json.readings.reduce(
          (m, r) => (r.id > m ? r.id : m),
          lastIdRef.current
        );
        lastIdRef.current = maxId;
      }
    } catch {
      // Never clear chart state on transient poll error (§5.2)
    } finally {
      setLoading(false);
    }
  }, [rangeWindow, windowDurationMs]);

  useEffect(() => {
    lastIdRef.current = 0;
    fetchFullWindow();
  }, [fetchFullWindow]);

  // Append-only incremental polling every 2 seconds ONLY while tab is visible (§5.2)
  useEffect(() => {
    let active = true;
    const pollIncremental = async () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      if (rangeWindow !== "2m") {
        // For 10m / 1h bucketed views, refresh every 6s
        await fetchFullWindow();
        return;
      }
      try {
        const afterParam =
          lastIdRef.current > 0 ? `?after=${lastIdRef.current}&limit=200` : "";
        const res = await fetch(`/api/esp32/readings${afterParam}`, {
          cache: "no-store"
        });
        if (!res.ok || !active) return;
        const json = (await res.json()) as SensorReadingsApiResponse;
        if (json.heartbeat) setHeartbeat(json.heartbeat);
        if (json.espSource) setEspSource(json.espSource);
        if (json.phoneSource) setPhoneSource(json.phoneSource);
        if (json.lastPhoneFeed !== undefined)
          setLastPhoneFeed(json.lastPhoneFeed);
        setReadingsPerMinute(json.readingsPerMinute ?? 0);
        setTriggers(json.triggers ?? []);
        setStats(json.stats ?? {});

        if (Array.isArray(json.readings) && json.readings.length > 0) {
          const incoming = json.readings;
          for (const r of incoming) {
            if (r.id > lastIdRef.current) lastIdRef.current = r.id;
          }
          setReadings((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const merged = [
              ...prev,
              ...incoming.filter((r) => !existingIds.has(r.id))
            ];
            const cutoffMs = Date.now() - windowDurationMs;
            return merged.filter(
              (r) => new Date(r.recorded_at).getTime() >= cutoffMs
            );
          });
        }
      } catch {
        // Never clear existing buffer on error
      }
    };

    const intervalMs = rangeWindow === "2m" ? 2000 : 6000;
    const timer = setInterval(pollIncremental, intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [rangeWindow, windowDurationMs, fetchFullWindow]);

  // Preferred: Supabase Realtime subscription on `sensor_readings` inserts (§5.2)
  useEffect(() => {
    if (rangeWindow !== "2m") return;
    const sb = getSupabaseBrowser();
    if (!sb) return;

    const channel = sb
      .channel("sensor_readings_live")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sensor_readings"
        },
        (payload) => {
          const row = payload.new as SensorReadingRow;
          if (!row || typeof row.id !== "number") return;
          if (row.id > lastIdRef.current) lastIdRef.current = row.id;
          setHeartbeat((prev) => ({
            device_id: row.device_id || prev?.device_id || "esp32-s3-1",
            last_seen_at: row.recorded_at,
            last_rssi: row.rssi ?? prev?.last_rssi ?? null,
            firmware: prev?.firmware ?? null,
            ip: prev?.ip ?? null
          }));
          setReadings((prev) => {
            if (prev.some((p) => p.id === row.id)) return prev;
            const cutoffMs = Date.now() - 2 * 60_000;
            return [
              ...prev.filter(
                (p) => new Date(p.recorded_at).getTime() >= cutoffMs
              ),
              row
            ];
          });
        }
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [rangeWindow]);

  // Derive ESP32 status from `last_seen_at`: Online < 5 s, Delayed 5-30 s, Offline > 30 s (§5.2)
  const lastSeenMs = heartbeat?.last_seen_at
    ? new Date(heartbeat.last_seen_at).getTime()
    : 0;
  const ageSec = lastSeenMs > 0 ? Math.max(0, (nowMs - lastSeenMs) / 1000) : Infinity;

  const espStatus: "Online" | "Delayed" | "Offline" =
    ageSec < 5 ? "Online" : ageSec <= 30 ? "Delayed" : "Offline";

  const latestReading =
    readings.length > 0 ? readings[readings.length - 1] : null;
  const thresholdG = Number(espSource?.threshold_g ?? 0.3);

  const chartPoints = readings.map((r) => ({
    timeLabel: formatTimeMYT(r.recorded_at),
    gPeak: Number(r.dynamic_g_peak ?? r.dynamic_g_mean ?? 0),
    gMean: Number(r.dynamic_g_mean ?? 0)
  }));

  const triggerLabels = triggers.map((t) => formatTimeMYT(t.created_at));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Sensors</h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Vibration sensor (ESP32) stream, range statistics, and phone sensor link.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/data?dataset=sensor-readings">
            <Button variant="secondary" size="sm">
              <Download className="w-4 h-4" strokeWidth={1.5} />
              Download sensor data
            </Button>
          </Link>
          <Button variant="secondary" size="sm" onClick={fetchFullWindow}>
            <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ESP32 status line + live chart */}
      <Card className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex flex-wrap items-center gap-4 text-sm tabular-nums">
            <StatusDot
              tone={
                espStatus === "Online"
                  ? "active"
                  : espStatus === "Delayed"
                    ? "neutral"
                    : "critical"
              }
              label={espStatus}
            />
            <span className="text-xs text-neutral-500">
              {heartbeat?.last_seen_at
                ? `Last reading ${formatRelativeAgo(heartbeat.last_seen_at, nowMs)}`
                : "No readings received yet"}
            </span>
            {heartbeat?.last_rssi !== null &&
              heartbeat?.last_rssi !== undefined && (
                <span className="text-xs text-neutral-500">
                  Signal {heartbeat.last_rssi} dBm
                </span>
              )}
            <span className="text-xs text-neutral-500">
              {readingsPerMinute} readings/min
            </span>
            <span className="text-xs text-neutral-500">
              {espSource?.enabled ? "Feeding enabled" : "Feeding disabled"}
            </span>
          </div>

          <div className="inline-flex items-center rounded-md border border-neutral-300 dark:border-neutral-800 p-0.5">
            {(["2m", "10m", "1h"] as RangeWindow[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setRangeWindow(w)}
                className={`px-2.5 py-1 text-xs font-medium rounded ${
                  rangeWindow === w
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 dark:text-neutral-400"
                }`}
              >
                {w === "2m" ? "2 min" : w === "10m" ? "10 min" : "1 h"}
              </button>
            ))}
          </div>
        </div>

        {loading && readings.length === 0 ? (
          <Skeleton className="h-60" />
        ) : chartPoints.length === 0 ? (
          <EmptyState
            title="No vibration readings in the selected range"
            description="Ensure the ESP32 sensor is powered on and posting batches to the server."
          />
        ) : (
          <LiveChart
            data={chartPoints}
            thresholdG={thresholdG}
            triggerTimeLabels={triggerLabels}
            heightClass="h-64"
          />
        )}

        {/* Current X, Y, Z and dynamic g as plain numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-neutral-200 dark:border-neutral-800 text-sm tabular-nums">
          <div>
            <div className="text-xs text-neutral-500">Vibration</div>
            <div className="font-semibold mt-0.5">
              {latestReading?.dynamic_g_peak !== null &&
              latestReading?.dynamic_g_peak !== undefined
                ? `${Number(latestReading.dynamic_g_peak).toFixed(3)} g`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">X (m/s²)</div>
            <div className="font-semibold mt-0.5">
              {latestReading?.ax !== null && latestReading?.ax !== undefined
                ? Number(latestReading.ax).toFixed(3)
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Y (m/s²)</div>
            <div className="font-semibold mt-0.5">
              {latestReading?.ay !== null && latestReading?.ay !== undefined
                ? Number(latestReading.ay).toFixed(3)
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Z (m/s²)</div>
            <div className="font-semibold mt-0.5">
              {latestReading?.az !== null && latestReading?.az !== undefined
                ? Number(latestReading.az).toFixed(3)
                : "—"}
            </div>
          </div>
        </div>
      </Card>

      {/* Statistics for the selected range */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <StatCard
          label="Mean vibration"
          value={
            typeof stats.mean === "number"
              ? `${Number(stats.mean).toFixed(3)} g`
              : "—"
          }
        />
        <StatCard
          label="Peak vibration"
          value={
            typeof stats.peak === "number"
              ? `${Number(stats.peak).toFixed(3)} g`
              : "—"
          }
        />
        <StatCard
          label="95th percentile"
          value={
            typeof stats.p95 === "number"
              ? `${Number(stats.p95).toFixed(3)} g`
              : "—"
          }
        />
        <StatCard
          label="Threshold crossings"
          value={String(stats.crossings ?? 0)}
        />
        <StatCard
          label="Feeds triggered"
          value={String(stats.feedsTriggered ?? 0)}
        />
      </div>

      {/* Phone sensor card */}
      <Card>
        <SectionHeader
          title="Phone sensor"
          description="Use a smartphone accelerometer over HTTPS to simulate vibration triggers."
          action={
            <Link href="/sensor">
              <Button variant="secondary" size="sm">
                Open phone sensor
              </Button>
            </Link>
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm tabular-nums">
          <div>
            <div className="text-xs text-neutral-500">Status</div>
            <div className="mt-1">
              <StatusDot
                tone={phoneSource?.enabled ? "active" : "neutral"}
                label={
                  phoneSource?.enabled ? "Feeding enabled" : "Turned off in Feeding settings"
                }
              />
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Settings</div>
            <div className="mt-1">
              {phoneSource?.portions_per_trigger ?? 1} portion(s) · threshold{" "}
              {Number(phoneSource?.threshold_g ?? 0.3).toFixed(2)} g
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Last phone trigger</div>
            <div className="mt-1 text-xs text-neutral-500">
              {lastPhoneFeed
                ? `${formatDateTimeMYT(lastPhoneFeed.created_at)} (${lastPhoneFeed.result === "FED" ? "Fed" : lastPhoneFeed.result})`
                : "None recorded"}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

