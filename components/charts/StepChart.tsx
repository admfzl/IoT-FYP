"use client";

import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine
} from "recharts";

export interface HopperStepPoint {
  timeLabel: string;
  portions: number;
  percent: number;
  kind?: "feed" | "refill";
}

export function StepChart({
  data,
  capacityPortions = 40,
  lowFoodThresholdPercent = 20,
  heightClass = "h-64"
}: {
  data: HopperStepPoint[];
  capacityPortions?: number;
  lowFoodThresholdPercent?: number;
  heightClass?: string;
}) {
  const cap = Math.max(1, capacityPortions);
  const thresholdPortions = Math.round((lowFoodThresholdPercent / 100) * cap);
  const refillLabels = data
    .filter((d) => d.kind === "refill")
    .map((d) => d.timeLabel);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 bg-neutral-900 dark:bg-neutral-100" />
          Remaining portions
        </span>
        <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-500">
          <span className="inline-block w-4 border-t border-dashed border-red-600 dark:border-red-500" />
          Low-food threshold ({thresholdPortions} portions ·{" "}
          {lowFoodThresholdPercent}%)
        </span>
      </div>

      <div className={`${heightClass} w-full`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
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
              yAxisId="left"
              domain={[0, cap]}
              tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
              width={44}
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
              formatter={(value: unknown, name: string) => {
                if (name === "portions") {
                  const p = Number(value ?? 0);
                  const pct = Math.round((p / cap) * 100);
                  return [`${p} portions (${pct}%)`, "Remaining"];
                }
                return [String(value), name];
              }}
            />
            <ReferenceLine
              yAxisId="left"
              y={thresholdPortions}
              stroke="var(--chart-critical)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
            />
            {refillLabels.map((lbl, idx) => (
              <ReferenceLine
                key={`${lbl}-${idx}`}
                yAxisId="left"
                x={lbl}
                stroke="var(--chart-axis)"
                strokeDasharray="2 2"
                label={{
                  value: "Refill",
                  position: "insideTopLeft",
                  fill: "var(--chart-axis)",
                  fontSize: 10
                }}
              />
            ))}
            <Line
              yAxisId="left"
              type="stepAfter"
              dataKey="portions"
              stroke="var(--chart-line)"
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

