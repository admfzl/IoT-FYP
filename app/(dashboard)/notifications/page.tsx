"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  Input,
  SectionHeader,
  Skeleton,
  StatusDot,
  Switch,
  Table,
  Td,
  THead,
  Th
} from "@/components/ui";
import { useDashboardAuth } from "@/components/TokenGate";
import { formatDateTimeMYT } from "@/lib/time";
import type {
  FeederSettingsRow,
  NotificationRow
} from "@/lib/supabase-server";

export default function NotificationsPage() {
  const { token } = useDashboardAuth();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [settings, setSettings] = useState<FeederSettingsRow | null>(null);
  const [channelsConfigured, setChannelsConfigured] = useState<{
    telegram: boolean;
    email: boolean;
  }>({ telegram: false, email: false });
  const [loading, setLoading] = useState(true);

  // Settings form state
  const [lowThresholdPct, setLowThresholdPct] = useState("20");
  const [espOfflineMin, setEspOfflineMin] = useState("5");
  const [notifyBrowser, setNotifyBrowser] = useState(true);
  const [notifyTelegram, setNotifyTelegram] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{
    text: string;
    critical: boolean;
  } | null>(null);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setNotifications(json.notifications ?? []);
        const s = json.settings as FeederSettingsRow | null;
        setSettings(s);
        setChannelsConfigured(
          json.channelsConfigured ?? { telegram: false, email: false }
        );
        if (s) {
          setLowThresholdPct(String(s.low_food_threshold_percent ?? 20));
          setEspOfflineMin(String(s.esp32_offline_minutes ?? 5));
          setNotifyBrowser(Boolean(s.notify_browser));
          setNotifyTelegram(Boolean(s.notify_telegram));
          setNotifyEmail(Boolean(s.notify_email));
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleMarkRead = async (id: number | "all") => {
    await fetch(`/api/notifications/${id}/read`, {
      method: "POST",
      headers: { "x-feed-token": token }
    });
    await loadNotifications();
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      if (
        notifyBrowser &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        await Notification.requestPermission();
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: JSON.stringify({
          low_food_threshold_percent: Number(lowThresholdPct),
          esp32_offline_minutes: Number(espOfflineMin),
          notify_browser: notifyBrowser,
          notify_telegram: notifyTelegram,
          notify_email: notifyEmail
        })
      });
      if (res.ok) {
        await loadNotifications();
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSendTest = async (channel: "telegram" | "email" | "in_app") => {
    setTestFeedback(null);
    try {
      const res = await fetch("/api/notify/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: JSON.stringify({ channel })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setTestFeedback({
          text: json.error ?? "Failed to send test message.",
          critical: true
        });
      } else {
        setTestFeedback({
          text: `Sent test notification via ${channel}.`,
          critical: false
        });
        await loadNotifications();
      }
    } catch (err) {
      setTestFeedback({
        text: err instanceof Error ? err.message : "Network error",
        critical: true
      });
    }
  };

  const tz = settings?.timezone ?? "Asia/Kuala_Lumpur";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Notifications</h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Active and resolved alerts, low-food threshold, and delivery channels.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleMarkRead("all")}
          >
            Mark all as read
          </Button>
          <Button variant="secondary" size="sm" onClick={loadNotifications}>
            <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Alert settings */}
      <Card>
        <SectionHeader
          title="Alert settings"
          description="Alerts are deduplicated: one low-food alert per refill cycle and one offline alert per outage."
        />
        <form onSubmit={handleSaveSettings} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Input
              id="low-food-pct"
              label="Low-food threshold (% of capacity)"
              type="number"
              min={1}
              max={90}
              value={lowThresholdPct}
              onChange={(e) => setLowThresholdPct(e.target.value)}
            />
            <Input
              id="esp-offline-min"
              label="ESP32 offline alert after (minutes)"
              type="number"
              min={1}
              max={1440}
              value={espOfflineMin}
              onChange={(e) => setEspOfflineMin(e.target.value)}
            />

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-sm">Browser notifications</span>
                <Switch
                  checked={notifyBrowser}
                  onChange={setNotifyBrowser}
                  label="Browser notifications"
                />
              </div>
              <p className="text-xs text-neutral-500">
                Shown while the dashboard is open in your browser.
              </p>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-sm">Telegram channel</span>
                <Switch
                  checked={notifyTelegram}
                  onChange={setNotifyTelegram}
                  label="Telegram channel"
                />
              </div>
              <p className="text-xs text-neutral-500">
                {channelsConfigured.telegram
                  ? "Bot token and chat ID configured on server."
                  : "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on server."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-100 dark:border-neutral-900">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={savingSettings}>
                {savingSettings ? "Saving..." : "Save alert settings"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleSendTest("telegram")}
              >
                Send test Telegram message
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleSendTest("in_app")}
              >
                Send test in-app alert
              </Button>
            </div>

            {testFeedback && (
              <span
                className={`text-xs ${
                  testFeedback.critical
                    ? "text-red-600 dark:text-red-500 font-medium"
                    : "text-neutral-600 dark:text-neutral-400"
                }`}
              >
                {testFeedback.text}
              </span>
            )}
          </div>
        </form>
      </Card>

      {/* Alert list */}
      <Card>
        <SectionHeader
          title="Alert history"
          description="Low food, empty hopper, failed feeds, device offline, skipped schedules, and daily limits."
        />
        {loading ? (
          <Skeleton className="h-48" />
        ) : notifications.length === 0 ? (
          <EmptyState
            title="No alerts recorded"
            description="Alerts will appear here when thresholds or error conditions are triggered."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Time</Th>
                <Th>Type</Th>
                <Th>Message</Th>
                <Th>Status</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </THead>
            <tbody className="tabular-nums">
              {notifications.map((n) => {
                const isActiveCritical =
                  n.status === "active" && n.severity === "critical";
                return (
                  <tr
                    key={n.id}
                    className={
                      !n.read_at
                        ? "bg-neutral-50/60 dark:bg-neutral-900/40"
                        : ""
                    }
                  >
                    <Td className="text-xs text-neutral-500">
                      {formatDateTimeMYT(n.created_at, tz)}
                    </Td>
                    <Td className="text-xs font-medium">
                      {formatAlertType(n.type)}
                    </Td>
                    <Td
                      className={
                        isActiveCritical
                          ? "text-red-600 dark:text-red-500 font-medium"
                          : ""
                      }
                    >
                      {n.message}
                    </Td>
                    <Td>
                      <StatusDot
                        tone={
                          n.status === "active"
                            ? n.severity === "critical"
                              ? "critical"
                              : "active"
                            : "neutral"
                        }
                        label={
                          n.status === "active" ? "Active" : "Resolved"
                        }
                      />
                    </Td>
                    <Td className="text-right">
                      {!n.read_at ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleMarkRead(n.id)}
                        >
                          Mark as read
                        </Button>
                      ) : (
                        <span className="text-xs text-neutral-400">Read</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function formatAlertType(t: string): string {
  switch (t) {
    case "LOW_FOOD":
      return "Low food";
    case "HOPPER_EMPTY":
      return "Hopper empty";
    case "FEED_FAILED":
      return "Feed failed";
    case "FEEDER_OFFLINE":
      return "Feeder offline";
    case "ESP32_OFFLINE":
      return "ESP32 offline";
    case "SCHEDULE_SKIPPED":
      return "Schedule skipped";
    case "DAILY_LIMIT_REACHED":
      return "Daily limit";
    case "TEST":
      return "Test";
    default:
      return t;
  }
}

