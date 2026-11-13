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

export interface LiveVibrationPoint {
  timeLabel: string;
  gPeak: number;
  gMean?: number;
}

export function LiveChart({
  data,
  thresholdG = 0.3,
  triggerTimeLabels = [],
  heightClass = "h-60"
}: {
  data: LiveVibrationPoint[];
  thresholdG?: number;
  triggerTimeLabels?: string[];
  heightClass?: string;
}) {
  const maxPeak = data.reduce((m, p) => Math.max(m, p.gPeak ?? 0), 0);
  const yMax = Math.max(
    0.5,
    Math.ceil(Math.max(maxPeak, thresholdG * 1.4) * 10) / 10
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 bg-neutral-900 dark:bg-neutral-100" />
          Vibration peak (g)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 border-t border-dashed border-neutral-500" />
          Threshold ({thresholdG.toFixed(2)} g)
        </span>
        {triggerTimeLabels.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 border-t border-dotted border-neutral-700 dark:border-neutral-300" />
            Feed triggered
          </span>
        )}
      </div>

      <div className={`${heightClass} w-full`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
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
              minTickGap={28}
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v} g`}
              width={48}
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
                typeof value === "number" ? `${value.toFixed(3)} g` : "—",
                name
              ]}
            />
            <ReferenceLine
              y={thresholdG}
              stroke="var(--chart-axis)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
            />
            {triggerTimeLabels.map((lbl, idx) => (
              <ReferenceLine
                key={`${lbl}-${idx}`}
                x={lbl}
                stroke="var(--chart-line)"
                strokeDasharray="2 2"
                strokeWidth={1}
              />
            ))}
            <Line
              type="monotone"
              dataKey="gPeak"
              name="Vibration"
              stroke="var(--chart-line)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

