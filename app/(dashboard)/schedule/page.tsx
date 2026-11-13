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
  FeedEventRow,
  FeedScheduleRow,
  FeederSettingsRow
} from "@/lib/supabase-server";
import type { UpcomingScheduleRun } from "@/lib/schedule";

const DAY_LABELS = [
  { day: 0, short: "Sun" },
  { day: 1, short: "Mon" },
  { day: 2, short: "Tue" },
  { day: 3, short: "Wed" },
  { day: 4, short: "Thu" },
  { day: 5, short: "Fri" },
  { day: 6, short: "Sat" }
];

export default function SchedulePage() {
  const { token } = useDashboardAuth();
  const [schedules, setSchedules] = useState<FeedScheduleRow[]>([]);
  const [upcomingRuns, setUpcomingRuns] = useState<UpcomingScheduleRun[]>([]);
  const [runHistory, setRunHistory] = useState<FeedEventRow[]>([]);
  const [settings, setSettings] = useState<FeederSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);

  // Add feeding time form
  const [newTime, setNewTime] = useState("08:00");
  const [newDays, setNewDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [newPortions, setNewPortions] = useState("2");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);

  // Edit dialog state
  const [editing, setEditing] = useState<FeedScheduleRow | null>(null);
  const [editTime, setEditTime] = useState("08:00");
  const [editDays, setEditDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [editPortions, setEditPortions] = useState("1");
  const [editLabel, setEditLabel] = useState("");

  const loadSchedules = useCallback(async () => {
    try {
      const res = await fetch("/api/schedules", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setSchedules(json.schedules ?? []);
        setUpcomingRuns(json.upcomingRuns ?? []);
        setRunHistory(json.runHistory ?? []);
        setSettings(json.settings ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const toggleDayInList = (list: number[], day: number): number[] => {
    if (list.includes(day)) {
      return list.length > 1 ? list.filter((d) => d !== day) : list;
    }
    return [...list, day].sort((a, b) => a - b);
  };

  const handleAddSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: JSON.stringify({
          time_of_day: newTime,
          days_of_week: newDays,
          portions: Number(newPortions) || 1,
          label: newLabel.trim() || null,
          enabled: true
        })
      });
      if (res.ok) {
        setNewLabel("");
        await loadSchedules();
      }
    } finally {
      setAdding(false);
    }
  };

  const handleToggleEnabled = async (row: FeedScheduleRow, next: boolean) => {
    setSchedules((prev) =>
      prev.map((s) => (s.id === row.id ? { ...s, enabled: next } : s))
    );
    await fetch(`/api/schedules/${row.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-feed-token": token
      },
      body: JSON.stringify({ enabled: next })
    });
    await loadSchedules();
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this feeding time?")) return;
    await fetch(`/api/schedules/${id}`, {
      method: "DELETE",
      headers: { "x-feed-token": token }
    });
    await loadSchedules();
  };

  const openEditDialog = (row: FeedScheduleRow) => {
    setEditing(row);
    setEditTime(row.time_of_day.slice(0, 5));
    setEditDays(row.days_of_week ?? [0, 1, 2, 3, 4, 5, 6]);
    setEditPortions(String(row.portions));
    setEditLabel(row.label ?? "");
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    await fetch(`/api/schedules/${editing.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-feed-token": token
      },
      body: JSON.stringify({
        time_of_day: editTime,
        days_of_week: editDays,
        portions: Number(editPortions) || 1,
        label: editLabel.trim() || null
      })
    });
    setEditing(null);
    await loadSchedules();
  };

  // Summary line calculations
  const enabledSchedules = schedules.filter((s) => s.enabled);
  const feedsPerDay =
    Math.round(
      enabledSchedules.reduce(
        (acc, s) => acc + (s.days_of_week?.length ?? 7) / 7,
        0
      ) * 10
    ) / 10;
  const portionsPerDay =
    Math.round(
      enabledSchedules.reduce(
        (acc, s) => acc + (s.portions * (s.days_of_week?.length ?? 7)) / 7,
        0
      ) * 10
    ) / 10;
  const gramsPerPortion = Number(settings?.grams_per_portion ?? 1.76);
  const gramsPerDay = Math.round(portionsPerDay * gramsPerPortion * 10) / 10;
  const tz = settings?.timezone ?? "Asia/Kuala_Lumpur";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Schedule</h1>
          <p className="text-xs text-neutral-500 mt-0.5 tabular-nums">
            {feedsPerDay} {feedsPerDay === 1 ? "feed" : "feeds"} per day ·{" "}
            {portionsPerDay} {portionsPerDay === 1 ? "portion" : "portions"} per
            day · ≈ {gramsPerDay.toFixed(1)} g per day
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={loadSchedules}>
          <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
          Refresh
        </Button>
      </div>

      {/* Add feeding time form */}
      <Card>
        <SectionHeader
          title="Add feeding time"
          description="Scheduled feeds run automatically in Malaysia time (Asia/Kuala_Lumpur)."
        />
        <form onSubmit={handleAddSchedule} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Input
              id="sched-time"
              label="Time (24-hour)"
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              required
            />
            <Input
              id="sched-portions"
              label="Portions"
              type="number"
              min={1}
              max={20}
              value={newPortions}
              onChange={(e) => setNewPortions(e.target.value)}
              required
            />
            <div className="sm:col-span-2">
              <Input
                id="sched-label"
                label="Label (optional)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Morning feed"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-neutral-500 mr-1">Days:</span>
              {DAY_LABELS.map((d) => {
                const active = newDays.includes(d.day);
                return (
                  <button
                    key={d.day}
                    type="button"
                    onClick={() =>
                      setNewDays((prev) => toggleDayInList(prev, d.day))
                    }
                    className={`h-8 px-2.5 rounded-md text-xs font-medium border transition-colors ${
                      active
                        ? "bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:border-neutral-100"
                        : "bg-white text-neutral-600 border-neutral-300 dark:bg-neutral-950 dark:text-neutral-400 dark:border-neutral-800"
                    }`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>

            <Button type="submit" disabled={adding}>
              {adding ? "Adding..." : "Add feeding time"}
            </Button>
          </div>
        </form>
      </Card>

      {/* Schedule entries + Next 5 upcoming runs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <SectionHeader title="Daily feeding times" />
          {loading ? (
            <Skeleton className="h-32" />
          ) : schedules.length === 0 ? (
            <EmptyState
              title="No feeding times configured"
              description="Use the form above to add your first daily feeding time."
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Time</Th>
                  <Th>Days</Th>
                  <Th className="text-right">Portions</Th>
                  <Th>Label</Th>
                  <Th>Enabled</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </THead>
              <tbody className="tabular-nums">
                {schedules.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.time_of_day.slice(0, 5)}</Td>
                    <Td className="text-xs text-neutral-500">
                      {formatDaysList(s.days_of_week)}
                    </Td>
                    <Td className="text-right">{s.portions}</Td>
                    <Td className="text-xs text-neutral-500">
                      {s.label ?? "—"}
                    </Td>
                    <Td>
                      <Switch
                        checked={s.enabled}
                        onChange={(v) => handleToggleEnabled(s, v)}
                        label={`Enable schedule ${s.time_of_day}`}
                      />
                    </Td>
                    <Td className="text-right">
                      <div className="inline-flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEditDialog(s)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(s.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <SectionHeader
            title="Next 5 upcoming runs"
            description="Calculated in Malaysia time."
          />
          {upcomingRuns.length === 0 ? (
            <p className="text-xs text-neutral-500 py-4">
              No upcoming scheduled runs.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800 text-sm tabular-nums">
              {upcomingRuns.map((u, idx) => (
                <li
                  key={`${u.scheduleId}-${u.scheduledForIso}-${idx}`}
                  className="py-2.5 flex items-center justify-between first:pt-0 last:pb-0"
                >
                  <div>
                    <div className="font-medium">
                      {formatDateTimeMYT(u.scheduledForIso, tz)}
                    </div>
                    {u.label && (
                      <div className="text-xs text-neutral-500">{u.label}</div>
                    )}
                  </div>
                  <span className="text-xs text-neutral-500">
                    {u.portions} {u.portions === 1 ? "portion" : "portions"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Run history */}
      <Card>
        <SectionHeader
          title="Run history"
          description="Scheduled time, actual execution time, result, portions dispensed, and server-side latency."
        />
        {runHistory.length === 0 ? (
          <EmptyState
            title="No schedule runs recorded yet"
            description="When a scheduled time is reached, its execution result will appear here."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Scheduled time</Th>
                <Th>Actual time</Th>
                <Th>Result</Th>
                <Th className="text-right">Portions</Th>
                <Th className="text-right">Server latency</Th>
              </tr>
            </THead>
            <tbody className="tabular-nums">
              {runHistory.map((r) => {
                const isFailed = r.result === "FAILED";
                return (
                  <tr key={r.id}>
                    <Td className="text-xs text-neutral-500">
                      {formatDateTimeMYT(
                        r.scheduled_for ?? r.created_at,
                        tz
                      )}
                    </Td>
                    <Td className="text-xs text-neutral-500">
                      {formatDateTimeMYT(r.created_at, tz)}
                    </Td>
                    <Td
                      className={
                        isFailed
                          ? "text-red-600 dark:text-red-500 font-medium"
                          : ""
                      }
                    >
                      {formatRunResult(r)}
                    </Td>
                    <Td className="text-right">
                      {r.portions_dispensed ?? 0} / {r.portions_requested ?? 1}
                    </Td>
                    <Td className="text-right text-xs text-neutral-500">
                      {r.server_total_ms !== null
                        ? `${r.server_total_ms} ms`
                        : "—"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Edit schedule dialog */}
      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit feeding time"
      >
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <Input
            id="edit-time"
            label="Time"
            type="time"
            value={editTime}
            onChange={(e) => setEditTime(e.target.value)}
            required
          />
          <Input
            id="edit-portions"
            label="Portions"
            type="number"
            min={1}
            max={20}
            value={editPortions}
            onChange={(e) => setEditPortions(e.target.value)}
            required
          />
          <Input
            id="edit-label"
            label="Label (optional)"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {DAY_LABELS.map((d) => {
              const active = editDays.includes(d.day);
              return (
                <button
                  key={d.day}
                  type="button"
                  onClick={() =>
                    setEditDays((prev) => toggleDayInList(prev, d.day))
                  }
                  className={`h-8 px-2.5 rounded-md text-xs font-medium border ${
                    active
                      ? "bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:border-neutral-100"
                      : "bg-white text-neutral-600 border-neutral-300 dark:bg-neutral-950 dark:text-neutral-400 dark:border-neutral-800"
                  }`}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function formatDaysList(days: number[] | null | undefined): string {
  if (!days || days.length === 7) return "Every day";
  if (
    days.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => days.includes(d))
  ) {
    return "Weekdays";
  }
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days.map((d) => names[d] ?? d).join(", ");
}

function formatRunResult(r: FeedEventRow): string {
  if (r.result === "FED") return "Fed";
  if (r.result === "FAILED") {
    return `Failed: ${r.error ?? "Feeder error"}`;
  }
  if (r.result.startsWith("SKIPPED_")) {
    return `Skipped: ${r.error ?? r.result.replace("SKIPPED_", "").toLowerCase()}`;
  }
  return r.result;
}

