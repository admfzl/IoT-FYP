"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  SectionHeader,
  Skeleton,
  StatCard,
  StatusDot,
  Table,
  Td,
  THead,
  Th
} from "@/components/ui";
import { StepChart } from "@/components/charts";
import { useDashboardAuth } from "@/components/TokenGate";
import {
  formatDateTimeMYT,
  formatRelativeAgo,
  formatTimeMYT
} from "@/lib/time";
import type {
  FeedEventRow,
  FeederSettingsRow,
  NotificationRow
} from "@/lib/supabase-server";
import type { UpcomingScheduleRun } from "@/lib/schedule";

interface OverviewResponse {
  settings: FeederSettingsRow | null;
  tuyaConfigured: boolean;
  upcomingRuns: UpcomingScheduleRun[];
  activeAlerts: NotificationRow[];
  recentFeeds: FeedEventRow[];
  lastFedEvent: FeedEventRow | null;
  todayTotalPortions: number;
  todayBySource: Record<string, number>;
  estimatedDaysLeft: number | null;
  hopperPoints: Array<{
    timestamp: string;
    portions: number;
    percent: number;
    kind: "feed" | "refill";
  }>;
}

export default function OverviewPage() {
  const { token } = useDashboardAuth();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [quickPortions, setQuickPortions] = useState(1);
  const [feeding, setFeeding] = useState(false);
  const [feedMessage, setFeedMessage] = useState<{
    text: string;
    critical: boolean;
  } | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/overview", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to load overview.");
      }
      setData(json as OverviewResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleQuickFeed = async () => {
    setFeeding(true);
    setFeedMessage(null);
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
          portions: quickPortions
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
        setFeedMessage({
          text: payload.error ?? "Feed failed.",
          critical: true
        });
      } else {
        const pCount = payload.portionsDispensed ?? quickPortions;
        setFeedMessage({
          text: `Fed ${pCount} ${pCount === 1 ? "portion" : "portions"} · ${clientRttMs} ms`,
          critical: false
        });
      }
      await loadOverview();
    } catch (err) {
      setFeedMessage({
        text: err instanceof Error ? err.message : "Network error",
        critical: true
      });
    } finally {
      setFeeding(false);
    }
  };

  const settings = data?.settings;
  const tz = settings?.timezone ?? "Asia/Kuala_Lumpur";
  const remaining = settings?.remaining_portions ?? 0;
  const capacity = Math.max(1, settings?.capacity_portions ?? 40);
  const gramsPerPortion = Number(settings?.grams_per_portion ?? 1.76);
  const approxGrams = Math.round(remaining * gramsPerPortion);
  const pct = Math.round((remaining / capacity) * 100);
  const lowThreshold = settings?.low_food_threshold_percent ?? 20;
  const isHopperCritical =
    remaining <= 0 || pct <= lowThreshold || settings?.tuya_low_food === true;

  const nextRun = data?.upcomingRuns?.[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Current hopper status, scheduled runs, and recent feeding activity.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={loadOverview}
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-600 dark:border-red-500">
          <p className="text-sm text-red-600 dark:text-red-500">{error}</p>
        </Card>
      )}

      {/* Top row: 4 stat cards */}
      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <Skeleton className="h-20" />
          </Card>
          <Card>
            <Skeleton className="h-20" />
          </Card>
          <Card>
            <Skeleton className="h-20" />
          </Card>
          <Card>
            <Skeleton className="h-20" />
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Hopper */}
          <StatCard
            label="Hopper"
            value={`${remaining} ${remaining === 1 ? "portion" : "portions"} left`}
            caption={`≈ ${approxGrams} g · ${pct}%`}
            critical={isHopperCritical}
          >
            <div className="space-y-1.5 pt-1">
              <div className="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    isHopperCritical
                      ? "bg-red-600 dark:bg-red-500"
                      : "bg-neutral-900 dark:bg-neutral-100"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
              <div className="text-xs text-neutral-500">
                {data?.estimatedDaysLeft !== null &&
                data?.estimatedDaysLeft !== undefined
                  ? `About ${data.estimatedDaysLeft} days left at current schedule`
                  : "No daily schedule active"}
              </div>
            </div>
          </StatCard>

          {/* 2. Feeder */}
          <Card className="flex flex-col justify-between space-y-2">
            <div>
              <div className="text-xs text-neutral-500">Feeder</div>
              <div className="mt-1.5 flex items-center gap-3">
                <StatusDot
                  tone={
                    settings?.tuya_online === false
                      ? "critical"
                      : settings?.tuya_online === true
                        ? "active"
                        : "neutral"
                  }
                  label={
                    settings?.tuya_online === false
                      ? "Offline"
                      : settings?.tuya_online === true
                        ? "Online"
                        : "Status unverified"
                  }
                />
                <span className="text-xs text-neutral-500">
                  · {settings?.simulation_mode ? "Simulation" : "Live"}
                </span>
              </div>
            </div>
            <div className="text-xs text-neutral-500 tabular-nums">
              {data?.lastFedEvent
                ? `Last fed ${formatTimeMYT(data.lastFedEvent.created_at, tz)} (${sourceLabel(data.lastFedEvent.source)})`
                : "No feeds recorded yet"}
            </div>
          </Card>

          {/* 3. Next feed */}
          <StatCard
            label="Next feed"
            value={nextRun ? nextRun.localTimeStr : "No schedule"}
            caption={
              nextRun
                ? `${nextRun.portions} ${nextRun.portions === 1 ? "portion" : "portions"}${nextRun.label ? ` · ${nextRun.label}` : ""}`
                : "Add feeding times on the Schedule page"
            }
          />

          {/* 4. Today */}
          <StatCard
            label="Today"
            value={`${data?.todayTotalPortions ?? 0} / ${settings?.daily_max_portions ?? 20} portions`}
            caption={`Manual ${data?.todayBySource?.MANUAL ?? 0} · Schedule ${data?.todayBySource?.SCHEDULE ?? 0} · ESP32 ${data?.todayBySource?.ESP32_SENSOR ?? 0} · Phone ${data?.todayBySource?.PHONE_SENSOR ?? 0}`}
            critical={
              (data?.todayTotalPortions ?? 0) >=
              (settings?.daily_max_portions ?? 20)
            }
          />
        </div>
      )}

      {/* Middle row: Quick feed + Active alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <SectionHeader
            title="Feed now"
            description="Dispense portions immediately using the manual trigger."
          />
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center rounded-md border border-neutral-300 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => setQuickPortions((p) => Math.max(1, p - 1))}
                className="h-9 px-3 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                −
              </button>
              <span className="px-3 text-sm font-medium tabular-nums">
                {quickPortions} {quickPortions === 1 ? "portion" : "portions"}
              </span>
              <button
                type="button"
                onClick={() => setQuickPortions((p) => Math.min(10, p + 1))}
                className="h-9 px-3 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                +
              </button>
            </div>

            <Button onClick={handleQuickFeed} disabled={feeding}>
              {feeding ? "Feeding..." : "Feed"}
            </Button>

            {feedMessage && (
              <span
                className={`text-xs tabular-nums ${
                  feedMessage.critical
                    ? "text-red-600 dark:text-red-500 font-medium"
                    : "text-neutral-600 dark:text-neutral-400"
                }`}
              >
                {feedMessage.text}
              </span>
            )}
          </div>
        </Card>

        <Card>
          <SectionHeader
            title="Active alerts"
            description="Unresolved conditions requiring attention."
            action={
              <Link
                href="/notifications"
                className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                View all
              </Link>
            }
          />
          {!data?.activeAlerts || data.activeAlerts.length === 0 ? (
            <p className="text-xs text-neutral-500 py-2">
              No active alerts. All systems normal.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800 text-sm">
              {data.activeAlerts.slice(0, 4).map((alert) => (
                <li
                  key={alert.id}
                  className="py-2.5 flex items-center justify-between gap-3 first:pt-0 last:pb-0"
                >
                  <div className="space-y-0.5">
                    <StatusDot
                      tone={
                        alert.severity === "critical" ? "critical" : "active"
                      }
                      label={alert.message}
                    />
                    <div className="text-xs text-neutral-500 pl-3.5 tabular-nums">
                      {formatRelativeAgo(alert.created_at)}
                    </div>
                  </div>
                  {(alert.type === "LOW_FOOD" ||
                    alert.type === "HOPPER_EMPTY") && (
                    <Link href="/hopper">
                      <Button variant="secondary" size="sm">
                        Refill
                      </Button>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Bottom row: Recent activity + Small 7-day hopper chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <SectionHeader
            title="Recent activity"
            description="Last 10 feeding and schedule events."
          />
          {!data?.recentFeeds || data.recentFeeds.length === 0 ? (
            <EmptyState
              title="No activity recorded yet"
              description="Use the Feed button above or configure a schedule to start recording events."
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Time</Th>
                  <Th>Source</Th>
                  <Th className="text-right">Portions</Th>
                  <Th>Result</Th>
                  <Th className="text-right">Total (ms)</Th>
                </tr>
              </THead>
              <tbody className="tabular-nums">
                {data.recentFeeds.map((ev) => {
                  const isFailed = ev.result === "FAILED";
                  const latency = ev.client_rtt_ms ?? ev.server_total_ms;
                  return (
                    <tr key={ev.id}>
                      <Td className="text-xs text-neutral-500">
                        {formatDateTimeMYT(ev.created_at, tz)}
                      </Td>
                      <Td>{sourceLabel(ev.source)}</Td>
                      <Td className="text-right">
                        {ev.portions_dispensed ?? ev.portions_requested ?? 1}
                      </Td>
                      <Td
                        className={
                          isFailed
                            ? "text-red-600 dark:text-red-500 font-medium"
                            : ""
                        }
                      >
                        {resultLabel(ev.result)}
                      </Td>
                      <Td className="text-right text-xs text-neutral-500">
                        {latency !== null && latency !== undefined
                          ? `${latency} ms`
                          : "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <SectionHeader
            title="Hopper level (last 7 days)"
            description="Portions remaining over time."
            action={
              <Link
                href="/hopper"
                className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Details
              </Link>
            }
          />
          {data?.hopperPoints && data.hopperPoints.length > 0 ? (
            <StepChart
              data={data.hopperPoints.map((p) => ({
                timeLabel: formatTimeMYT(p.timestamp, tz),
                portions: p.portions,
                percent: p.percent,
                kind: p.kind
              }))}
              capacityPortions={capacity}
              lowFoodThresholdPercent={lowThreshold}
              heightClass="h-52"
            />
          ) : (
            <EmptyState title="No hopper history yet" />
          )}
        </Card>
      </div>
    </div>
  );
}

function sourceLabel(s: string): string {
  switch (s) {
    case "MANUAL":
      return "Manual";
    case "SCHEDULE":
      return "Schedule";
    case "ESP32_SENSOR":
      return "Vibration sensor (ESP32)";
    case "PHONE_SENSOR":
      return "Phone sensor";
    default:
      return s;
  }
}

function resultLabel(r: string): string {
  switch (r) {
    case "FED":
      return "Fed";
    case "FAILED":
      return "Failed";
    case "SKIPPED_COOLDOWN":
      return "Skipped: cooldown";
    case "SKIPPED_DISABLED":
      return "Skipped: source off";
    case "SKIPPED_EMPTY":
      return "Skipped: hopper empty";
    case "SKIPPED_DAILY_LIMIT":
      return "Skipped: daily limit";
    case "SKIPPED_QUIET_HOURS":
      return "Skipped: quiet hours";
    default:
      return r;
  }
}

