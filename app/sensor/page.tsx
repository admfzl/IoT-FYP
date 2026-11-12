"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Play,
  ShieldAlert,
  Smartphone,
  Square,
  Sun
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  XAxis,
  ReferenceLine,
  CartesianGrid
} from "recharts";
import { TokenGate, TokenStatusButton } from "@/components/TokenGate";

interface MotionSample {
  t: string;
  dynamicG: number;
}

interface TriggerLogEntry {
  id: string;
  time: string;
  vibrationG: number;
  clientRttMs: number | null;
  serverTotalMs: number | null;
  tuyaApiMs: number | null;
  status: "OK" | "COOLDOWN" | "ERROR";
  detail: string;
}

// iOS 13+ DeviceMotionEvent permission typing
interface DeviceMotionEventWithPermission extends DeviceMotionEvent {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export default function SensorPage() {
  return (
    <TokenGate>
      {(token, clearToken) => (
        <SensorContent token={token} onClearToken={clearToken} />
      )}
    </TokenGate>
  );
}

function SensorContent({
  token,
  onClearToken
}: {
  token: string;
  onClearToken: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [thresholdG, setThresholdG] = useState(0.3);
  const [runLabel, setRunLabel] = useState("phone-wifi");
  const [dynamicG, setDynamicG] = useState(0);
  const [rawTotalG, setRawTotalG] = useState(0);
  const [samples, setSamples] = useState<MotionSample[]>([]);
  const [triggers, setTriggers] = useState<TriggerLogEntry[]>([]);
  const [sensorStatus, setSensorStatus] = useState<string>(
    "Idle — press Start Sensor to begin listening to device motion."
  );
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [cooldownRemainingMs, setCooldownRemainingMs] = useState(0);

  // Refs used inside high-frequency devicemotion listener
  const thresholdRef = useRef(thresholdG);
  const runLabelRef = useRef(runLabel);
  const tokenRef = useRef(token);
  const lastTriggerTimeRef = useRef(0);
  const inFlightRef = useRef(false);
  const gravityRef = useRef({ x: 0, y: 0, z: 0, initialized: false });
  const lastSampleUiUpdateRef = useRef(0);
  const wakeLockSentinelRef = useRef<WakeLockSentinel | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    thresholdRef.current = thresholdG;
  }, [thresholdG]);

