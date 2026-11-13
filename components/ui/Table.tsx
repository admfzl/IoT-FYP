import React from "react";

export function Table({
  children,
  className = ""
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="overflow-x-auto border border-neutral-200 dark:border-neutral-800 rounded-lg">
      <table className={`w-full text-left text-sm ${className}`}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 text-xs text-neutral-500">
      {children}
    </thead>
  );
}

export function Th({
  children,
  className = ""
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`py-2.5 px-3 font-medium ${className}`}>{children}</th>
  );
}

export function Td({
  children,
  className = "",
  colSpan
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`py-2.5 px-3 border-b border-neutral-100 dark:border-neutral-900 last:border-b-0 ${className}`}
    >
      {children}
    </td>
  );
}

