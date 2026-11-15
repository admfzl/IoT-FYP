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
  StatusDot,
  Switch
} from "@/components/ui";
import { LiveChart } from "@/components/charts";
import { useDashboardAuth } from "@/components/TokenGate";
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

const THRESHOLD_PRESETS = [
  { label: "Sensitive (0.10 g)", value: 0.1 },
  { label: "Light (0.20 g)", value: 0.2 },
  { label: "Default (0.30 g)", value: 0.3 },
  { label: "Moderate (0.50 g)", value: 0.5 },
  { label: "Firm (1.00 g)", value: 1.0 }
];

export default function SensorsPage() {
  const { token } = useDashboardAuth();
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

  // ADXL345 (ESP32_SENSOR) configuration form state
  const [draftEnabled, setDraftEnabled] = useState<boolean>(false);
  const [draftThresholdG, setDraftThresholdG] = useState<string>("0.30");
  const [draftCooldownSec, setDraftCooldownSec] = useState<string>("5");
  const [draftPortions, setDraftPortions] = useState<string>("1");
  const [configDirty, setConfigDirty] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState<{
    text: string;
    critical: boolean;
  } | null>(null);
  const configDirtyRef = useRef(false);

  const lastIdRef = useRef<number>(0);

  const syncFormFromEspSource = useCallback((src: TriggerSourceRow | null) => {
    if (!src || configDirtyRef.current) return;
    setDraftEnabled(Boolean(src.enabled));
    setDraftThresholdG(Number(src.threshold_g ?? 0.3).toFixed(2));
    setDraftCooldownSec(String(src.cooldown_seconds ?? 5));
    setDraftPortions(String(src.portions_per_trigger ?? 1));
  }, []);

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
      syncFormFromEspSource(json.espSource);
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
  }, [rangeWindow, windowDurationMs, syncFormFromEspSource]);

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
        if (json.espSource) {
          setEspSource(json.espSource);
          syncFormFromEspSource(json.espSource);
        }
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
  const savedThresholdG = Number(espSource?.threshold_g ?? 0.3);
  const parsedDraftThreshold = Number(draftThresholdG);
  const previewThresholdG =
    Number.isFinite(parsedDraftThreshold) &&
    parsedDraftThreshold >= 0.01 &&
    parsedDraftThreshold <= 16
      ? parsedDraftThreshold
      : savedThresholdG;

  const markDirty = () => {
    configDirtyRef.current = true;
    setConfigDirty(true);
    setConfigMsg(null);
  };

  const handleToggleEspEnabled = async (nextEnabled: boolean) => {
    setDraftEnabled(nextEnabled);
    setConfigMsg(null);
    try {
      const res = await fetch("/api/trigger-sources/ESP32_SENSOR", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: JSON.stringify({ enabled: nextEnabled })
      });
      const json = await res.json();
      if (!res.ok) {
        setConfigMsg({
          text: json.error ?? "Failed to update sensor status.",
          critical: true
        });
        setDraftEnabled(Boolean(espSource?.enabled));
        return;
      }
      if (json.source) {
        setEspSource(json.source as TriggerSourceRow);
      }
      setConfigMsg({
        text: nextEnabled
          ? "ADXL345 feeding enabled."
          : "ADXL345 feeding disabled.",
        critical: false
      });
    } catch (err) {
      setConfigMsg({
        text: err instanceof Error ? err.message : "Network error",
        critical: true
      });
      setDraftEnabled(Boolean(espSource?.enabled));
    }
  };

  const handleSaveEspConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const thr = Number(draftThresholdG);
    const cd = Number(draftCooldownSec);
    const portions = Number(draftPortions);

    if (!Number.isFinite(thr) || thr < 0.01 || thr > 16) {
      setConfigMsg({
        text: "Vibration threshold must be between 0.01 g and 16.00 g.",
        critical: true
      });
      return;
    }
    if (!Number.isInteger(cd) || cd < 0 || cd > 86_400) {
      setConfigMsg({
        text: "Cooldown must be an integer between 0 and 86400 seconds.",
        critical: true
      });
      return;
    }
    if (!Number.isInteger(portions) || portions < 1 || portions > 20) {
      setConfigMsg({
        text: "Portions per trigger must be between 1 and 20.",
        critical: true
      });
      return;
    }

    setSavingConfig(true);
    setConfigMsg(null);
    try {
      const res = await fetch("/api/trigger-sources/ESP32_SENSOR", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: JSON.stringify({
          enabled: draftEnabled,
          threshold_g: Math.round(thr * 1000) / 1000,
          cooldown_seconds: cd,
          portions_per_trigger: portions
        })
      });
      const json = await res.json();
      if (!res.ok) {
        setConfigMsg({
          text: json.error ?? "Failed to save ADXL345 thresholds.",
          critical: true
        });
        return;
      }
      configDirtyRef.current = false;
      setConfigDirty(false);
      if (json.source) {
        const updated = json.source as TriggerSourceRow;
        setEspSource(updated);
        setDraftThresholdG(Number(updated.threshold_g ?? thr).toFixed(2));
        setDraftCooldownSec(String(updated.cooldown_seconds ?? cd));
        setDraftPortions(String(updated.portions_per_trigger ?? portions));
        setDraftEnabled(Boolean(updated.enabled));
      }
      setConfigMsg({
        text: `Saved · ${thr.toFixed(2)} g threshold, ${cd} s cooldown, ${portions} portion(s) synced to ESP32.`,
        critical: false
      });
      await fetchFullWindow();
    } catch (err) {
      setConfigMsg({
        text: err instanceof Error ? err.message : "Network error",
        critical: true
      });
    } finally {
      setSavingConfig(false);
    }
  };

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
            thresholdG={previewThresholdG}
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

      {/* ADXL345 (ESP32_SENSOR) Threshold & Trigger Configuration */}
      <Card className="space-y-4">
        <SectionHeader
          title="ADXL345 sensor threshold & trigger configuration"
          description="Configure the gravity-removed dynamic vibration threshold (g), cooldown, and portion count for the ESP32-S3 + ADXL345 sensor. Changes sync to the ESP32 on the next telemetry heartbeat."
          action={
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">
                {draftEnabled ? "Feeding enabled" : "Feeding disabled"}
              </span>
              <Switch
                checked={draftEnabled}
                onChange={handleToggleEspEnabled}
                label="Enable ADXL345 sensor feeding"
              />
            </div>
          }
        />

        <form onSubmit={handleSaveEspConfig} className="space-y-4">
          {/* Quick threshold presets */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500 mr-1">
              Threshold presets:
            </span>
            {THRESHOLD_PRESETS.map((p) => {
              const active = Math.abs(previewThresholdG - p.value) < 0.005;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => {
                    markDirty();
                    setDraftThresholdG(p.value.toFixed(2));
                  }}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors tabular-nums ${
                    active
                      ? "bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:border-neutral-100 font-medium"
                      : "border-neutral-300 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
            {typeof stats.p95 === "number" && stats.p95 > 0 && (
              <button
                type="button"
                onClick={() => {
                  const suggested = Math.min(
                    16,
                    Math.max(0.05, Math.round(Number(stats.p95) * 1.25 * 100) / 100)
                  );
                  markDirty();
                  setDraftThresholdG(suggested.toFixed(2));
                }}
                className="px-2.5 py-1 text-xs rounded-md border border-neutral-300 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900 tabular-nums"
              >
                1.25× 95th percentile (
                {Math.min(
                  16,
                  Math.max(0.05, Math.round(Number(stats.p95) * 1.25 * 100) / 100)
                ).toFixed(2)}{" "}
                g)
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
            {/* Threshold slider + numeric input */}
            <div className="sm:col-span-2 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="adxl-threshold-input"
                  className="text-xs text-neutral-500"
                >
                  Vibration trigger threshold (g)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="adxl-threshold-input"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="16"
                    value={draftThresholdG}
                    onChange={(e) => {
                      markDirty();
                      setDraftThresholdG(e.target.value);
                    }}
                    className="h-8 w-24 rounded-md border border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2 text-right text-sm font-medium tabular-nums"
                  />
                  <span className="text-xs text-neutral-500">g</span>
                </div>
              </div>
              <input
                type="range"
                min="0.05"
                max="2.00"
                step="0.01"
                value={Math.min(2.0, Math.max(0.05, previewThresholdG))}
                onChange={(e) => {
                  markDirty();
                  setDraftThresholdG(Number(e.target.value).toFixed(2));
                }}
                aria-label="Vibration trigger threshold slider"
                className="w-full accent-neutral-900 dark:accent-neutral-100"
              />
              <div className="flex justify-between text-[11px] text-neutral-400 tabular-nums">
                <span>0.05 g (high sensitivity)</span>
                <span>Active: {savedThresholdG.toFixed(2)} g</span>
                <span>2.00 g (low sensitivity)</span>
              </div>
            </div>

            {/* Cooldown seconds */}
            <div>
              <label
                htmlFor="adxl-cooldown-input"
                className="block text-xs text-neutral-500 mb-1"
              >
                Cooldown between triggers (s)
              </label>
              <input
                id="adxl-cooldown-input"
                type="number"
                min={0}
                max={3600}
                step={1}
                value={draftCooldownSec}
                onChange={(e) => {
                  markDirty();
                  setDraftCooldownSec(e.target.value);
                }}
                className="h-9 w-full rounded-md border border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-sm tabular-nums"
              />
            </div>

            {/* Portions per trigger */}
            <div>
              <label
                htmlFor="adxl-portions-input"
                className="block text-xs text-neutral-500 mb-1"
              >
                Portions per trigger
              </label>
              <input
                id="adxl-portions-input"
                type="number"
                min={1}
                max={20}
                step={1}
                value={draftPortions}
                onChange={(e) => {
                  markDirty();
                  setDraftPortions(e.target.value);
                }}
                className="h-9 w-full rounded-md border border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" size="sm" disabled={savingConfig}>
              {savingConfig ? "Saving..." : "Save ADXL345 thresholds"}
            </Button>
            {configDirty && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  configDirtyRef.current = false;
                  setConfigDirty(false);
                  setConfigMsg(null);
                  syncFormFromEspSource(espSource);
                }}
              >
                Reset
              </Button>
            )}
            {configMsg && (
              <span
                className={`text-xs tabular-nums ${
                  configMsg.critical
                    ? "text-red-600 dark:text-red-500 font-medium"
                    : "text-neutral-600 dark:text-neutral-400"
                }`}
              >
                {configMsg.text}
              </span>
            )}
          </div>
        </form>
      </Card>

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

