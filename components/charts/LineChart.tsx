"use client";

import React from "react";
import {
  ResponsiveContainer,
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from "recharts";

export interface LatencySeriesPoint {
  index: number;
  timeLabel: string;
  MANUAL?: number | null;
  PHONE_SENSOR?: number | null;
  ESP32_SENSOR?: number | null;
  SCHEDULE?: number | null;
}

function renderMarker(
  shape: "circle" | "square" | "triangle" | "diamond"
) {
  return function MarkerDot(props: {
    cx?: number;
    cy?: number;
    value?: number | null;
  }) {
    const { cx, cy, value } = props;
    if (
      typeof cx !== "number" ||
      typeof cy !== "number" ||
      value === null ||
      value === undefined
    ) {
      return null;
    }
    if (shape === "circle") {
      return (
        <circle
          cx={cx}
          cy={cy}
          r={3}
          fill="var(--chart-line)"
          stroke="var(--chart-bg)"
          strokeWidth={1}
        />
      );
    }
    if (shape === "square") {
      return (
        <rect
          x={cx - 3}
          y={cy - 3}
          width={6}
          height={6}
          fill="var(--chart-bg)"
          stroke="var(--chart-line)"
          strokeWidth={1.5}
        />
      );
    }
    if (shape === "triangle") {
      return (
        <polygon
          points={`${cx},${cy - 3.5} ${cx - 3.5},${cy + 3} ${cx + 3.5},${cy + 3}`}
          fill="var(--chart-line)"
        />
      );
    }
    return (
      <polygon
        points={`${cx},${cy - 4} ${cx + 4},${cy} ${cx},${cy + 4} ${cx - 4},${cy}`}
        fill="var(--chart-bg)"
        stroke="var(--chart-line)"
        strokeWidth={1.5}
      />
    );
  };
}

export function LatencyLineChart({
  data
}: {
  data: LatencySeriesPoint[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-600 dark:text-neutral-400">
        <span className="inline-flex items-center gap-1.5">
          <svg width="24" height="10" className="text-neutral-900 dark:text-neutral-100">
            <line x1="0" y1="5" x2="24" y2="5" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="5" r="2.5" fill="currentColor" />
          </svg>
          Manual (solid)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="24" height="10" className="text-neutral-900 dark:text-neutral-100">
            <line
              x1="0"
              y1="5"
              x2="24"
              y2="5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
            <rect
              x="9.5"
              y="2.5"
              width="5"
              height="5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          Phone sensor (dashed)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="24" height="10" className="text-neutral-900 dark:text-neutral-100">
            <line
              x1="0"
              y1="5"
              x2="24"
              y2="5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="2 3"
            />
            <polygon points="12,1.5 8.5,8 15.5,8" fill="currentColor" />
          </svg>
          ESP32 sensor (dotted)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="24" height="10" className="text-neutral-900 dark:text-neutral-100">
            <line
              x1="0"
              y1="5"
              x2="24"
              y2="5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="9 4"
            />
            <polygon
              points="12,1 16,5 12,9 8,5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          Schedule server time (long-dash)
        </span>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsLineChart
            data={data}
            margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--chart-grid)"
              strokeWidth={1}
            />
            <XAxis
              dataKey="timeLabel"
              tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v} ms`}
              width={56}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--chart-bg)",
                borderColor: "var(--chart-border)",
                color: "var(--chart-line)",
                fontSize: "12px",
                borderRadius: "6px",
                boxShadow: "none"
              }}
              formatter={(value: unknown, name: string) => [
                typeof value === "number" ? `${value} ms` : "—",
                name
              ]}
            />
            <Line
              type="monotone"
              dataKey="MANUAL"
              name="Manual"
              stroke="var(--chart-line)"
              strokeWidth={1.5}
              dot={renderMarker("circle") as never}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="PHONE_SENSOR"
              name="Phone sensor"
              stroke="var(--chart-line)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={renderMarker("square") as never}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="ESP32_SENSOR"
              name="ESP32 sensor"
              stroke="var(--chart-line)"
              strokeWidth={1.5}
              strokeDasharray="2 3"
              dot={renderMarker("triangle") as never}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="SCHEDULE"
              name="Schedule (server)"
              stroke="var(--chart-line)"
              strokeWidth={1.5}
              strokeDasharray="9 4"
              dot={renderMarker("diamond") as never}
              connectNulls
              isAnimationActive={false}
            />
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