  useEffect(() => {
    runLabelRef.current = runLabel;
  }, [runLabel]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // Update local cooldown countdown badge
  useEffect(() => {
    const timer = setInterval(() => {
      const elapsed = Date.now() - lastTriggerTimeRef.current;
      const rem = Math.max(0, 5000 - elapsed);
      setCooldownRemainingMs(rem);
    }, 200);
    return () => clearInterval(timer);
  }, []);

  // Wake Lock management
  const acquireWakeLock = useCallback(async () => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return;
    }
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      wakeLockSentinelRef.current = sentinel;
      setWakeLockActive(true);
      sentinel.addEventListener("release", () => {
        setWakeLockActive(false);
      });
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockSentinelRef.current) {
      try {
        await wakeLockSentinelRef.current.release();
      } catch {
        // Ignore release errors
      }
      wakeLockSentinelRef.current = null;
      setWakeLockActive(false);
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        runningRef.current
      ) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [acquireWakeLock]);

  const firePhoneTrigger = useCallback(async (measuredG: number) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    lastTriggerTimeRef.current = Date.now();

    const roundedG = Math.round(measuredG * 1000) / 1000;
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const triggerTimeStr = new Date().toLocaleTimeString();

    try {
      const t0 = performance.now();
      const res = await fetch("/api/feed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": tokenRef.current
        },
        body: JSON.stringify({
          source: "PHONE_SENSOR",
          vibrationG: roundedG,
          runLabel: runLabelRef.current.trim() || undefined
        })
      });
      const t1 = performance.now();
      const clientRttMs = Math.max(1, Math.round(t1 - t0));
      const payload = await res.json();

      if (res.status === 429) {
        setTriggers((prev) => [
          {
            id: entryId,
            time: triggerTimeStr,
            vibrationG: roundedG,
            clientRttMs,
            serverTotalMs: null,
            tuyaApiMs: null,
            status: "COOLDOWN",
            detail: `cooldown (retry in ${
              payload.retryAfterMs ?? 5000
            } ms)`
          },
          ...prev.slice(0, 29)
        ]);
        return;
      }

      if (payload.logId) {
        await fetch("/api/feed/rtt", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-feed-token": tokenRef.current
          },
          body: JSON.stringify({
            logId: payload.logId,
            clientRttMs
          })
        });
      }

      if (!res.ok || !payload.success) {
        setTriggers((prev) => [
          {
            id: entryId,
            time: triggerTimeStr,
            vibrationG: roundedG,
            clientRttMs,
            serverTotalMs: payload.serverTotalMs ?? null,
            tuyaApiMs: payload.tuyaApiMs ?? null,
            status: "ERROR",
            detail: payload.error ?? `HTTP ${res.status}`
          },
          ...prev.slice(0, 29)
        ]);
      } else {
        setTriggers((prev) => [
          {
            id: entryId,
            time: triggerTimeStr,
            vibrationG: roundedG,
            clientRttMs,
            serverTotalMs: payload.serverTotalMs ?? null,
            tuyaApiMs: payload.tuyaApiMs ?? null,
            status: "OK",
            detail: `Log #${payload.logId} (${payload.dataOrigin})`
          },
          ...prev.slice(0, 29)
        ]);
      }
    } catch (err) {
      setTriggers((prev) => [
        {
          id: entryId,
          time: triggerTimeStr,
          vibrationG: roundedG,
          clientRttMs: null,
          serverTotalMs: null,
          tuyaApiMs: null,
          status: "ERROR",
          detail: err instanceof Error ? err.message : "Network error"
        },
        ...prev.slice(0, 29)
      ]);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const handleMotionEvent = useCallback(
    (event: DeviceMotionEvent) => {
      let linX = 0;
      let linY = 0;
      let linZ = 0;
      let hasReading = false;

      const rawAcc = event.accelerationIncludingGravity;
      if (
        rawAcc &&
        rawAcc.x !== null &&
        rawAcc.y !== null &&
        rawAcc.z !== null
      ) {
        const rx = rawAcc.x;
        const ry = rawAcc.y;
        const rz = rawAcc.z;
        const rawG = Math.sqrt(rx * rx + ry * ry + rz * rz) / 9.81;
        setRawTotalG(Math.round(rawG * 100) / 100);
      }

      // §9.2: Prefer event.acceleration (x, y, z in m/s²) when non-null
      if (
        event.acceleration &&
        event.acceleration.x !== null &&
        event.acceleration.y !== null &&
        event.acceleration.z !== null
      ) {
        linX = event.acceleration.x;
        linY = event.acceleration.y;
        linZ = event.acceleration.z;
        hasReading = true;
      } else if (
        rawAcc &&
        rawAcc.x !== null &&
        rawAcc.y !== null &&
        rawAcc.z !== null
      ) {
        // Fallback: low-pass gravity estimate: gravity = 0.9*gravity + 0.1*raw, linear = raw - gravity
        const g = gravityRef.current;
        if (!g.initialized) {
          g.x = rawAcc.x;
          g.y = rawAcc.y;
          g.z = rawAcc.z;
          g.initialized = true;
        } else {
          g.x = 0.9 * g.x + 0.1 * rawAcc.x;
          g.y = 0.9 * g.y + 0.1 * rawAcc.y;
          g.z = 0.9 * g.z + 0.1 * rawAcc.z;
        }
        linX = rawAcc.x - g.x;
        linY = rawAcc.y - g.y;
        linZ = rawAcc.z - g.z;
        hasReading = true;
      }

      if (!hasReading) {
        setSensorStatus(
          "Unsupported device: accelerometer returned null coordinates. Open this page over HTTPS on a smartphone."
        );
        return;
      }

      const dynG = Math.sqrt(linX * linX + linY * linY + linZ * linZ) / 9.81;
      const roundedDynG = Math.round(dynG * 1000) / 1000;

      const now = Date.now();
      // Update chart & numeric UI at ~10 Hz (every 100 ms) so last ~10s = 100 points
      if (now - lastSampleUiUpdateRef.current >= 100) {
        lastSampleUiUpdateRef.current = now;
        setDynamicG(roundedDynG);
        setSamples((prev) => {
          const next = [
            ...prev,
            {
              t: new Date(now).toLocaleTimeString(),
              dynamicG: roundedDynG
            }
          ];
          return next.length > 100 ? next.slice(next.length - 100) : next;
        });
      }

      // Check threshold & local 5-second cooldown
      if (
        dynG >= thresholdRef.current &&
        now - lastTriggerTimeRef.current >= 5000 &&
        !inFlightRef.current
      ) {
        firePhoneTrigger(dynG);
      }
    },
    [firePhoneTrigger]
  );

  // §9.2: Inside click handler (required for iOS): requestPermission -> add devicemotion listener
  const handleStartSensor = async () => {
    if (typeof window === "undefined") return;

    if (
      window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      setSensorStatus(
        "Error: DeviceMotion requires a secure HTTPS context (e.g. your *.workers.dev URL)."
      );
      return;
    }

    if (typeof window.DeviceMotionEvent === "undefined") {
      setSensorStatus(
        "Unsupported device: DeviceMotionEvent API is not available in this browser."
      );
      return;
    }

    const DM =
      window.DeviceMotionEvent as unknown as DeviceMotionEventWithPermission;
    if (typeof DM.requestPermission === "function") {
      try {
        const permState = await DM.requestPermission();
        if (permState !== "granted") {
          setSensorStatus(
            "Permission denied: iOS motion & orientation access was rejected. Reload the page to request again."
          );
          return;
        }
      } catch (err) {
        setSensorStatus(
          `Failed to request iOS motion permission: ${
            err instanceof Error ? err.message : "unknown error"
          }`
        );
        return;
      }
    }

    gravityRef.current = { x: 0, y: 0, z: 0, initialized: false };
    window.addEventListener("devicemotion", handleMotionEvent);
    runningRef.current = true;
    setRunning(true);
    setSensorStatus("Sensor active — shake or tilt phone to simulate wave input.");
    await acquireWakeLock();
  };

  const handleStopSensor = useCallback(async () => {
    window.removeEventListener("devicemotion", handleMotionEvent);
    runningRef.current = false;
    setRunning(false);
    setSensorStatus("Sensor stopped.");
    await releaseWakeLock();
  }, [handleMotionEvent, releaseWakeLock]);

  useEffect(() => {
    return () => {
      window.removeEventListener("devicemotion", handleMotionEvent);
      releaseWakeLock();
    };
  }, [handleMotionEvent, releaseWakeLock]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title="Back to Dashboard"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-lg sm:text-xl font-bold">
                Phone Motion Trigger (simulated wave input)
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Simulates the ESP32 accelerometer webhook over HTTPS; not claimed as a validated wave detector.
              </p>
            </div>
          </div>

          <TokenStatusButton onClear={onClearToken} />
        </header>

        {/* Sensor Control & Status Card */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-purple-500" />
              <span className="text-sm font-semibold">{sensorStatus}</span>
            </div>

            <div className="flex items-center gap-2">
              {wakeLockActive && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 text-xs font-medium">
                  <Sun className="w-3.5 h-3.5" />
                  Wake Lock On
                </span>
              )}
              {cooldownRemainingMs > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-400 text-xs font-mono font-bold">
                  Cooldown: {(cooldownRemainingMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!running ? (
              <button
                type="button"
                onClick={handleStartSensor}
                className="w-full py-3 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4" />
                Start Sensor
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopSensor}
                className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
              >
                <Square className="w-4 h-4" />
                Stop Sensor
              </button>
            )}

            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                Experiment <code className="font-mono">run_label</code>
              </label>
              <input
                type="text"
                value={runLabel}
                onChange={(e) => setRunLabel(e.target.value)}
                placeholder="phone-wifi"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
              />
            </div>
          </div>

          {/* Live Readout & Threshold Slider */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3 border border-slate-200 dark:border-slate-800">
              <div className="text-[11px] text-slate-500">
                Dynamic Accel (gravity removed)
              </div>
              <div
                className={`text-2xl font-bold font-mono mt-0.5 ${
                  dynamicG >= thresholdG
                    ? "text-rose-500"
                    : "text-purple-500"
                }`}
              >
                {dynamicG.toFixed(2)} g
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3 border border-slate-200 dark:border-slate-800">
              <div className="text-[11px] text-slate-500">
                Raw Total G (with gravity)
              </div>
              <div className="text-2xl font-bold font-mono mt-0.5 text-slate-600 dark:text-slate-300">
                {rawTotalG.toFixed(2)} g
              </div>
            </div>

            <div className="col-span-2 sm:col-span-1 rounded-xl bg-slate-50 dark:bg-slate-950 p-3 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Trigger Threshold</span>
                <span className="font-mono font-bold text-amber-500">
                  {thresholdG.toFixed(2)} g
                </span>
              </div>
              <input
                type="range"
                min="0.05"
                max="2.0"
                step="0.05"
                value={thresholdG}
                onChange={(e) => setThresholdG(Number(e.target.value))}
                className="w-full mt-2 accent-purple-500"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-400">
                <span>0.05g</span>
                <span>0.30g</span>
                <span>2.00g</span>
              </div>
            </div>
          </div>

          {/* Rolling 10s Chart */}
          <div className="h-48 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={samples}
                margin={{ top: 8, right: 16, left: -10, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(148, 163, 184, 0.2)"
                />
                <XAxis dataKey="t" hide />
                <YAxis
                  domain={[0, Math.max(1.0, Math.ceil(thresholdG * 1.5 * 10) / 10)]}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${v}g`}
                />
                <ReferenceLine
                  y={thresholdG}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                  label={{
                    value: `Threshold (${thresholdG.toFixed(2)}g)`,
                    position: "insideTopRight",
                    fill: "#f59e0b",
                    fontSize: 11
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="dynamicG"
                  stroke="#a855f7"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Recent Trigger Log */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-500" />
              Recent Phone Motion Triggers
            </h2>
            <span className="text-xs font-mono text-slate-500">
              {triggers.length} events
            </span>
          </div>

          {triggers.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              No triggers fired in this session yet. Start the sensor and shake your phone above{" "}
              <span className="font-mono font-semibold">
                {thresholdG.toFixed(2)} g
              </span>
              .
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 uppercase">
                  <tr>
                    <th className="py-2 px-3">Time</th>
                    <th className="py-2 px-3 text-right">Dynamic G</th>
                    <th className="py-2 px-3 text-right">Client RTT</th>
                    <th className="py-2 px-3 text-right">Server</th>
                    <th className="py-2 px-3 text-right">Tuya API</th>
                    <th className="py-2 px-3">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono">
                  {triggers.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2 px-3">{t.time}</td>
                      <td className="py-2 px-3 text-right font-semibold text-purple-400">
                        {t.vibrationG.toFixed(2)} g
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-sky-400">
                        {t.clientRttMs !== null ? `${t.clientRttMs} ms` : "—"}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {t.serverTotalMs !== null
                          ? `${t.serverTotalMs} ms`
                          : "—"}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {t.tuyaApiMs !== null ? `${t.tuyaApiMs} ms` : "—"}
                      </td>
                      <td className="py-2 px-3 font-sans">
                        {t.status === "OK" ? (
                          <span className="text-emerald-500 font-semibold">
                            OK • {t.detail}
                          </span>
                        ) : t.status === "COOLDOWN" ? (
                          <span className="text-amber-500 font-semibold">
                            429 {t.detail}
                          </span>
                        ) : (
                          <span className="text-rose-500 font-semibold flex items-center gap-1">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            {t.detail}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

