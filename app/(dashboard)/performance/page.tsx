"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  Input,
  SectionHeader,
  Select,
  Skeleton,
  Switch,
  Table,
  Td,
  THead,
  Th
} from "@/components/ui";
import { LatencyLineChart, StackedBar } from "@/components/charts";
import { formatTimeMYT } from "@/lib/time";
import type { FeedEventRow } from "@/lib/supabase-server";
import type {
  ScheduleServerLatencyStats,
  SourceLatencyStats
} from "@/lib/stats";

interface PerformanceApiResponse {
  events: FeedEventRow[];
  summaryBySource: SourceLatencyStats[];
  scheduleStats: ScheduleServerLatencyStats;
  distinctLabels: string[];
  timezone: string;
}

export default function PerformancePage() {
  const [data, setData] = useState<PerformanceApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [labelFilter, setLabelFilter] = useState("");
  const [includeDemo, setIncludeDemo] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", new Date(`${fromDate}T00:00:00+08:00`).toISOString());
    if (toDate) params.set("to", new Date(`${toDate}T23:59:59+08:00`).toISOString());
    if (sourceFilter && sourceFilter !== "ALL") params.set("source", sourceFilter);
    if (labelFilter.trim()) params.set("label", labelFilter.trim());
    if (includeDemo) params.set("includeDemo", "true");
    return params.toString();
  }, [fromDate, toDate, sourceFilter, labelFilter, includeDemo]);

  const loadPerformance = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildQueryParams();
      const res = await fetch(`/api/performance${qs ? `?${qs}` : ""}`, {
        cache: "no-store"
      });
      if (res.ok) {
        const json = (await res.json()) as PerformanceApiResponse;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, [buildQueryParams]);

  useEffect(() => {
    loadPerformance();
  }, [loadPerformance]);

  const tz = data?.timezone ?? "Asia/Kuala_Lumpur";
  const events = data?.events ?? [];
  const fedEvents = events.filter((e) => e.result === "FED");

  // Build Chart A series
  const chartAData = fedEvents.map((ev, idx) => ({
    index: idx + 1,
    timeLabel: formatTimeMYT(ev.created_at, tz),
    MANUAL: ev.source === "MANUAL" ? ev.client_rtt_ms : null,
    PHONE_SENSOR: ev.source === "PHONE_SENSOR" ? ev.client_rtt_ms : null,
    ESP32_SENSOR: ev.source === "ESP32_SENSOR" ? ev.client_rtt_ms : null,
    SCHEDULE: ev.source === "SCHEDULE" ? ev.server_total_ms : null
  }));

  // Build Chart B stacked bar data
  const chartBData = (data?.summaryBySource ?? []).map((s) => ({
    sourceLabel: sourceTitle(s.source),
    networkMs: s.meanNetworkMs ?? 0,
    feederApiMs: s.meanTuyaApiMs ?? 0,
    serverMs: s.meanServerOverheadMs ?? 0
  }));

  const exportQuery = (() => {
    const p = new URLSearchParams();
    if (fromDate) p.set("from", new Date(`${fromDate}T00:00:00+08:00`).toISOString());
    if (toDate) p.set("to", new Date(`${toDate}T23:59:59+08:00`).toISOString());
    p.set("liveOnly", includeDemo ? "false" : "true");
    p.set("format", "csv");
    return p.toString();
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Performance</h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Command latency distributions, component breakdown, and summary statistics for reporting.
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <a href={`/api/export/latency-summary?${exportQuery}`}>
            <Button variant="secondary" size="sm">
              <Download className="w-4 h-4" strokeWidth={1.5} />
              Download this table (CSV)
            </Button>
          </a>
          <a href={`/api/export/feed-events?${exportQuery}`}>
            <Button variant="secondary" size="sm">
              <Download className="w-4 h-4" strokeWidth={1.5} />
              Download chart data (CSV)
            </Button>
          </a>
          <Button variant="secondary" size="sm" onClick={loadPerformance}>
            <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Demo data banner when enabled (§0.3) */}
      {includeDemo && (
        <div className="rounded-lg border border-red-600 dark:border-red-500 p-3 text-xs font-medium text-red-600 dark:text-red-500">
          Demo data – not for report
        </div>
      )}

      {/* Filter bar (hidden in print) */}
      <Card className="no-print">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Input
            id="perf-from"
            label="From date"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <Input
            id="perf-to"
            label="To date"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
          <Select
            id="perf-source"
            label="Source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="ALL">All sources</option>
            <option value="MANUAL">Manual</option>
            <option value="ESP32_SENSOR">Vibration sensor (ESP32)</option>
            <option value="PHONE_SENSOR">Phone sensor</option>
            <option value="SCHEDULE">Schedule</option>
          </Select>
          <Input
            id="perf-label"
            label="Test label"
            value={labelFilter}
            onChange={(e) => setLabelFilter(e.target.value)}
            placeholder="Filter by test label"
          />
          <div className="flex items-center justify-between h-9 px-1">
            <span className="text-xs text-neutral-600 dark:text-neutral-400">
              Include demo data
            </span>
            <Switch
              checked={includeDemo}
              onChange={setIncludeDemo}
              label="Include demo data"
            />
          </div>
        </div>
      </Card>

      {/* Charts A & B */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <SectionHeader
            title="Command latency"
            description="Total latency (ms) per feed by trigger source."
          />
          {loading ? (
            <Skeleton className="h-64" />
          ) : chartAData.length === 0 ? (
            <EmptyState
              title="No feed latency measurements in this range"
              description="Trigger a feed or adjust the filters above."
            />
          ) : (
            <LatencyLineChart data={chartAData} />
          )}
        </Card>

        <Card>
          <SectionHeader
            title="Latency breakdown"
            description="Average Network, Feeder API, and Server time (ms) per source."
          />
          {loading ? (
            <Skeleton className="h-64" />
          ) : (
            <StackedBar data={chartBData} />
          )}
        </Card>
      </div>

      {/* Summary table for client-triggered sources */}
      <Card>
        <SectionHeader
          title="Latency summary by trigger source"
          description="Computed from measured round-trip times (Total ms). Unmeasured rows are excluded."
        />
        <Table>
          <THead>
            <tr>
              <Th>Source</Th>
              <Th className="text-right">n</Th>
              <Th className="text-right">Min (ms)</Th>
              <Th className="text-right">Mean (ms)</Th>
              <Th className="text-right">Median (ms)</Th>
              <Th className="text-right">p95 (ms)</Th>
              <Th className="text-right">Max (ms)</Th>
              <Th className="text-right">Feeder API (ms)</Th>
              <Th className="text-right">Network (ms)</Th>
              <Th className="text-right">Success rate</Th>
              <Th className="text-right">Token renewed</Th>
              <Th className="text-right">Method: Fallback</Th>
            </tr>
          </THead>
          <tbody className="tabular-nums">
            {(data?.summaryBySource ?? []).map((row) => (
              <tr key={row.source}>
                <Td className="font-medium">{sourceTitle(row.source)}</Td>
                <Td className="text-right">{row.n}</Td>
                <Td className="text-right">{fmtNum(row.min)}</Td>
                <Td className="text-right font-medium">{fmtNum(row.mean)}</Td>
                <Td className="text-right">{fmtNum(row.median)}</Td>
                <Td className="text-right">{fmtNum(row.p95)}</Td>
                <Td className="text-right">{fmtNum(row.max)}</Td>
                <Td className="text-right">{fmtNum(row.meanTuyaApiMs)}</Td>
                <Td className="text-right">{fmtNum(row.meanNetworkMs)}</Td>
                <Td className="text-right">
                  {row.successRate !== null ? `${row.successRate}%` : "—"}
                </Td>
                <Td className="text-right">{row.tokenRefreshedCount}</Td>
                <Td className="text-right">{row.fallbackCount}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* Separate small table for Schedule server-side latency (§3.6) */}
      <Card>
        <SectionHeader
          title="Scheduled feeds (server-side latency)"
          description="Scheduled runs originate on the server and have no client round-trip; values below reflect total server execution time."
        />
        <Table>
          <THead>
            <tr>
              <Th>Source</Th>
              <Th className="text-right">n</Th>
              <Th className="text-right">Min (ms)</Th>
              <Th className="text-right">Mean (ms)</Th>
              <Th className="text-right">Median (ms)</Th>
              <Th className="text-right">p95 (ms)</Th>
              <Th className="text-right">Max (ms)</Th>
              <Th className="text-right">Feeder API (ms)</Th>
              <Th className="text-right">Success rate</Th>
              <Th className="text-right">Token renewed</Th>
              <Th className="text-right">Method: Fallback</Th>
            </tr>
          </THead>
          <tbody className="tabular-nums">
            {data?.scheduleStats ? (
              <tr>
                <Td className="font-medium">Schedule (server)</Td>
                <Td className="text-right">{data.scheduleStats.n}</Td>
                <Td className="text-right">
                  {fmtNum(data.scheduleStats.minServerMs)}
                </Td>
                <Td className="text-right font-medium">
                  {fmtNum(data.scheduleStats.meanServerMs)}
                </Td>
                <Td className="text-right">
                  {fmtNum(data.scheduleStats.medianServerMs)}
                </Td>
                <Td className="text-right">
                  {fmtNum(data.scheduleStats.p95ServerMs)}
                </Td>
                <Td className="text-right">
                  {fmtNum(data.scheduleStats.maxServerMs)}
                </Td>
                <Td className="text-right">
                  {fmtNum(data.scheduleStats.meanTuyaApiMs)}
                </Td>
                <Td className="text-right">
                  {data.scheduleStats.successRate !== null
                    ? `${data.scheduleStats.successRate}%`
                    : "—"}
                </Td>
                <Td className="text-right">
                  {data.scheduleStats.tokenRefreshedCount}
                </Td>
                <Td className="text-right">
                  {data.scheduleStats.fallbackCount}
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </Card>

      {/* Collapsible "How latency is measured" note (§3.6) */}
      <Card>
        <button
          type="button"
          onClick={() => setNoteOpen((o) => !o)}
          className="w-full flex items-center justify-between text-left text-sm font-medium"
        >
          <span>How latency is measured</span>
          {noteOpen ? (
            <ChevronDown className="w-4 h-4" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
          )}
        </button>
        {noteOpen && (
          <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
            Each triggering device measures its own total round-trip time from
            sending the feed request until the server responds, using its local
            monotonic timer so client and server clocks are never subtracted.
            On the server, the time spent waiting for the Feeder Cloud API and
            the total server processing time are recorded separately. Network
            transit time is the difference between the client round-trip time
            and the server processing time.
          </p>
        )}
      </Card>
    </div>
  );
}

function sourceTitle(s: string): string {
  switch (s) {
    case "MANUAL":
      return "Manual";
    case "ESP32_SENSOR":
      return "Vibration sensor (ESP32)";
    case "PHONE_SENSOR":
      return "Phone sensor";
    case "SCHEDULE":
      return "Schedule";
    default:
      return s;
  }
}

function fmtNum(val: number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  return String(val);
}

