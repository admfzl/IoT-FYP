"use client";

import React from "react";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  caption?: string;
}

export function Input({
  label,
  caption,
  className = "",
  id,
  ...props
}: InputProps) {
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
      <input
        id={id}
        className={`h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:ring-neutral-100 disabled:opacity-50 ${className}`}
        {...props}
      />
      {caption && <p className="text-xs text-neutral-500">{caption}</p>}
    </div>
  );
}

