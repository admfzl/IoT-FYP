"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  Input,
  SectionHeader,
  StatusDot,
  Table,
  Td,
  THead,
  Th
} from "@/components/ui";
import { LiveChart, type LiveVibrationPoint } from "@/components/charts";
import { TokenGate } from "@/components/TokenGate";
import type { TriggerSourceRow } from "@/lib/supabase-server";

interface TriggerLogEntry {
  id: string;
  time: string;
  vibrationG: number;
  portions: number;
  clientRttMs: number | null;
  serverTotalMs: number | null;
  tuyaApiMs: number | null;
  status: "OK" | "COOLDOWN" | "SKIPPED" | "ERROR";
  detail: string;
}

interface DeviceMotionEventWithPermission extends DeviceMotionEvent {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export default function PhoneSensorPage() {
  return (
    <TokenGate>
      {(token) => <PhoneSensorContent token={token} />}
    </TokenGate>
  );
}

function PhoneSensorContent({ token }: { token: string }) {
  const [running, setRunning] = useState(false);
  const [thresholdG, setThresholdG] = useState(0.3);
  const [testLabel, setTestLabel] = useState("phone-wifi");
  const [dynamicG, setDynamicG] = useState(0);
  const [samples, setSamples] = useState<LiveVibrationPoint[]>([]);
  const [triggers, setTriggers] = useState<TriggerLogEntry[]>([]);
  const [sensorStatus, setSensorStatus] = useState<string>(
    "Ready. Press Start to begin reading phone motion."
  );
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [cooldownRemainingMs, setCooldownRemainingMs] = useState(0);

  // Server source settings for PHONE_SENSOR
  const [sourceEnabled, setSourceEnabled] = useState(true);
  const [portionsPerTrigger, setPortionsPerTrigger] = useState(1);
  const [cooldownSeconds, setCooldownSeconds] = useState(5);

  const thresholdRef = useRef(thresholdG);
  const testLabelRef = useRef(testLabel);
  const tokenRef = useRef(token);
  const cooldownMsRef = useRef(5000);
  const sourceEnabledRef = useRef(true);
  const lastTriggerTimeRef = useRef(0);
  const inFlightRef = useRef(false);
  const gravityRef = useRef({ x: 0, y: 0, z: 0, initialized: false });
  const lastSampleUiUpdateRef = useRef(0);
  const wakeLockSentinelRef = useRef<WakeLockSentinel | null>(null);
  const runningRef = useRef(false);

  // Load PHONE_SENSOR configuration from server
  const loadPhoneConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/trigger-sources", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const list = (json.sources ?? []) as TriggerSourceRow[];
      const phone = list.find((s) => s.source === "PHONE_SENSOR");
      if (phone) {
        setSourceEnabled(phone.enabled);
        sourceEnabledRef.current = phone.enabled;
        setPortionsPerTrigger(phone.portions_per_trigger ?? 1);
        const cdSec = phone.cooldown_seconds ?? 5;
        setCooldownSeconds(cdSec);
        cooldownMsRef.current = cdSec * 1000;
        if (phone.threshold_g !== null && phone.threshold_g !== undefined) {
          const t = Number(phone.threshold_g);
          if (Number.isFinite(t) && t > 0) {
            setThresholdG(t);
            thresholdRef.current = t;
          }
        }
      }
    } catch {
      // ignore network error
    }
  }, []);

  useEffect(() => {
    loadPhoneConfig();
  }, [loadPhoneConfig]);

  useEffect(() => {
    thresholdRef.current = thresholdG;
  }, [thresholdG]);

  useEffect(() => {
    testLabelRef.current = testLabel;
  }, [testLabel]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    const timer = setInterval(() => {
      const elapsed = Date.now() - lastTriggerTimeRef.current;
      const rem = Math.max(0, cooldownMsRef.current - elapsed);
      setCooldownRemainingMs(rem);
    }, 200);
    return () => clearInterval(timer);
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      wakeLockSentinelRef.current = sentinel;
      setWakeLockActive(true);
      sentinel.addEventListener("release", () => setWakeLockActive(false));
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockSentinelRef.current) {
      try {
        await wakeLockSentinelRef.current.release();
      } catch {
        // ignore
      }
      wakeLockSentinelRef.current = null;
      setWakeLockActive(false);
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && runningRef.current) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [acquireWakeLock]);

  const firePhoneTrigger = useCallback(async (measuredG: number) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    lastTriggerTimeRef.current = Date.now();

    const roundedG = Math.round(measuredG * 1000) / 1000;
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const triggerTimeStr = new Date().toLocaleTimeString("en-GB", {
      hourCycle: "h23"
    });

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
          testLabel: testLabelRef.current.trim() || undefined
        })
      });
      const t1 = performance.now();
      const clientRttMs = Math.max(1, Math.round(t1 - t0));
      const payload = await res.json();

      if (payload.feedEventId) {
        await fetch("/api/feed/rtt", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-feed-token": tokenRef.current
          },
          body: JSON.stringify({
            feedEventId: payload.feedEventId,
            clientRttMs
          })
        });
      }

      if (res.status === 429) {
        setTriggers((prev) => [
          {
            id: entryId,
            time: triggerTimeStr,
            vibrationG: roundedG,
            portions: 0,
            clientRttMs,
            serverTotalMs: null,
            tuyaApiMs: null,
            status: "COOLDOWN",
            detail: payload.error ?? "Cooldown active"
          },
          ...prev.slice(0, 29)
        ]);
        return;
      }

      if (res.status === 409 || res.status === 422) {
        if (payload.result === "SKIPPED_DISABLED") {
          setSourceEnabled(false);
          sourceEnabledRef.current = false;
        }
        setTriggers((prev) => [
          {
            id: entryId,
            time: triggerTimeStr,
            vibrationG: roundedG,
            portions: 0,
            clientRttMs,
            serverTotalMs: payload.serverTotalMs ?? null,
            tuyaApiMs: null,
            status: "SKIPPED",
            detail: payload.error ?? "Skipped"
          },
          ...prev.slice(0, 29)
        ]);
        return;
      }

      if (!res.ok || !payload.ok) {
        setTriggers((prev) => [
          {
            id: entryId,
            time: triggerTimeStr,
            vibrationG: roundedG,
            portions: 0,
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
            portions: payload.portionsDispensed ?? 1,
            clientRttMs,
            serverTotalMs: payload.serverTotalMs ?? null,
            tuyaApiMs: payload.tuyaApiMs ?? null,
            status: "OK",
            detail: `Fed ${payload.portionsDispensed ?? 1} portion(s)`
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
          portions: 0,
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
          "Accelerometer returned no readings. Open this page over HTTPS on a smartphone."
        );
        return;
      }

      const dynG = Math.sqrt(linX * linX + linY * linY + linZ * linZ) / 9.81;
      const roundedDynG = Math.round(dynG * 1000) / 1000;

      const now = Date.now();
      if (now - lastSampleUiUpdateRef.current >= 100) {
        lastSampleUiUpdateRef.current = now;
        setDynamicG(roundedDynG);
        setSamples((prev) => {
          const next = [
            ...prev,
            {
              timeLabel: new Date(now).toLocaleTimeString("en-GB", {
                hourCycle: "h23"
              }),
              gPeak: roundedDynG
            }
          ];
          return next.length > 100 ? next.slice(next.length - 100) : next;
        });
      }

      if (
        sourceEnabledRef.current &&
        dynG >= thresholdRef.current &&
        now - lastTriggerTimeRef.current >= cooldownMsRef.current &&
        !inFlightRef.current
      ) {
        firePhoneTrigger(dynG);
      }
    },
    [firePhoneTrigger]
  );

  // Required inside click handler for iOS DeviceMotionEvent.requestPermission()
  const handleStartSensor = async () => {
    if (typeof window === "undefined") return;

    if (
      window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      setSensorStatus("Device motion requires an HTTPS connection.");
      return;
    }

    if (typeof window.DeviceMotionEvent === "undefined") {
      setSensorStatus("Device motion is not supported in this browser.");
      return;
    }

    const DM =
      window.DeviceMotionEvent as unknown as DeviceMotionEventWithPermission;
    if (typeof DM.requestPermission === "function") {
      try {
        const permState = await DM.requestPermission();
        if (permState !== "granted") {
          setSensorStatus(
            "Motion permission was denied. Reload the page to request again."
          );
          return;
        }
      } catch (err) {
        setSensorStatus(
          err instanceof Error
            ? err.message
            : "Failed to request motion permission."
        );
        return;
      }
    }

    gravityRef.current = { x: 0, y: 0, z: 0, initialized: false };
    window.addEventListener("devicemotion", handleMotionEvent);
    runningRef.current = true;
    setRunning(true);
    setSensorStatus("Listening for motion above threshold.");
    await acquireWakeLock();
  };

  const handleStopSensor = useCallback(async () => {
    window.removeEventListener("devicemotion", handleMotionEvent);
    runningRef.current = false;
    setRunning(false);
    setSensorStatus("Stopped.");
    await releaseWakeLock();
  }, [handleMotionEvent, releaseWakeLock]);

  useEffect(() => {
    return () => {
      window.removeEventListener("devicemotion", handleMotionEvent);
      releaseWakeLock();
    };
  }, [handleMotionEvent, releaseWakeLock]);

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <header className="flex items-center justify-between gap-3 pb-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <Link
              href="/sensors"
              className="p-2 rounded-md border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              aria-label="Back to Sensors"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            </Link>
            <div>
              <h1 className="text-xl font-semibold">Phone sensor</h1>
              <p className="text-xs text-neutral-500">
                Uses your phone accelerometer to trigger feeding when vibration exceeds the threshold.
              </p>
            </div>
          </div>
        </header>

        {!sourceEnabled && (
          <Card className="border-red-600 dark:border-red-500">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-red-600 dark:text-red-500 font-medium">
                Phone sensor is turned off in Feeding settings
              </p>
              <Link href="/feeding">
                <Button variant="secondary" size="sm">
                  Feeding settings
                </Button>
              </Link>
            </div>
          </Card>
        )}

        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusDot
              tone={running ? "active" : "neutral"}
              label={sensorStatus}
            />
            <div className="flex items-center gap-3 text-xs text-neutral-500 tabular-nums">
              {wakeLockActive && <span>Screen awake</span>}
              {cooldownRemainingMs > 0 && (
                <span>Cooldown {(cooldownRemainingMs / 1000).toFixed(1)} s</span>
              )}
            </div>
          </div>

          {/* Large current g value + portions per trigger (read-only) + threshold slider */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4">
              <div className="text-xs text-neutral-500">Vibration</div>
              <div className="text-3xl font-semibold tabular-nums mt-1">
                {dynamicG.toFixed(2)} g
              </div>
            </div>

            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4">
              <div className="text-xs text-neutral-500">
                Portions per trigger
              </div>
              <div className="text-xl font-semibold tabular-nums mt-1">
                {portionsPerTrigger}{" "}
                {portionsPerTrigger === 1 ? "portion" : "portions"}
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                Set on the Feeding page · {cooldownSeconds} s cooldown
              </div>
            </div>

            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4">
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span>Threshold</span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100 tabular-nums">
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
                className="w-full mt-3 accent-neutral-900 dark:accent-neutral-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <Input
              id="phone-test-label"
              label="Test label (optional)"
              value={testLabel}
              onChange={(e) => setTestLabel(e.target.value)}
              placeholder="phone-wifi"
            />
            {!running ? (
              <Button onClick={handleStartSensor} className="w-full">
                Start
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={handleStopSensor}
                className="w-full"
              >
                Stop
              </Button>
            )}
          </div>

          <LiveChart
            data={samples}
            thresholdG={thresholdG}
            heightClass="h-44"
          />
        </Card>

        <Card>
          <SectionHeader
            title="Recent triggers"
            description="Result and round-trip latency for triggers fired in this session."
          />
          {triggers.length === 0 ? (
            <EmptyState
              title="No triggers fired yet"
              description="Press Start and move your phone above the vibration threshold."
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Time</Th>
                  <Th className="text-right">Vibration</Th>
                  <Th className="text-right">Total (ms)</Th>
                  <Th className="text-right">Server (ms)</Th>
                  <Th className="text-right">Feeder API (ms)</Th>
                  <Th>Result</Th>
                </tr>
              </THead>
              <tbody className="tabular-nums">
                {triggers.map((t) => (
                  <tr key={t.id}>
                    <Td className="text-xs text-neutral-500">{t.time}</Td>
                    <Td className="text-right">{t.vibrationG.toFixed(2)} g</Td>
                    <Td className="text-right">
                      {t.clientRttMs !== null ? `${t.clientRttMs} ms` : "—"}
                    </Td>
                    <Td className="text-right">
                      {t.serverTotalMs !== null ? `${t.serverTotalMs} ms` : "—"}
                    </Td>
                    <Td className="text-right">
                      {t.tuyaApiMs !== null ? `${t.tuyaApiMs} ms` : "—"}
                    </Td>
                    <Td
                      className={
                        t.status === "ERROR"
                          ? "text-red-600 dark:text-red-500 font-medium"
                          : ""
                      }
                    >
                      {t.detail}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
