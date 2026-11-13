import React from "react";

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-neutral-100 dark:bg-neutral-900 ${className}`}
    />
  );
}

