"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Utensils,
  CalendarClock,
  Box,
  Radio,
  BarChart2,
  Database,
  Bell,
  Settings,
  Menu,
  X
} from "lucide-react";
import { TokenGate } from "@/components/TokenGate";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/feeding", label: "Feeding", icon: Utensils },
  { href: "/schedule", label: "Schedule", icon: CalendarClock },
  { href: "/hopper", label: "Hopper", icon: Box },
  { href: "/sensors", label: "Sensors", icon: Radio },
  { href: "/performance", label: "Performance", icon: BarChart2 },
  { href: "/data", label: "Data", icon: Database },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings }
];

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <TokenGate>
      <DashboardShell>{children}</DashboardShell>
    </TokenGate>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const renderNavLinks = (onNavigate?: () => void) => (
    <nav className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
              active
                ? "bg-neutral-100 text-neutral-900 font-medium dark:bg-neutral-900 dark:text-neutral-100"
                : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-900/60"
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      {/* Desktop fixed left sidebar (220px) */}
      <aside className="no-print hidden md:flex md:w-[220px] md:shrink-0 md:flex-col md:fixed md:inset-y-0 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-4 py-5">
        <div className="px-3 mb-6">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
          >
            Fish Feeder
          </Link>
        </div>
        {renderNavLinks()}
      </aside>

      {/* Mobile top bar */}
      <header className="no-print md:hidden flex items-center justify-between px-4 h-14 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 sticky top-0 z-30">
        <Link href="/" className="text-sm font-semibold">
          Fish Feeder
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="p-2 rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300"
        >
          <Menu className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </header>

      {/* Mobile navigation sheet */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 w-64 max-w-[80vw] bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800 p-4 flex flex-col">
            <div className="flex items-center justify-between px-2 mb-4">
              <span className="text-sm font-semibold">Fish Feeder</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="p-1 rounded text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
            {renderNavLinks(() => setMobileOpen(false))}
          </div>
        </div>
      )}

      {/* Main content area */}
      <main className="flex-1 md:pl-[220px]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}

