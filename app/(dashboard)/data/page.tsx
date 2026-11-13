"use client";

import React, { useState } from "react";
import { Download } from "lucide-react";
import { Button, Card, Input, SectionHeader, Switch } from "@/components/ui";

interface DatasetSpec {
  id:
    | "feed-events"
    | "sensor-readings"
    | "hopper-history"
    | "schedule-runs"
    | "notifications"
    | "latency-summary";
  title: string;
  description: string;
  supportsLiveOnly: boolean;
}

const DATASETS: DatasetSpec[] = [
  {
    id: "feed-events",
    title: "Feed events",
    description:
      "All feed attempts and outcomes including latency breakdown, portions, trigger source, schedule ID, calibration ID, and fallback reasons.",
    supportsLiveOnly: true
  },
  {
    id: "sensor-readings",
    title: "Sensor readings",
    description:
      "Timestamped 3-axis acceleration (m/s²), mean and peak dynamic vibration (g), signal strength (RSSI), and device ID. Streamed directly for large date ranges.",
    supportsLiveOnly: false
  },
  {
    id: "hopper-history",
    title: "Hopper level history and refills",
    description:
      "Combined timeline of portion depletions and hopper refill events with measured grams and notes.",
    supportsLiveOnly: true
  },
  {
    id: "schedule-runs",
    title: "Schedule runs",
    description:
      "Scheduled feeding times, actual execution timestamps, results, portions dispensed, and server-side latency.",
    supportsLiveOnly: true
  },
  {
    id: "notifications",
    title: "Notifications",
    description:
      "Alert history with timestamps, alert type, severity, status, resolution time, and delivery channels.",
    supportsLiveOnly: false
  },
  {
    id: "latency-summary",
    title: "Latency summary",
    description:
      "Aggregated sample count, min, mean, median, 95th percentile, max, Feeder API mean, network mean, and success rate by trigger source.",
    supportsLiveOnly: true
  }
];

export default function DataPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Data</h1>
        <p className="text-xs text-neutral-500 mt-0.5">
          Download any dataset as UTF-8 CSV or JSON with both UTC and Malaysia (UTC+8) timestamps.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {DATASETS.map((ds) => (
          <DatasetDownloadCard key={ds.id} spec={ds} />
        ))}
      </div>
    </div>
  );
}

function DatasetDownloadCard({ spec }: { spec: DatasetSpec }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgoStr = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [fromDate, setFromDate] = useState(thirtyDaysAgoStr);
  const [toDate, setToDate] = useState(todayStr);
  const [liveOnly, setLiveOnly] = useState(true);

  const buildHref = (format: "csv" | "json") => {
    const params = new URLSearchParams();
    if (fromDate) {
      params.set(
        "from",
        new Date(`${fromDate}T00:00:00+08:00`).toISOString()
      );
    }
    if (toDate) {
      params.set("to", new Date(`${toDate}T23:59:59+08:00`).toISOString());
    }
    params.set("format", format);
    if (spec.supportsLiveOnly) {
      params.set("liveOnly", liveOnly ? "true" : "false");
    }
    return `/api/export/${spec.id}?${params.toString()}`;
  };

  return (
    <Card className="flex flex-col justify-between space-y-4">
      <div className="space-y-3">
        <SectionHeader title={spec.title} description={spec.description} />

        <div className="grid grid-cols-2 gap-3">
          <Input
            id={`${spec.id}-from`}
            label="From"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <Input
            id={`${spec.id}-to`}
            label="To"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>

        {spec.supportsLiveOnly && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-neutral-600 dark:text-neutral-400">
              Live data only
            </span>
            <Switch
              checked={liveOnly}
              onChange={setLiveOnly}
              label={`Live data only for ${spec.title}`}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-900">
        <a href={buildHref("csv")}>
          <Button size="sm">
            <Download className="w-4 h-4" strokeWidth={1.5} />
            Download CSV
          </Button>
        </a>
        <a href={buildHref("json")}>
          <Button variant="secondary" size="sm">
            <Download className="w-4 h-4" strokeWidth={1.5} />
            Download JSON
          </Button>
        </a>
      </div>
    </Card>
  );
}

