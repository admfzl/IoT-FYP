"use client";

import React from "react";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export function Select({
  label,
  className = "",
  id,
  children,
  ...props
}: SelectProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={id}
          className="block text-xs text-neutral-500 dark:text-neutral-400"
        >
          {label}
        </label>
      )}
      <select
        id={id}
        className={`h-9 w-full rounded-md border border-neutral-300 bg-white px-2.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:ring-neutral-100 ${className}`}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

