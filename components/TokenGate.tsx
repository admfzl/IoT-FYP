"use client";

import React, { useState, useEffect } from "react";
import { KeyRound, Lock, LogOut } from "lucide-react";

export const TOKEN_STORAGE_KEY = "fish_feeder_api_token";

interface TokenGateProps {
  children: (
    token: string,
    clearToken: () => void
  ) => React.ReactNode;
}

export function TokenGate({ children }: TokenGateProps) {
  const [token, setToken] = useState<string | null>(null);
  const [inputVal, setInputVal] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (saved && saved.trim().length > 0) {
      setToken(saved.trim());
    }
    setMounted(true);
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = inputVal.trim();
    if (!cleaned) return;
    window.localStorage.setItem(TOKEN_STORAGE_KEY, cleaned);
    setToken(cleaned);
    setInputVal("");
  };

  const clearToken = () => {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
  };

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-slate-400">Loading security gate...</div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-500">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Feeder Access Token</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Smart Fish Feeder Actuation &amp; Latency Study (FYP II)
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
            Enter your shared <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">FEED_API_TOKEN</code> to authorize actuation and configuration calls. It will be stored in this browser&apos;s <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">localStorage</code> and sent in the <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">x-feed-token</code> header.
          </p>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                API Token / PIN
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  placeholder="Enter FEED_API_TOKEN..."
                  autoFocus
                  required
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm transition"
            >
              Unlock Feeder Controls
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children(token, clearToken)}</>;
}

export function TokenStatusButton({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      title="Clear stored x-feed-token from localStorage"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
    >
      <LogOut className="w-3.5 h-3.5" />
      Change Token
    </button>
  );
}

