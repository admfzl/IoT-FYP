"use client";

import React, { useEffect, useState } from "react";
import { Cpu, Radio, Wifi, ExternalLink } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  XAxis,
  ReferenceLine,
  CartesianGrid,
  Tooltip
} from "recharts";
import type {
  Esp32TelemetryHistoryPoint,
  Esp32TelemetryReading
} from "@/lib/esp32-telemetry";

interface Esp32TelemetryState {
  online: boolean;
  latest: Esp32TelemetryReading | null;
  history: Esp32TelemetryHistoryPoint[];
}

export function Esp32MonitorCard({
  initialTelemetry
}: {
  initialTelemetry?: Esp32TelemetryState;
}) {
  const [telemetry, setTelemetry] = useState<Esp32TelemetryState | null>(
    initialTelemetry ?? null
  );

  useEffect(() => {
    if (initialTelemetry) {
      setTelemetry(initialTelemetry);
    }
  }, [initialTelemetry]);

  // Poll /api/esp32/telemetry every 1s for smooth real-time sensor updates
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/esp32/telemetry", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Esp32TelemetryState;
        if (active) {
          setTelemetry(data);
        }
      } catch {
        // Ignore transient network errors
      }
    };
    const interval = setInterval(poll, 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const latest = telemetry?.latest ?? null;
  const online = Boolean(telemetry?.online && latest);
  const history = telemetry?.history ?? [];
  const thresholdG = latest?.thresholdG ?? 0.3;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                ESP32-S3 + ADXL345 Live Sensor Stream
              </h2>
              {online ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                  <Radio className="w-3 h-3 animate-pulse" />
                  ONLINE
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 dark:bg-slate-800 text-slate-500">
                  WAITING FOR ESP32
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Pushes live 3-axis acceleration &amp; dynamic wave vibration (<code className="font-mono">POST /api/esp32/telemetry</code>) and fires <code className="font-mono">ESP32_SENSOR</code> feed triggers (<code className="font-mono">POST /api/feed</code> + <code className="font-mono">/api/feed/rtt</code>).
            </p>
          </div>
        </div>

        {latest?.espIp && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <a
              href={`http://${latest.espIp}/`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono font-semibold hover:bg-emerald-500/20 transition"
            >
              <Wifi className="w-3.5 h-3.5" />
              ESP32 UI ({latest.espIp})
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>

      {!latest ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-4 text-xs text-slate-500 dark:text-slate-400 space-y-1.5">
          <p className="font-semibold text-slate-700 dark:text-slate-300">
            No telemetry received from the ESP32 in this server session yet.
          </p>
          <p>
            1. Flash the updated <code className="font-mono">arduino.ino</code> to your ESP32-S3 (make sure Arduino Serial Monitor shows <code className="font-mono">WiFi connected!</code>).
          </p>
          <p>
            2. <code className="font-mono">arduino.ino</code> is configured to send data directly to <code className="font-mono">https://iot-fyp.adam1410faizal.workers.dev</code> (or you can switch between Cloudflare and localhost anytime from the ESP32&apos;s web UI).
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3 border border-slate-200 dark:border-slate-800">
              <div className="text-[11px] text-slate-500">
                Dynamic Vib (g)
              </div>
              <div
                className={`text-xl font-bold font-mono mt-0.5 ${latest.dynamicG >= latest.thresholdG
                    ? "text-rose-500"
                    : "text-emerald-500"
                  }`}
              >
                {latest.dynamicG.toFixed(3)} g
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Thr: {latest.thresholdG.toFixed(2)} g
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3 border border-slate-200 dark:border-slate-800">
              <div className="text-[11px] text-slate-500">X-Axis</div>
              <div className="text-xl font-bold font-mono mt-0.5 text-sky-500">
                {latest.x.toFixed(3)}
              </div>
              <div className="text-[10px] text-slate-400">m/s²</div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3 border border-slate-200 dark:border-slate-800">
              <div className="text-[11px] text-slate-500">Y-Axis</div>
              <div className="text-xl font-bold font-mono mt-0.5 text-sky-500">
                {latest.y.toFixed(3)}
              </div>
              <div className="text-[10px] text-slate-400">m/s²</div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3 border border-slate-200 dark:border-slate-800">
              <div className="text-[11px] text-slate-500">Z-Axis</div>
              <div className="text-xl font-bold font-mono mt-0.5 text-sky-500">
                {latest.z.toFixed(3)}
              </div>
              <div className="text-[10px] text-slate-400">m/s²</div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3 border border-slate-200 dark:border-slate-800">
              <div className="text-[11px] text-slate-500">ESP32 Status</div>
              <div className="text-xs font-bold font-mono mt-1 truncate">
                {latest.autoTrigger ? (
                  <span className="text-emerald-500">Auto-Trigger ON</span>
                ) : (
                  <span className="text-amber-500">Auto-Trigger PAUSED</span>
                )}
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                tag: {latest.runLabel} • {latest.rssi} dBm
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3 border border-slate-200 dark:border-slate-800">
              <div className="text-[11px] text-slate-500">Last ESP32 Trigger</div>
              <div className="text-xs font-bold font-mono mt-1 text-purple-400 truncate">
                {latest.lastTriggerRttMs !== null
                  ? `RTT: ${latest.lastTriggerRttMs} ms`
                  : "None yet"}
              </div>
              <div
                className="text-[10px] text-slate-400 font-mono mt-0.5 truncate"
                title={latest.lastTriggerStatus}
              >
                {latest.lastTriggerStatus}
              </div>
            </div>
          </div>

          {history.length > 1 && (
            <div className="h-44 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={history}
                  margin={{ top: 8, right: 16, left: -10, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(148, 163, 184, 0.2)"
                  />
                  <XAxis dataKey="t" hide />
                  <YAxis
                    domain={[
                      0,
                      Math.max(0.6, Math.ceil(thresholdG * 1.5 * 10) / 10)
                    ]}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${v}g`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      color: "#f8fafc",
                      fontSize: "12px",
                      borderRadius: "8px"
                    }}
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
                    name="Dynamic Vibration (g)"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}

