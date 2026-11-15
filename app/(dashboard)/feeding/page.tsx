"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  Input,
  SectionHeader,
  Skeleton,
  Switch,
  Table,
  Td,
  THead,
  Th
} from "@/components/ui";
import { useDashboardAuth } from "@/components/TokenGate";
import { formatDateTimeMYT } from "@/lib/time";
import type {
  FeederSettingsRow,
  TriggerSourceKey,
  TriggerSourceRow
} from "@/lib/supabase-server";

const SOURCE_ORDER: TriggerSourceKey[] = [
  "MANUAL",
  "SCHEDULE",
  "ESP32_SENSOR",
  "PHONE_SENSOR"
];

export default function FeedingPage() {
  const { token } = useDashboardAuth();
  const [sources, setSources] = useState<TriggerSourceRow[]>([]);
  const [settings, setSettings] = useState<FeederSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<{
    text: string;
    critical: boolean;
  } | null>(null);

  // Feed now controls
  const [portions, setPortions] = useState(1);
  const [testLabel, setTestLabel] = useState("");
  const [feeding, setFeeding] = useState(false);

  // Safety limits local state
  const [dailyMax, setDailyMax] = useState("20");
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("06:00");
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [skipWhenEmpty, setSkipWhenEmpty] = useState(true);
  const [savingLimits, setSavingLimits] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/trigger-sources", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        const list = (json.sources ?? []) as TriggerSourceRow[];
        list.sort(
          (a, b) =>
            SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source)
        );
        setSources(list);
        const s = json.settings as FeederSettingsRow | null;
        setSettings(s);
        if (s) {
          setDailyMax(String(s.daily_max_portions ?? 20));
          setSkipWhenEmpty(Boolean(s.skip_when_empty));
          if (s.quiet_hours_start && s.quiet_hours_end) {
            setQuietEnabled(true);
            setQuietStart(s.quiet_hours_start.slice(0, 5));
            setQuietEnd(s.quiet_hours_end.slice(0, 5));
          } else {
            setQuietEnabled(false);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFeedNow = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeeding(true);
    setStatusMsg(null);
    try {
      const t0 = performance.now();
      const res = await fetch("/api/feed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: JSON.stringify({
          source: "MANUAL",
          portions,
          testLabel: testLabel.trim() || undefined
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
            "x-feed-token": token
          },
          body: JSON.stringify({
            feedEventId: payload.feedEventId,
            clientRttMs
          })
        });
      }

      if (!res.ok || !payload.ok) {
        setStatusMsg({
          text: payload.error ?? "Feed failed.",
          critical: true
        });
      } else {
        const disp = payload.portionsDispensed ?? portions;
        setStatusMsg({
          text: `Fed ${disp} ${disp === 1 ? "portion" : "portions"} · ${clientRttMs} ms`,
          critical: false
        });
      }
      await loadData();
    } catch (err) {
      setStatusMsg({
        text: err instanceof Error ? err.message : "Network error",
        critical: true
      });
    } finally {
      setFeeding(false);
    }
  };

  const updateSourceField = async (
    sourceKey: TriggerSourceKey,
    patch: Partial<TriggerSourceRow>
  ) => {
    setSources((prev) =>
      prev.map((row) =>
        row.source === sourceKey ? { ...row, ...patch } : row
      )
    );
    await fetch(`/api/trigger-sources/${sourceKey}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-feed-token": token
      },
      body: JSON.stringify(patch)
    });
    await loadData();
  };

  const applyPreset = async (enabledSet: TriggerSourceKey[]) => {
    await Promise.all(
      SOURCE_ORDER.map((key) =>
        fetch(`/api/trigger-sources/${key}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-feed-token": token
          },
          body: JSON.stringify({ enabled: enabledSet.includes(key) })
        })
      )
    );
    await loadData();
  };

  const handleSaveSafetyLimits = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLimits(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: JSON.stringify({
          daily_max_portions: Number(dailyMax),
          quiet_hours_start: quietEnabled ? quietStart : null,
          quiet_hours_end: quietEnabled ? quietEnd : null,
          skip_when_empty: skipWhenEmpty
        })
      });
      if (res.ok) {
        await loadData();
      }
    } finally {
      setSavingLimits(false);
    }
  };

  const tz = settings?.timezone ?? "Asia/Kuala_Lumpur";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Feeding</h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Dispense portions manually, configure active trigger sources, and set safety limits.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={loadData}>
          <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
          Refresh
        </Button>
      </div>

      {/* 1. Feed now */}
      <Card>
        <SectionHeader
          title="Feed now"
          description="Send an immediate feeding command and optionally tag it with a test label."
        />
        <form
          onSubmit={handleFeedNow}
          className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end"
        >
          <div>
            <label className="block text-xs text-neutral-500 mb-1">
              Portions
            </label>
            <div className="inline-flex items-center rounded-md border border-neutral-300 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => setPortions((p) => Math.max(1, p - 1))}
                className="h-9 px-3 text-sm"
              >
                −
              </button>
              <span className="px-4 text-sm font-medium tabular-nums">
                {portions}
              </span>
              <button
                type="button"
                onClick={() => setPortions((p) => Math.min(20, p + 1))}
                className="h-9 px-3 text-sm"
              >
                +
              </button>
            </div>
          </div>

          <Input
            id="test-label"
            label="Test label (optional)"
            value={testLabel}
            onChange={(e) => setTestLabel(e.target.value)}
            placeholder="e.g. trial-1"
          />

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={feeding}>
              {feeding ? "Feeding..." : "Feed"}
            </Button>
            {statusMsg && (
              <span
                className={`text-xs tabular-nums ${
                  statusMsg.critical
                    ? "text-red-600 dark:text-red-500 font-medium"
                    : "text-neutral-600 dark:text-neutral-400"
                }`}
              >
                {statusMsg.text}
              </span>
            )}
          </div>
        </form>
      </Card>

      {/* 2. Trigger sources & presets */}
      <Card className="space-y-4">
        <SectionHeader
          title="Trigger sources"
          description="Choose which trigger sources are active and how many portions each trigger dispenses."
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500 mr-1">Mode presets:</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => applyPreset(["MANUAL"])}
          >
            Manual only
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => applyPreset(["MANUAL", "SCHEDULE"])}
          >
            Schedule only
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => applyPreset(["MANUAL", "ESP32_SENSOR"])}
          >
            Sensor only (ESP32)
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => applyPreset(["MANUAL", "PHONE_SENSOR"])}
          >
            Phone sensor only
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              applyPreset(["MANUAL", "SCHEDULE", "ESP32_SENSOR"])
            }
          >
            Schedule + sensor
          </Button>
        </div>

        {loading ? (
          <Skeleton className="h-40" />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Source</Th>
                <Th>Feeding enabled</Th>
                <Th>Portions per trigger</Th>
                <Th>Cooldown (s)</Th>
                <Th>Vibration threshold (g)</Th>
                <Th>Last triggered</Th>
              </tr>
            </THead>
            <tbody className="tabular-nums">
              {sources.map((row) => {
                const isSensor =
                  row.source === "ESP32_SENSOR" ||
                  row.source === "PHONE_SENSOR";
                return (
                  <tr key={row.source}>
                    <Td className="font-medium">{sourceTitle(row.source)}</Td>
                    <Td>
                      <Switch
                        checked={row.enabled}
                        onChange={(val) =>
                          updateSourceField(row.source, { enabled: val })
                        }
                        label={`Enable ${sourceTitle(row.source)}`}
                      />
                    </Td>
                    <Td>
                      <input
                        key={`p-${row.source}-${row.portions_per_trigger}`}
                        type="number"
                        min={1}
                        max={20}
                        defaultValue={row.portions_per_trigger}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (
                            Number.isInteger(v) &&
                            v >= 1 &&
                            v <= 20 &&
                            v !== row.portions_per_trigger
                          ) {
                            updateSourceField(row.source, {
                              portions_per_trigger: v
                            });
                          }
                        }}
                        className="h-8 w-20 rounded-md border border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2 text-sm tabular-nums"
                      />
                    </Td>
                    <Td>
                      <input
                        key={`c-${row.source}-${row.cooldown_seconds}`}
                        type="number"
                        min={0}
                        max={3600}
                        defaultValue={row.cooldown_seconds}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (
                            Number.isInteger(v) &&
                            v >= 0 &&
                            v <= 3600 &&
                            v !== row.cooldown_seconds
                          ) {
                            updateSourceField(row.source, {
                              cooldown_seconds: v
                            });
                          }
                        }}
                        className="h-8 w-24 rounded-md border border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2 text-sm tabular-nums"
                      />
                    </Td>
                    <Td>
                      {isSensor ? (
                        <input
                          key={`t-${row.source}-${row.threshold_g}`}
                          type="number"
                          step="0.01"
                          min={0.01}
                          max={16}
                          defaultValue={Number(row.threshold_g ?? 0.3).toFixed(2)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            }
                          }}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (
                              Number.isFinite(v) &&
                              v >= 0.01 &&
                              v <= 16 &&
                              v !== Number(row.threshold_g)
                            ) {
                              updateSourceField(row.source, {
                                threshold_g: Math.round(v * 1000) / 1000
                              });
                            }
                          }}
                          className="h-8 w-24 rounded-md border border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2 text-sm tabular-nums"
                        />
                      ) : (
                        <span className="text-xs text-neutral-400">—</span>
                      )}
                    </Td>
                    <Td className="text-xs text-neutral-500">
                      {formatDateTimeMYT(row.last_triggered_at, tz)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* 3. Safety limits */}
      <Card>
        <SectionHeader
          title="Safety limits"
          description="Daily portion cap, overnight quiet hours for sensor triggers, and empty-hopper interlock."
        />
        <form onSubmit={handleSaveSafetyLimits} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              id="daily-max"
              label="Daily maximum portions (all sources)"
              type="number"
              min={1}
              max={500}
              value={dailyMax}
              onChange={(e) => setDailyMax(e.target.value)}
            />

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-500">
                  Quiet hours (skips sensor-triggered feeds)
                </span>
                <Switch
                  checked={quietEnabled}
                  onChange={setQuietEnabled}
                  label="Enable quiet hours"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <input
                  type="time"
                  value={quietStart}
                  disabled={!quietEnabled}
                  onChange={(e) => setQuietStart(e.target.value)}
                  className="h-9 rounded-md border border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2.5 text-sm disabled:opacity-50"
                />
                <input
                  type="time"
                  value={quietEnd}
                  disabled={!quietEnabled}
                  onChange={(e) => setQuietEnd(e.target.value)}
                  className="h-9 rounded-md border border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2.5 text-sm disabled:opacity-50"
                />
              </div>
              <p className="text-xs text-neutral-500">
                Dissolved oxygen drops at night; avoiding nocturnal sensor feeding helps prevent elevated ammonia.
              </p>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-sm">
                  Skip feeding when hopper is empty
                </span>
                <Switch
                  checked={skipWhenEmpty}
                  onChange={setSkipWhenEmpty}
                  label="Skip feeding when hopper is empty"
                />
              </div>
              <p className="text-xs text-neutral-500">
                Prevents dry actuation when tracked portions reach zero.
              </p>
            </div>
          </div>

          <div>
            <Button type="submit" disabled={savingLimits}>
              {savingLimits ? "Saving..." : "Save safety limits"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function sourceTitle(s: TriggerSourceKey): string {
  switch (s) {
    case "MANUAL":
      return "Manual";
    case "SCHEDULE":
      return "Schedule";
    case "ESP32_SENSOR":
      return "Vibration sensor (ESP32)";
    case "PHONE_SENSOR":
      return "Phone sensor";
  }
}

