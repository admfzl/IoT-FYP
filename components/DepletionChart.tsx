"use client";

import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine
} from "recharts";
import type { FeedLog } from "@/lib/supabase";

interface DepletionChartProps {
  chartLogs: FeedLog[];
  maxCapacityGrams: number;
}

export function DepletionChart({
  chartLogs,
  maxCapacityGrams
}: DepletionChartProps) {
  const data = chartLogs.map((log, idx) => ({
    seq: idx + 1,
    logId: log.id,
    remaining_percent: Number(log.remaining_percent),
    remaining_grams: Number(log.remaining_grams),
    source: log.source,
    created_at: new Date(log.created_at).toLocaleTimeString()
  }));

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Chart 2 — Feeder quantity remaining (% &amp; grams)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Step-after hopper inventory curve across feed events (Max capacity:{" "}
            <span className="font-mono font-semibold">{maxCapacityGrams} g</span>
            ). Red dashed threshold at 20% indicates low feed level.
          </p>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-60 flex items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-sm text-slate-500 dark:text-slate-400">
          No feed depletion points recorded yet.
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 12, right: 24, left: 0, bottom: 10 }}
            >
              <defs>
                <linearGradient id="depletionGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(148, 163, 184, 0.2)"
              />
              <XAxis
                dataKey="seq"
                tick={{ fontSize: 12 }}
                label={{
                  value: "Feed Sequence (#)",
                  position: "insideBottom",
                  offset: -5,
                  fontSize: 11
                }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => `${v}%`}
                label={{
                  value: "Remaining (%)",
                  angle: -90,
                  position: "insideLeft",
                  fontSize: 11
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  borderColor: "#334155",
                  color: "#f8fafc",
                  fontSize: "12px",
                  borderRadius: "8px"
                }}
                formatter={(
                  value: unknown,
                  _name: string,
                  item: { payload?: { remaining_grams?: number } }
                ) => {
                  const grams = item.payload?.remaining_grams ?? 0;
                  return [`${value}% (${grams} g)`, "Remaining Feed"];
                }}
                labelFormatter={(seq) => `Feed Sequence #${seq}`}
              />
              <ReferenceLine
                y={20}
                stroke="#ef4444"
                strokeDasharray="5 5"
                strokeWidth={2}
                label={{
                  value: "Low food (20%)",
                  position: "insideTopRight",
                  fill: "#ef4444",
                  fontSize: 12,
                  fontWeight: 600
                }}
              />
              <Area
                type="stepAfter"
                dataKey="remaining_percent"
                stroke="#10b981"
                strokeWidth={2.5}
                fill="url(#depletionGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

