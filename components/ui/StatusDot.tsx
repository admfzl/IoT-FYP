import React from "react";

export type StatusDotTone = "neutral" | "active" | "critical";

export function StatusDot({
  tone = "neutral",
  label
}: {
  tone?: StatusDotTone;
  label: React.ReactNode;
}) {
  const dotClass =
    tone === "critical"
      ? "bg-red-600 dark:bg-red-500"
      : tone === "active"
        ? "bg-neutral-900 dark:bg-neutral-100"
        : "bg-neutral-400 dark:bg-neutral-600";

  const textClass =
    tone === "critical"
      ? "text-red-600 dark:text-red-500 font-medium"
      : "text-neutral-900 dark:text-neutral-100";

  return (
    <span className={`inline-flex items-center gap-2 text-sm ${textClass}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} />
      <span>{label}</span>
    </span>
  );
}

