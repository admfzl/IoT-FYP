"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Database,
  Download,
  Fish,
  RefreshCw,
  RotateCcw,
  Settings,
  Smartphone,
  Sparkles,
  Trash2,
  Zap
} from "lucide-react";
import { TokenGate, TokenStatusButton } from "@/components/TokenGate";
import { LatencyCharts } from "@/components/LatencyCharts";
import { DepletionChart } from "@/components/DepletionChart";
import { FeedLogTable } from "@/components/FeedLogTable";
import { Esp32MonitorCard } from "@/components/Esp32MonitorCard";
import type { FeederState, FeedLog } from "@/lib/supabase";
import type { SourceLatencyStats } from "@/lib/stats";
import type {
  Esp32TelemetryHistoryPoint,
  Esp32TelemetryReading
} from "@/lib/esp32-telemetry";

interface StatsApiResponse {
  feederState: FeederState;
  tuyaConfigured: boolean;
  tuyaHardwareStatus?: {
    lowFoodSensorTriggered: boolean | null;
    rawStatusValue: string | null;
    reminderSwitchEnabled: boolean | null;
    updatedAtMs: number | null;
  };
  esp32Telemetry?: {
    online: boolean;
    latest: Esp32TelemetryReading | null;
    history: Esp32TelemetryHistoryPoint[];
  };
  totalLiveFeeds: number;
  includeDemo: boolean;
  logs: FeedLog[];
  chartLogs: FeedLog[];
  summaryBySource: SourceLatencyStats[];
  error?: string;
}

export default function DashboardPage() {
  return (
    <TokenGate>
      {(token, clearToken) => (
        <DashboardContent token={token} onClearToken={clearToken} />
      )}
    </TokenGate>
  );
}

