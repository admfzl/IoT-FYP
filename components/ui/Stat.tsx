import React from "react";
import { Card } from "./Card";

export function StatCard({
  label,
  value,
  caption,
  critical = false,
  children
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  critical?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col justify-between space-y-2">
      <div>
        <div className="text-xs text-neutral-500">{label}</div>
        <div
          className={`mt-1 text-xl font-semibold tabular-nums ${
            critical
              ? "text-red-600 dark:text-red-500"
              : "text-neutral-900 dark:text-neutral-100"
          }`}
        >
          {value}
        </div>
        {caption && (
          <div className="mt-1 text-xs text-neutral-500 tabular-nums">
            {caption}
          </div>
        )}
      </div>
      {children}
    </Card>
  );
}

