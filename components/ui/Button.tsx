"use client";

import React from "react";

export type ButtonVariant = "primary" | "secondary" | "destructive";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 dark:focus-visible:ring-neutral-100 focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none";

  const sizeClass =
    size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-3.5 text-sm";

  const variantClass =
    variant === "primary"
      ? "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 border border-transparent"
      : variant === "destructive"
        ? "bg-white text-red-600 border border-neutral-300 hover:bg-neutral-50 dark:bg-neutral-950 dark:text-red-500 dark:border-neutral-800 dark:hover:bg-neutral-900"
        : "bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-50 dark:bg-neutral-950 dark:text-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900";

  return (
    <button
      className={`${base} ${sizeClass} ${variantClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

