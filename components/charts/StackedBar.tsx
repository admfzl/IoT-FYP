"use client";

import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from "recharts";

export interface LatencyBreakdownBarItem {
  sourceLabel: string;
  networkMs: number;
  feederApiMs: number;
  serverMs: number;
}

export function StackedBar({
  data
}: {
  data: LatencyBreakdownBarItem[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-600 dark:text-neutral-400">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded-sm border border-neutral-400"
            style={{ backgroundColor: "var(--bar-1)" }}
          />
          Feeder API (ms)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded-sm border border-neutral-400"
            style={{ backgroundColor: "var(--bar-2)" }}
          />
          Network (ms)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded-sm border border-neutral-400"
            style={{ backgroundColor: "var(--bar-3)" }}
          />
          Server (ms)
        </span>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--chart-grid)"
              strokeWidth={1}
            />
            <XAxis
              dataKey="sourceLabel"
              tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
              axisLine={false}
              tickLine={false}
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
            <Bar
              dataKey="feederApiMs"
              name="Feeder API"
              stackId="a"
              fill="var(--bar-1)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="networkMs"
              name="Network"
              stackId="a"
              fill="var(--bar-2)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="serverMs"
              name="Server"
              stackId="a"
              fill="var(--bar-3)"
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

