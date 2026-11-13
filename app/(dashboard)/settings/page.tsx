"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Button,
  Card,
  Dialog,
  Input,
  SectionHeader,
  Select,
  StatusDot,
  Switch
} from "@/components/ui";
import { type ThemeChoice, useDashboardAuth } from "@/components/TokenGate";
import { formatDateTimeMYT } from "@/lib/time";
import type {
  DeviceHeartbeatRow,
  FeederSettingsRow
} from "@/lib/supabase-server";

export default function SettingsPage() {
  const { token, setToken, clearToken, theme, setTheme } = useDashboardAuth();
  const [settings, setSettings] = useState<FeederSettingsRow | null>(null);
  const [tuyaConfigured, setTuyaConfigured] = useState(false);
  const [espHeartbeat, setEspHeartbeat] =
    useState<DeviceHeartbeatRow | null>(null);

  // Access token input
  const [newTokenInput, setNewTokenInput] = useState("");
  const [tokenSavedMsg, setTokenSavedMsg] = useState<string | null>(null);

  // Test connection state
  const [testingConn, setTestingConn] = useState(false);
  const [connResult, setConnResult] = useState<{
    text: string;
    critical: boolean;
  } | null>(null);

  // Simulation mode confirmation dialog
  const [simConfirmOpen, setSimConfirmOpen] = useState(false);
  const [pendingSimValue, setPendingSimValue] = useState(false);

  // Timezone
  const [timezone, setTimezone] = useState("Asia/Kuala_Lumpur");

  // Developer tools (collapsed by default)
  const [devOpen, setDevOpen] = useState(false);
  const [devBusy, setDevBusy] = useState(false);
  const [devMessage, setDevMessage] = useState<{
    text: string;
    critical: boolean;
  } | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/settings", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      setSettings(json.settings ?? null);
      setTuyaConfigured(Boolean(json.tuyaConfigured));
      setEspHeartbeat(json.esp32Heartbeat ?? null);
      if (json.settings?.timezone) {
        setTimezone(json.settings.timezone);
      }
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleChangeToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTokenInput.trim()) return;
    setToken(newTokenInput.trim());
    setNewTokenInput("");
    setTokenSavedMsg("Access token updated in this browser.");
  };

  const handleTestConnection = async () => {
    setTestingConn(true);
    setConnResult(null);
    try {
      const res = await fetch("/api/settings/test-connection", {
        method: "POST",
        headers: { "x-feed-token": token }
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setConnResult({
          text: json.error ?? "Connection test failed.",
          critical: true
        });
      } else {
        const onlineLabel =
          json.online === true
            ? "Online"
            : json.online === false
              ? "Offline"
              : "Unknown";
        const lowFoodLabel =
          json.lowFood === true
            ? "Low"
            : json.lowFood === false
              ? "OK"
              : "Unknown";
        setConnResult({
          text: `Feeder status: ${onlineLabel} · Low-food sensor: ${lowFoodLabel}`,
          critical: json.online === false || json.lowFood === true
        });
      }
      await loadSettings();
    } catch (err) {
      setConnResult({
        text: err instanceof Error ? err.message : "Network error",
        critical: true
      });
    } finally {
      setTestingConn(false);
    }
  };

  const handleConfirmSimulationMode = async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-feed-token": token
      },
      body: JSON.stringify({ simulation_mode: pendingSimValue })
    });
    setSimConfirmOpen(false);
    await loadSettings();
  };

  const handleTimezoneChange = async (nextTz: string) => {
    setTimezone(nextTz);
    await fetch("/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-feed-token": token
      },
      body: JSON.stringify({ timezone: nextTz })
    });
    await loadSettings();
  };

  // Developer tool actions
  const runDevAction = async (
    endpoint: string,
    body?: Record<string, unknown>,
    successLabel?: string
  ) => {
    setDevBusy(true);
    setDevMessage(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-feed-token": token
        },
        body: body ? JSON.stringify(body) : "{}"
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setDevMessage({
          text: json.error ?? "Operation failed.",
          critical: true
        });
      } else {
        setDevMessage({
          text: successLabel ?? "Operation completed.",
          critical: false
        });
      }
      await loadSettings();
    } catch (err) {
      setDevMessage({
        text: err instanceof Error ? err.message : "Network error",
        critical: true
      });
    } finally {
      setDevBusy(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetConfirmText !== "RESET") return;
    await runDevAction(
      "/api/dev/reset",
      { confirmation: "RESET" },
      "Database reset complete. Legacy tables and settings preserved."
    );
    setResetConfirmText("");
    setResetDialogOpen(false);
  };

  const tz = settings?.timezone ?? "Asia/Kuala_Lumpur";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-xs text-neutral-500 mt-0.5">
          Access token, feeder connection, theme, time zone, and developer tools.
        </p>
      </div>

      {/* 1. Feeder connection */}
      <Card className="space-y-4">
        <SectionHeader
          title="Feeder connection"
          description="Verify Tuya Cloud connection and device status without dispensing food."
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-neutral-500">Cloud credentials</div>
            <div className="mt-1">
              <StatusDot
                tone={tuyaConfigured ? "active" : "critical"}
                label={tuyaConfigured ? "Configured" : "Not configured"}
              />
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Device status</div>
            <div className="mt-1">
              <StatusDot
                tone={
                  settings?.tuya_online === false
                    ? "critical"
                    : settings?.tuya_online === true
                      ? "active"
                      : "neutral"
                }
                label={
                  settings?.tuya_online === false
                    ? "Offline"
                    : settings?.tuya_online === true
                      ? "Online"
                      : "Unverified"
                }
              />
            </div>
            {settings?.tuya_status_checked_at && (
              <div className="text-xs text-neutral-500 mt-0.5 tabular-nums">
                Checked {formatDateTimeMYT(settings.tuya_status_checked_at, tz)}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-500">Simulation mode</span>
              <Switch
                checked={Boolean(settings?.simulation_mode)}
                onChange={(next) => {
                  setPendingSimValue(next);
                  setSimConfirmOpen(true);
                }}
                label="Simulation mode"
              />
            </div>
            <p className="text-xs text-neutral-500 mt-1">
              {settings?.simulation_mode
                ? "Simulation mode is ON (skips physical feeder)."
                : "Live mode is ON (actuates physical feeder)."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-neutral-100 dark:border-neutral-900">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTestConnection}
            disabled={testingConn}
          >
            {testingConn ? "Testing..." : "Test connection"}
          </Button>
          {connResult && (
            <span
              className={`text-xs tabular-nums ${
                connResult.critical
                  ? "text-red-600 dark:text-red-500 font-medium"
                  : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              {connResult.text}
            </span>
          )}
        </div>
      </Card>

      {/* 2. Appearance & Time zone */}
      <Card>
        <SectionHeader
          title="Appearance and time zone"
          description="Light theme by default; dark theme follows system or manual selection."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            id="theme-select"
            label="Theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeChoice)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>

          <Select
            id="tz-select"
            label="Time zone"
            value={timezone}
            onChange={(e) => handleTimezoneChange(e.target.value)}
          >
            <option value="Asia/Kuala_Lumpur">Asia/Kuala_Lumpur (UTC+8)</option>
            <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
            <option value="UTC">UTC</option>
          </Select>
        </div>

        {espHeartbeat?.ip && (
          <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-900 text-xs text-neutral-500">
            <a
              href={`http://${espHeartbeat.ip}/`}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              ESP32 local page (same Wi-Fi only): http://{espHeartbeat.ip}/
            </a>
          </div>
        )}
      </Card>

      {/* 3. Access token */}
      <Card>
        <SectionHeader
          title="Access token"
          description="Stored in this browser to authorize feeding and settings changes."
        />
        <form
          onSubmit={handleChangeToken}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="w-full sm:w-72">
            <Input
              id="new-token"
              label="Replace access token"
              type="password"
              value={newTokenInput}
              onChange={(e) => setNewTokenInput(e.target.value)}
              placeholder="Enter new access token"
            />
          </div>
          <Button type="submit" variant="secondary">
            Update token
          </Button>
          <Button type="button" variant="destructive" onClick={clearToken}>
            Clear token
          </Button>
          {tokenSavedMsg && (
            <span className="text-xs text-neutral-500">{tokenSavedMsg}</span>
          )}
        </form>
      </Card>

      {/* 4. Developer tools (collapsed) */}
      <Card>
        <button
          type="button"
          onClick={() => setDevOpen((o) => !o)}
          className="w-full flex items-center justify-between text-left text-sm font-medium"
        >
          <span>Developer tools</span>
          {devOpen ? (
            <ChevronDown className="w-4 h-4" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
          )}
        </button>

        {devOpen && (
          <div className="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800 space-y-4">
            <p className="text-xs text-neutral-500">
              Demo seed rows are marked exclusively as demo data and never alter live records.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={devBusy}
                onClick={() =>
                  runDevAction(
                    "/api/dev/seed",
                    undefined,
                    "Seeded 12 demo feed events."
                  )
                }
              >
                Seed demo data
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={devBusy}
                onClick={() =>
                  runDevAction(
                    "/api/dev/clear-demo",
                    undefined,
                    "Cleared all demo data."
                  )
                }
              >
                Clear demo data
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={devBusy}
                onClick={() =>
                  runDevAction(
                    "/api/cron/tick",
                    undefined,
                    "Scheduler and background checks executed."
                  )
                }
              >
                Run scheduler now
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={devBusy}
                onClick={() => setResetDialogOpen(true)}
              >
                Reset database
              </Button>
            </div>

            {devMessage && (
              <p
                className={`text-xs ${
                  devMessage.critical
                    ? "text-red-600 dark:text-red-500 font-medium"
                    : "text-neutral-600 dark:text-neutral-400"
                }`}
              >
                {devMessage.text}
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Simulation mode confirmation dialog */}
      <Dialog
        open={simConfirmOpen}
        onClose={() => setSimConfirmOpen(false)}
        title={
          pendingSimValue
            ? "Enable simulation mode?"
            : "Return to live feeder mode?"
        }
        description={
          pendingSimValue
            ? "While simulation mode is enabled, feed triggers will be recorded as simulated and will NOT actuate the physical fish feeder."
            : "Feed triggers will actuate the physical fish feeder via Tuya Cloud."
        }
      >
        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="secondary"
            onClick={() => setSimConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirmSimulationMode}>Confirm</Button>
        </div>
      </Dialog>

      {/* Reset database confirmation dialog */}
      <Dialog
        open={resetDialogOpen}
        onClose={() => setResetDialogOpen(false)}
        title="Reset database"
        description="This clears v2 feed events, refills, sensor readings, and notifications, and resets the hopper to full capacity. Archived legacy_* tables and settings are preserved."
      >
        <form onSubmit={handleConfirmReset} className="space-y-4">
          <Input
            id="confirm-reset"
            label='Type "RESET" to confirm'
            value={resetConfirmText}
            onChange={(e) => setResetConfirmText(e.target.value)}
            placeholder="RESET"
            required
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setResetDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={resetConfirmText !== "RESET" || devBusy}
            >
              Reset database
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

