import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Fish Feeder — Actuation & Latency Study (FYP II)",
  description:
    "Precision Tilapia Aquaculture Actuation Latency & Feed Inventory Depletion Telemetry System (UTP FYP II)"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}

