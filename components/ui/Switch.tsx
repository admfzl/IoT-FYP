"use client";

import React from "react";

export function Switch({
  checked,
  onChange,
  disabled = false,
  label
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 dark:focus-visible:ring-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked
          ? "bg-neutral-900 border-neutral-900 dark:bg-neutral-100 dark:border-neutral-100"
          : "bg-neutral-200 border-neutral-300 dark:bg-neutral-800 dark:border-neutral-700"
      }`}
    >
      <span
        className={`pointer-events-none block h-3.5 w-3.5 rounded-full transition-transform ${
          checked
            ? "translate-x-4 bg-white dark:bg-neutral-900"
            : "translate-x-0.5 bg-white dark:bg-neutral-400"
        }`}
      />
    </button>
  );
}