function DashboardContent({
  token,
  onClearToken
}: {
  token: string;
  onClearToken: () => void;
}) {
  const [stats, setStats] = useState<StatsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDemo, setShowDemo] = useState(false);
  const [runLabel, setRunLabel] = useState("manual-wifi");
  const [feeding, setFeeding] = useState(false);
  const [actionMsg, setActionMsg] = useState<{
    type: "ok" | "err" | "warn";
    text: string;
  } | null>(null);

  // Settings form state
  const [gramsPerPortion, setGramsPerPortion] = useState("1.5");
  const [maxCapacityGrams, setMaxCapacityGrams] = useState("60.0");
  const [cooldownSeconds, setCooldownSeconds] = useState("5");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/stats${showDemo ? "?includeDemo=1" : ""}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as StatsApiResponse;
      if (!res.ok || data.error) {
        setActionMsg({
          type: "err",
          text: data.error ?? `Failed to load stats (${res.status})`
        });
        return;
      }
      setStats(data);
      if (!settingsDirty && data.feederState) {
        setGramsPerPortion(String(data.feederState.grams_per_portion));
        setMaxCapacityGrams(String(data.feederState.max_capacity_grams));
        setCooldownSeconds(String(data.feederState.cooldown_seconds));
      }
    } catch (err) {
      setActionMsg({
        type: "err",
        text: err instanceof Error ? err.message : "Network error loading stats"
      });
    } finally {
      setLoading(false);
    }
  }, [showDemo, settingsDirty]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // §7 Latency methodology for Feed Now button
  const handleFeedNow = async () => {
    if (feeding) return;
    setFeeding(true);
    setActionMsg(null);

    try {
      const t0 = performance.now();
      const res = await fetch("/api/feed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: JSON.stringify({
          source: "MANUAL_APP",
          runLabel: runLabel.trim() || undefined
        })
      });
      const t1 = performance.now();
      const clientRttMs = Math.max(1, Math.round(t1 - t0));
      const payload = await res.json();

      if (res.status === 401) {
        setActionMsg({
          type: "err",
          text: "401 Unauthorized: Invalid x-feed-token. Click 'Change Token' to update."
        });
        return;
      }

      if (res.status === 429) {
        setActionMsg({
          type: "warn",
          text: `Cooldown active (429): Please wait ${Math.ceil(
            (payload.retryAfterMs ?? 5000) / 1000
          )}s before next feed.`
        });
        return;
      }

      // Report RTT if a logId was created
      if (payload.logId) {
        await fetch("/api/feed/rtt", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-feed-token": token
          },
          body: JSON.stringify({
            logId: payload.logId,
            clientRttMs
          })
        });
      }

      if (!res.ok || !payload.success) {
        setActionMsg({
          type: "err",
          text: `Feed failed (${res.status}): ${
            payload.error ?? "Tuya Cloud error"
          } (Portion refunded)`
        });
      } else {
        setActionMsg({
          type: "ok",
          text: `Feed #${payload.logId} (${payload.dataOrigin}) acknowledged! Client RTT: ${clientRttMs} ms | Server: ${payload.serverTotalMs} ms | Tuya: ${payload.tuyaApiMs ?? "N/A"} ms`
        });
      }

      await fetchStats();
    } catch (err) {
      setActionMsg({
        type: "err",
        text: err instanceof Error ? err.message : "Failed to trigger feed"
      });
    } finally {
      setFeeding(false);
    }
  };

  const handleRefill = async () => {
    setActionMsg(null);
    try {
      const res = await fetch("/api/refill", {
        method: "POST",
        headers: { "x-feed-token": token }
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMsg({
          type: "err",
          text: data.error ?? `Refill failed (${res.status})`
        });
        return;
      }
      setActionMsg({
        type: "ok",
        text: `Hopper refilled to ${data.feederState?.remaining_grams} g.`
      });
      await fetchStats();
    } catch (err) {
      setActionMsg({
        type: "err",
        text: err instanceof Error ? err.message : "Refill request failed"
      });
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: JSON.stringify({
          grams_per_portion: Number(gramsPerPortion),
          max_capacity_grams: Number(maxCapacityGrams),
          cooldown_seconds: Number(cooldownSeconds)
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMsg({
          type: "err",
          text: data.error ?? `Failed to save settings (${res.status})`
        });
        return;
      }
      setSettingsDirty(false);
      setActionMsg({ type: "ok", text: "Feeder settings updated." });
      await fetchStats();
    } catch (err) {
      setActionMsg({
        type: "err",
        text: err instanceof Error ? err.message : "Failed to save settings"
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleToggleSimulation = async () => {
    if (!stats?.feederState) return;
    const currentSim = stats.feederState.simulation_mode;
    const nextSim = !currentSim;

    const confirmed = window.confirm(
      nextSim
        ? "Enable SIMULATION MODE? Tuya Cloud will NOT be called, and feeds will be tagged as SIMULATED (excluded from LIVE report charts)."
        : "Switch back to LIVE HARDWARE MODE? Every trigger will actuate the real MeeGoo feeder via Tuya Cloud."
    );
    if (!confirmed) return;

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: JSON.stringify({ simulation_mode: nextSim })
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMsg({
          type: "err",
          text: data.error ?? "Failed to toggle simulation mode"
        });
        return;
      }
      if (nextSim) {
        setShowDemo(true);
      }
      setActionMsg({
        type: nextSim ? "warn" : "ok",
        text: nextSim
          ? "Simulation Mode ENABLED. Feeds are now marked SIMULATED."
          : "LIVE Hardware Mode ENABLED."
      });
      await fetchStats();
    } catch (err) {
      setActionMsg({
        type: "err",
        text:
          err instanceof Error ? err.message : "Failed to toggle simulation"
      });
    }
  };

  const handleSeedDemo = async () => {
    try {
      const res = await fetch("/api/demo/seed", {
        method: "POST",
        headers: { "x-feed-token": token }
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMsg({
          type: "err",
          text: data.error ?? "Failed to seed demo data"
        });
        return;
      }
      setShowDemo(true);
      setActionMsg({
        type: "warn",
        text: `Seeded ${data.insertedCount} SEEDED rows for UI preview. ("Show demo data" enabled)`
      });
      await fetchStats();
    } catch (err) {
      setActionMsg({
        type: "err",
        text: err instanceof Error ? err.message : "Seed request failed"
      });
    }
  };

  const handleClearDemo = async () => {
    try {
      const res = await fetch("/api/demo/clear", {
        method: "POST",
        headers: { "x-feed-token": token }
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMsg({
          type: "err",
          text: data.error ?? "Failed to clear SEEDED rows"
        });
        return;
      }
      setActionMsg({
        type: "ok",
        text: `Cleared ${data.deletedCount} SEEDED rows. LIVE rows and feeder_state untouched.`
      });
      await fetchStats();
    } catch (err) {
      setActionMsg({
        type: "err",
        text: err instanceof Error ? err.message : "Clear demo request failed"
      });
    }
  };

  const state = stats?.feederState;
  const remainingGrams = state?.remaining_grams ?? 60;
  const maxCap = state?.max_capacity_grams ?? 60;
  const remainingPercent =
    maxCap > 0 ? Math.round((remainingGrams / maxCap) * 1000) / 10 : 0;
  const hwSensorTriggered =
    stats?.tuyaHardwareStatus?.lowFoodSensorTriggered === true;
  const isLowFood = remainingPercent < 20 || hwSensorTriggered;
  const isSimMode = Boolean(state?.simulation_mode);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* §2.1 Rule 3: Mandatory DEMO / SIMULATED DATA Banner */}
      {(showDemo || isSimMode) && (
        <div className="bg-amber-500 text-slate-950 px-4 py-2.5 text-center font-bold text-xs sm:text-sm tracking-wide flex items-center justify-center gap-2 shadow-md">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            DEMO / SIMULATED DATA — NOT FOR REPORT (Showing{" "}
            {showDemo ? "LIVE + SIMULATED + SEEDED rows" : "SIMULATION MODE ACTIVE"}
            )
          </span>
        </div>
      )}

      {/* §9.1 Low Food Warning Banner when < 20% or Tuya DP 6 hardware sensor triggers */}
      {isLowFood && (
        <div className="bg-rose-600 text-white px-4 py-2.5 text-center font-bold text-xs sm:text-sm flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            LOW FOOD WARNING: Hopper remaining feed is at {remainingGrams} g (
            {remainingPercent}%) • Tuya Optical Sensor (DP 6 `status`):{" "}
            {stats?.tuyaHardwareStatus?.rawStatusValue ?? "N/A"}{" "}
            {hwSensorTriggered ? "(SHORTAGE DETECTED)" : ""}
          </span>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Top Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-500 border border-sky-500/20">
              <Fish className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Smart Fish Feeder Actuation &amp; Latency Study
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                UTP FYP II • MeeGoo Smart Feeder (Tuya SG Cloud{" "}
                <code className="font-mono">a33d5216f7875b6d3er7kk</code>)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/sensor"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition shadow-sm"
            >
              <Smartphone className="w-4 h-4" />
              Phone Motion Trigger (/sensor)
            </Link>

            <a
              href="/api/export.csv"
              download="feed_logs_live.csv"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition"
            >
              <Download className="w-4 h-4" />
              Export LIVE CSV
            </a>

            <TokenStatusButton onClear={onClearToken} />
          </div>
        </header>

        {/* Action Feedback Toast */}
        {actionMsg && (
          <div
            className={`rounded-xl px-4 py-3 text-xs sm:text-sm font-medium flex items-center justify-between border ${
              actionMsg.type === "ok"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                : actionMsg.type === "warn"
                ? "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400"
                : "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
            }`}
          >
            <span>{actionMsg.text}</span>
            <button
              type="button"
              onClick={() => setActionMsg(null)}
              className="ml-4 text-xs underline opacity-75 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 4 Status Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Remaining Food */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
              <span>Remaining Hopper Feed</span>
              <Database className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono">
                {remainingGrams.toFixed(1)} g
              </span>
              <span
                className={`text-sm font-mono font-semibold ${
                  isLowFood ? "text-rose-500" : "text-emerald-500"
                }`}
              >
                ({remainingPercent}%)
              </span>
            </div>
            <div className="mt-2 w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  isLowFood ? "bg-rose-500" : "bg-emerald-500"
                }`}
                style={{
                  width: `${Math.min(100, Math.max(0, remainingPercent))}%`
                }}
              />
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
              Tuya Sensor (DP 6 <code className="font-mono">status</code>):{" "}
              {stats?.tuyaHardwareStatus?.rawStatusValue === "YES" ? (
                <span className="text-rose-500 font-bold">
                  YES (Low Food Triggered)
                </span>
              ) : stats?.tuyaHardwareStatus?.rawStatusValue === "NO" ? (
                <span className="text-emerald-500 font-semibold">
                  NO (Sufficient)
                </span>
              ) : (
                <span>—</span>
              )}
            </p>
          </div>

          {/* Card 2: Tuya Actuation Mode Badge */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
              <span>Actuation Mode</span>
              <Zap className="w-4 h-4 text-sky-500" />
            </div>
            <div className="flex items-center gap-2 mt-1">
              {isSimMode ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold tracking-wider bg-amber-500 text-slate-950">
                  SIMULATION MODE
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold tracking-wider bg-emerald-500 text-slate-950">
                  LIVE HARDWARE
                </span>
              )}
              <button
                type="button"
                onClick={handleToggleSimulation}
                className="text-xs underline text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 ml-auto"
              >
                Switch
              </button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
              Tuya Keys:{" "}
              {stats?.tuyaConfigured ? (
                <span className="text-emerald-500 font-semibold">
                  Configured
                </span>
              ) : (
                <span className="text-rose-500 font-semibold">
                  Missing in env
                </span>
              )}
            </p>
          </div>

          {/* Card 3: Last Feed Timestamp */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
              <span>Last Feed Time</span>
              <Activity className="w-4 h-4 text-purple-500" />
            </div>
            <div className="text-lg font-bold font-mono truncate">
              {state?.last_feed_at
                ? new Date(state.last_feed_at).toLocaleTimeString()
                : "Never"}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Cooldown: <span className="font-mono">{state?.cooldown_seconds ?? 5}s</span> | Portion:{" "}
              <span className="font-mono">{state?.grams_per_portion ?? 1.5}g</span>
            </p>
          </div>

          {/* Card 4: Total LIVE Feeds */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
              <span>Total LIVE Feeds</span>
              <RefreshCw
                className={`w-4 h-4 text-sky-500 ${
                  loading ? "animate-spin" : ""
                }`}
              />
            </div>
            <div className="text-2xl font-bold font-mono">
              {stats?.totalLiveFeeds ?? 0}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>Auto-refresh: 3s</span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showDemo}
                  onChange={(e) => setShowDemo(e.target.checked)}
                  className="rounded border-slate-400"
                />
                <span>Show demo data</span>
              </label>
            </div>
          </div>
        </section>

        {/* Primary Actuation Controls & Settings Panel */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Manual Trigger & Hopper Controls */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex flex-col justify-between space-y-4">
            <div>
              <h2 className="text-base font-bold">
                Manual Actuation &amp; Experiment Tagging
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pressing <strong>Feed Now</strong> records <code className="font-mono">t0 = performance.now()</code>, calls <code className="font-mono">POST /api/feed</code>, measures <code className="font-mono">client_rtt_ms</code> on response, and reports it to <code className="font-mono">POST /api/feed/rtt</code>.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Experiment <code className="font-mono">run_label</code>
                </label>
                <input
                  type="text"
                  value={runLabel}
                  onChange={(e) => setRunLabel(e.target.value)}
                  placeholder="e.g. manual-wifi"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <button
                type="button"
                disabled={feeding}
                onClick={handleFeedNow}
                className="w-full py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />
                {feeding ? "Dispensing..." : "Feed Now (1 Portion)"}
              </button>

              <button
                type="button"
                onClick={handleRefill}
                className="w-full py-2.5 px-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold text-sm transition flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Refill Hopper ({maxCap}g)
              </button>
            </div>
          </div>

          {/* Calibration & Settings Form */}
          <form
            onSubmit={handleSaveSettings}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Settings className="w-4 h-4 text-slate-400" />
                Calibration &amp; Cooldown
              </h2>
              <button
                type="submit"
                disabled={savingSettings}
                className="px-3 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {savingSettings ? "Saving..." : "Save"}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  Portion (g)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  value={gramsPerPortion}
                  onChange={(e) => {
                    setGramsPerPortion(e.target.value);
                    setSettingsDirty(true);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  Max Cap (g)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  value={maxCapacityGrams}
                  onChange={(e) => {
                    setMaxCapacityGrams(e.target.value);
                    setSettingsDirty(true);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  Cooldown (s)
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={cooldownSeconds}
                  onChange={(e) => {
                    setCooldownSeconds(e.target.value);
                    setSettingsDirty(true);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
                />
              </div>
            </div>
          </form>
        </section>

        {/* ESP32-S3 + ADXL345 Live Sensor Stream */}
        <Esp32MonitorCard initialTelemetry={stats?.esp32Telemetry} />

        {/* Chart 1 & Latency Summary Table */}
        <LatencyCharts
          chartLogs={stats?.chartLogs ?? []}
          summaryBySource={stats?.summaryBySource ?? []}
        />

        {/* Chart 2 — Feeder Quantity Remaining */}
        <DepletionChart
          chartLogs={stats?.chartLogs ?? []}
          maxCapacityGrams={maxCap}
        />

        {/* Latest 50 Feed Logs Table */}
        <FeedLogTable logs={stats?.logs ?? []} />

        {/* Collapsed Developer Section for Demo Seed / Clear */}
        <details className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-600 dark:text-slate-400 select-none">
            Developer Tools (UI Demo Seed / Clear — Never touches LIVE rows)
          </summary>
          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSeedDemo}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/15 text-purple-400 border border-purple-500/30 hover:bg-purple-600/25 font-medium"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Seed 12 Demo Rows (data_origin=SEEDED)
            </button>
            <button
              type="button"
              onClick={handleClearDemo}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/15 text-rose-400 border border-rose-500/30 hover:bg-rose-600/25 font-medium"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear SEEDED Demo Rows
            </button>
            <span className="text-slate-500">
              Note: Demo rows are only shown when &quot;Show demo data&quot; is checked.
            </span>
          </div>
        </details>
      </div>
    </div>
  );
}

