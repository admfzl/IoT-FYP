"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef
} from "react";

export const TOKEN_STORAGE_KEY = "fish_feeder_api_token";
export const THEME_STORAGE_KEY = "fish_feeder_theme";

export type ThemeChoice = "system" | "light" | "dark";

interface TokenContextValue {
  token: string;
  setToken: (t: string) => void;
  clearToken: () => void;
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
}

const TokenContext = createContext<TokenContextValue | null>(null);

export function useDashboardAuth(): TokenContextValue {
  const ctx = useContext(TokenContext);
  if (!ctx) {
    throw new Error("useDashboardAuth must be used inside TokenGate");
  }
  return ctx;
}

export function TokenGate({
  children
}: {
  children:
    | React.ReactNode
    | ((token: string, clearToken: () => void) => React.ReactNode);
}) {
  const [token, setTokenState] = useState<string>("");
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const seenNotifIdsRef = useRef<Set<number>>(new Set());

  const applyThemeClass = useCallback((choice: ThemeChoice) => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const isDark =
      choice === "dark" || (choice === "system" && prefersDark);
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, []);

  useEffect(() => {
    const savedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (savedToken && savedToken.trim().length > 0) {
      setTokenState(savedToken.trim());
    }
    const savedTheme = window.localStorage.getItem(
      THEME_STORAGE_KEY
    ) as ThemeChoice | null;
    const initialTheme: ThemeChoice =
      savedTheme === "light" || savedTheme === "dark" || savedTheme === "system"
        ? savedTheme
        : "system";
    setThemeState(initialTheme);
    applyThemeClass(initialTheme);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      const current =
        (window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeChoice) ||
        "system";
      if (current === "system") applyThemeClass("system");
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [applyThemeClass]);

  const setToken = useCallback((next: string) => {
    const cleaned = next.trim();
    if (!cleaned) return;
    window.localStorage.setItem(TOKEN_STORAGE_KEY, cleaned);
    setTokenState(cleaned);
  }, []);

  const clearToken = useCallback(() => {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    setTokenState("");
  }, []);

  const setTheme = useCallback(
    (choice: ThemeChoice) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
      setThemeState(choice);
      applyThemeClass(choice);
    },
    [applyThemeClass]
  );

  // Poll active notifications for browser Notification API delivery (§3.8, §6.4)
  useEffect(() => {
    let active = true;

    const checkAlerts = async () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      try {
        const res = await fetch("/api/notifications?status=active", {
          cache: "no-store"
        });
        if (!res.ok || !active) return;
        const data = (await res.json()) as {
          notifications?: Array<{
            id: number;
            type: string;
            message: string;
          }>;
          settings?: { notify_browser?: boolean };
        };
        const list = data.notifications ?? [];
        const browserEnabled = data.settings?.notify_browser !== false;

        for (const item of list) {
          if (!seenNotifIdsRef.current.has(item.id)) {
            seenNotifIdsRef.current.add(item.id);
            if (
              browserEnabled &&
              typeof window !== "undefined" &&
              "Notification" in window &&
              Notification.permission === "granted"
            ) {
              try {
                new Notification("Fish Feeder", { body: item.message });
              } catch {
                // ignore notification constructor errors on mobile browsers
              }
            }
          }
        }
      } catch {
        // ignore transient network error
      }
    };

    checkAlerts();
    const timer = setInterval(checkAlerts, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <TokenContext.Provider
      value={{ token, setToken, clearToken, theme, setTheme }}
    >
      {typeof children === "function"
        ? children(token, clearToken)
        : children}
    </TokenContext.Provider>
  );
}
