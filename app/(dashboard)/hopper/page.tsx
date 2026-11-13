"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  SectionHeader,
  Select,
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
import { formatDateTimeMYT, formatTimeMYT } from "@/lib/time";
import type {
  CalibrationRow,
  FeederSettingsRow,
  RefillEventRow
} from "@/lib/supabase-server";

interface HopperHistoryResponse {
  settings: FeederSettingsRow | null;
  points: Array<{
    id: string;
    timestamp: string;
    portions: number;
    percent: number;
    kind: "feed" | "refill";
    detail: string;
    refillId?: number;
  }>;
  refills: RefillEventRow[];
  cycles: Array<{
    refillId: number;
    startAt: string;
    endAt: string | null;
    portionsAfter: number;
    note: string | null;
  }>;
  calibrations: CalibrationRow[];
}

export default function HopperPage() {
  const { token } = useDashboardAuth();
  const [data, setData] = useState<HopperHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCycleId, setSelectedCycleId] = useState<string>("all");

  // Refill dialog
  const [refillOpen, setRefillOpen] = useState(false);
  const [refillMode, setRefillMode] = useState<"full" | "custom">("full");
  const [customPortions, setCustomPortions] = useState("40");
  const [measuredGrams, setMeasuredGrams] = useState("");
  const [refillNote, setRefillNote] = useState("");
  const [refilling, setRefilling] = useState(false);

  // Calibration form + helper
  const [gramsMean, setGramsMean] = useState("1.76");
  const [gramsSd, setGramsSd] = useState("");
  const [sampleCount, setSampleCount] = useState("");
  const [capPortions, setCapPortions] = useState("40");
  const [calNotes, setCalNotes] = useState("");
  const [savingCal, setSavingCal] = useState(false);

  // Helper: weights of N test portions
  const [helperWeightsText, setHelperWeightsText] = useState("");

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/hopper/history", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        const d = json as HopperHistoryResponse;
        setData(d);
        if (d.settings) {
          setGramsMean(String(d.settings.grams_per_portion ?? 1.76));
          setGramsSd(
            d.settings.grams_per_portion_sd !== null &&
              d.settings.grams_per_portion_sd !== undefined
              ? String(d.settings.grams_per_portion_sd)
              : ""
          );
          setCapPortions(String(d.settings.capacity_portions ?? 40));
          setCustomPortions(String(d.settings.capacity_portions ?? 40));
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const settings = data?.settings;
  const tz = settings?.timezone ?? "Asia/Kuala_Lumpur";
  const capacity = Math.max(1, settings?.capacity_portions ?? 40);
  const remaining = settings?.remaining_portions ?? 0;
  const gramsPerPortion = Number(settings?.grams_per_portion ?? 1.76);
  const approxGrams = Math.round(remaining * gramsPerPortion);
  const pct = Math.round((remaining / capacity) * 100);
  const lowThreshold = settings?.low_food_threshold_percent ?? 20;
  const isCritical =
    remaining <= 0 || pct <= lowThreshold || settings?.tuya_low_food === true;

  const handleRefillSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRefilling(true);
    try {
      const targetPortions =
        refillMode === "full" ? capacity : Number(customPortions) || capacity;
      const res = await fetch("/api/hopper/refill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: JSON.stringify({
          portionsAfter: targetPortions,
          gramsMeasured: measuredGrams.trim() ? Number(measuredGrams) : null,
          note: refillNote.trim() || null
        })
      });
      if (res.ok) {
        setRefillOpen(false);
        setMeasuredGrams("");
        setRefillNote("");
        await loadHistory();
      }
    } finally {
      setRefilling(false);
    }
  };

  // Helper calculation for N test portions
  const parsedWeights = helperWeightsText
    .split(/[\s,;]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  const helperCount = parsedWeights.length;
  const helperMean =
    helperCount > 0
      ? parsedWeights.reduce((a, b) => a + b, 0) / helperCount
      : null;
  const helperSd =
    helperCount > 1 && helperMean !== null
      ? Math.sqrt(
          parsedWeights.reduce((acc, w) => acc + (w - helperMean) ** 2, 0) /
            (helperCount - 1)
        )
      : null;

  const applyHelperValues = () => {
    if (helperMean === null) return;
    setGramsMean((Math.round(helperMean * 1000) / 1000).toString());
    if (helperSd !== null) {
      setGramsSd((Math.round(helperSd * 1000) / 1000).toString());
    }
    setSampleCount(String(helperCount));
  };

  const handleSaveCalibration = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCal(true);
    try {
      const res = await fetch("/api/hopper/calibration", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: JSON.stringify({
          gramsPerPortion: Number(gramsMean),
          sd: gramsSd.trim() ? Number(gramsSd) : null,
          sampleCount: sampleCount.trim() ? Number(sampleCount) : null,
          capacityPortions: Number(capPortions),
          notes: calNotes.trim() || null
        })
      });
      if (res.ok) {
        setCalNotes("");
        await loadHistory();
      }
    } finally {
      setSavingCal(false);
    }
  };

  // Filter chart points by selected refill cycle
  const filteredPoints = (() => {
    const all = data?.points ?? [];
    if (selectedCycleId === "all") return all;
    const cycle = data?.cycles?.find(
      (c) => String(c.refillId) === selectedCycleId
    );
    if (!cycle) return all;
    const startMs = new Date(cycle.startAt).getTime();
    const endMs = cycle.endAt ? new Date(cycle.endAt).getTime() : Infinity;
    return all.filter((p) => {
      const t = new Date(p.timestamp).getTime();
      return t >= startMs && t < endMs;
    });
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Hopper</h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Portion-based inventory tracking, refill history, and versioned portion calibration.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={loadHistory}>
            <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setRefillOpen(true)}>
            Refill
          </Button>
        </div>
      </div>

      {/* Top row: Current level + Feeder low-food sensor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard
          label="Hopper"
          value={`${remaining} ${remaining === 1 ? "portion" : "portions"} left`}
          caption={`≈ ${approxGrams} g · ${pct}% of ${capacity} portions`}
          critical={isCritical}
        >
          <div className="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden mt-2">
            <div
              className={`h-full ${
                isCritical
                  ? "bg-red-600 dark:bg-red-500"
                  : "bg-neutral-900 dark:bg-neutral-100"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        </StatCard>

        <Card className="flex flex-col justify-between space-y-2">
          <div>
            <div className="text-xs text-neutral-500">
              Feeder low-food sensor
            </div>
            <div className="mt-2">
              <StatusDot
                tone={
                  settings?.tuya_low_food === true
                    ? "critical"
                    : settings?.tuya_low_food === false
                      ? "active"
                      : "neutral"
                }
                label={
                  settings?.tuya_low_food === true
                    ? "Feeder low-food sensor: Low"
                    : settings?.tuya_low_food === false
                      ? "Feeder low-food sensor: OK"
                      : "Feeder low-food sensor: Not checked yet"
                }
              />
            </div>
          </div>
          <p className="text-xs text-neutral-500 tabular-nums">
            {settings?.tuya_status_checked_at
              ? `Last checked ${formatDateTimeMYT(settings.tuya_status_checked_at, tz)}`
              : "Checked every 5 minutes by the background job or via Settings → Test connection."}
          </p>
        </Card>
      </div>

      {/* Hopper level step chart */}
      <Card>
        <SectionHeader
          title="Hopper level"
          description="Step chart of remaining portions (left axis) and percentage (right axis)."
          action={
            data?.cycles && data.cycles.length > 0 ? (
              <Select
                aria-label="Filter refill cycle"
                value={selectedCycleId}
                onChange={(e) => setSelectedCycleId(e.target.value)}
                className="w-56"
              >
                <option value="all">All refill cycles</option>
                {data.cycles.map((c) => (
                  <option key={c.refillId} value={String(c.refillId)}>
                    Cycle #{c.refillId} ({formatDateTimeMYT(c.startAt, tz)})
                  </option>
                ))}
              </Select>
            ) : undefined
          }
        />
        {loading ? (
          <Skeleton className="h-64" />
        ) : filteredPoints.length === 0 ? (
          <EmptyState title="No hopper history in this cycle" />
        ) : (
          <StepChart
            data={filteredPoints.map((p) => ({
              timeLabel: formatTimeMYT(p.timestamp, tz),
              portions: p.portions,
              percent: p.percent,
              kind: p.kind
            }))}
            capacityPortions={capacity}
            lowFoodThresholdPercent={lowThreshold}
            heightClass="h-72"
          />
        )}
      </Card>

      {/* Calibration + Helper */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="space-y-4">
          <SectionHeader
            title="Calibration"
            description="Versioned portion weight calibration. Each feed stores the active calibration ID so historical data stays consistent."
          />
          <form onSubmit={handleSaveCalibration} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                id="cal-mean"
                label="Grams per portion (measured mean)"
                type="number"
                step="0.001"
                min="0.05"
                max="100"
                value={gramsMean}
                onChange={(e) => setGramsMean(e.target.value)}
                required
              />
              <Input
                id="cal-sd"
                label="Standard deviation (g, optional)"
                type="number"
                step="0.001"
                min="0"
                max="50"
                value={gramsSd}
                onChange={(e) => setGramsSd(e.target.value)}
              />
              <Input
                id="cal-cap"
                label="Hopper capacity (portions)"
                type="number"
                min="1"
                max="1000"
                value={capPortions}
                onChange={(e) => setCapPortions(e.target.value)}
                required
              />
              <Input
                id="cal-samples"
                label="Sample count N (optional)"
                type="number"
                min="1"
                max="1000"
                value={sampleCount}
                onChange={(e) => setSampleCount(e.target.value)}
              />
            </div>
            <Input
              id="cal-notes"
              label="Notes (optional)"
              value={calNotes}
              onChange={(e) => setCalNotes(e.target.value)}
              placeholder="e.g. 2 mm floating pellets, 10-trial mean"
            />
            <Button type="submit" disabled={savingCal}>
              {savingCal ? "Saving..." : "Apply calibration"}
            </Button>
          </form>
        </Card>

        <Card className="space-y-4">
          <SectionHeader
            title="Portion weight helper"
            description="Enter the measured weights (g) of N test portions separated by commas or spaces to compute mean and SD."
          />
          <div className="space-y-3">
            <textarea
              rows={3}
              value={helperWeightsText}
              onChange={(e) => setHelperWeightsText(e.target.value)}
              placeholder="e.g. 1.74, 1.78, 1.75, 1.77, 1.76"
              className="w-full rounded-md border border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100"
            />
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-600 dark:text-neutral-400 tabular-nums">
              <div>
                Samples: <strong>{helperCount}</strong> · Mean:{" "}
                <strong>
                  {helperMean !== null ? `${helperMean.toFixed(3)} g` : "—"}
                </strong>{" "}
                · SD:{" "}
                <strong>
                  {helperSd !== null ? `${helperSd.toFixed(3)} g` : "—"}
                </strong>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={helperMean === null}
                onClick={applyHelperValues}
              >
                Use this value
              </Button>
            </div>
          </div>

          {data?.calibrations && data.calibrations.length > 0 && (
            <div className="pt-2 space-y-2">
              <div className="text-xs font-medium text-neutral-500">
                Calibration versions
              </div>
              <Table>
                <THead>
                  <tr>
                    <Th>ID</Th>
                    <Th>Date</Th>
                    <Th className="text-right">Mean (g)</Th>
                    <Th className="text-right">SD (g)</Th>
                    <Th className="text-right">Capacity</Th>
                  </tr>
                </THead>
                <tbody className="tabular-nums text-xs">
                  {data.calibrations.slice(0, 5).map((c) => (
                    <tr key={c.id}>
                      <Td className="font-mono">#{c.id}</Td>
                      <Td className="text-neutral-500">
                        {formatDateTimeMYT(c.created_at, tz)}
                      </Td>
                      <Td className="text-right">
                        {Number(c.grams_per_portion).toFixed(2)}
                      </Td>
                      <Td className="text-right">
                        {c.sd !== null ? Number(c.sd).toFixed(3) : "—"}
                      </Td>
                      <Td className="text-right">{c.capacity_portions}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      {/* Refill history table */}
      <Card>
        <SectionHeader
          title="Refill history"
          description="Recorded hopper refills and optional measured grams added."
        />
        {!data?.refills || data.refills.length === 0 ? (
          <EmptyState
            title="No refills recorded yet"
            description="Press Refill when adding feed to the hopper."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Time</Th>
                <Th className="text-right">Before (portions)</Th>
                <Th className="text-right">After (portions)</Th>
                <Th className="text-right">Measured grams added</Th>
                <Th>Note</Th>
              </tr>
            </THead>
            <tbody className="tabular-nums">
              {data.refills.map((r) => (
                <tr key={r.id}>
                  <Td className="text-xs text-neutral-500">
                    {formatDateTimeMYT(r.created_at, tz)}
                  </Td>
                  <Td className="text-right">{r.portions_before}</Td>
                  <Td className="text-right font-medium">{r.portions_after}</Td>
                  <Td className="text-right">
                    {r.grams_added_measured !== null
                      ? `${r.grams_added_measured} g`
                      : "—"}
                  </Td>
                  <Td className="text-xs text-neutral-500">{r.note ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Refill dialog */}
      <Dialog
        open={refillOpen}
        onClose={() => setRefillOpen(false)}
        title="Refill hopper"
        description="Set the new portion count in the hopper. Active low-food or empty alerts will resolve automatically."
      >
        <form onSubmit={handleRefillSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="refill-mode"
                checked={refillMode === "full"}
                onChange={() => setRefillMode("full")}
              />
              <span>Full ({capacity} portions)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="refill-mode"
                checked={refillMode === "custom"}
                onChange={() => setRefillMode("custom")}
              />
              <span>Custom portions</span>
            </label>
          </div>

          {refillMode === "custom" && (
            <Input
              id="custom-portions"
              label={`Portions after refill (1 to ${capacity})`}
              type="number"
              min={1}
              max={capacity}
              value={customPortions}
              onChange={(e) => setCustomPortions(e.target.value)}
              required
            />
          )}

          <Input
            id="measured-grams"
            label="Measured grams added (optional)"
            type="number"
            step="0.1"
            min="0.1"
            value={measuredGrams}
            onChange={(e) => setMeasuredGrams(e.target.value)}
            placeholder="e.g. 70.4"
          />

          <Input
            id="refill-note"
            label="Note (optional)"
            value={refillNote}
            onChange={(e) => setRefillNote(e.target.value)}
            placeholder="e.g. Topped up before weekend"
          />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRefillOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={refilling}>
              {refilling ? "Saving..." : "Confirm refill"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

