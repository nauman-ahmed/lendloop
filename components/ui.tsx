"use client";

import type { PaginationStatus } from "convex/react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { LoanStatus } from "@/convex/lib/constants";
import { describeActivity, errorMessage } from "@/lib/format";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-emerald-700 text-white hover:bg-emerald-800",
  secondary: "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
  ghost: "text-stone-600 hover:bg-stone-100",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

/**
 * Runs a Convex mutation, disabling itself while in flight and showing the
 * server's error message inline. `confirm` turns it into a two-click action.
 */
export function ActionButton({
  action,
  children,
  confirm,
  variant,
}: {
  action: () => Promise<unknown>;
  children: ReactNode;
  confirm?: string;
  variant?: Variant;
}) {
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (confirm && !armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant={variant} onClick={run} disabled={busy}>
        {armed ? confirm : children}
      </Button>
      {error && <span className="max-w-56 text-right text-xs text-red-700">{error}</span>}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-stone-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "stone",
}: {
  children: ReactNode;
  tone?: "stone" | "green" | "amber" | "red" | "blue";
}) {
  const tones = {
    stone: "bg-stone-100 text-stone-700",
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    red: "bg-red-50 text-red-800 ring-red-200",
    blue: "bg-sky-50 text-sky-800 ring-sky-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function TrustedBadge() {
  return (
    <span title="Marked as a Trusted Lender by an admin">
      <Badge tone="blue">✓ Trusted Lender</Badge>
    </span>
  );
}

export function LoanStatusBadge({ status, overdue }: { status: LoanStatus; overdue?: boolean }) {
  if (overdue) return <Badge tone="red">Overdue</Badge>;
  const map: Record<LoanStatus, [string, "stone" | "green" | "amber" | "red" | "blue"]> = {
    requested: ["Pending", "amber"],
    approved: ["Approved", "green"],
    declined: ["Declined", "stone"],
    cancelled: ["Cancelled", "stone"],
    returned: ["Returned", "blue"],
  };
  const [label, tone] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function ActivityList({
  activity,
}: {
  activity: Parameters<typeof describeActivity>[0][];
}) {
  if (activity.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 border-t border-stone-100 pt-2 text-xs text-stone-500">
      {activity.slice(0, 3).map((event, i) => (
        <li key={i} className={event.status === "failed" ? "text-red-700" : undefined}>
          ⚙ {describeActivity(event)}
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
      {children}
    </div>
  );
}

/** "Load more" for a usePaginatedQuery list; hidden once everything is loaded. */
export function LoadMore({
  status,
  loadMore,
  pageSize,
}: {
  status: PaginationStatus;
  loadMore: (numItems: number) => void;
  pageSize: number;
}) {
  if (status === "LoadingFirstPage" || status === "Exhausted") return null;
  return (
    <div className="mt-6 flex justify-center">
      <Button variant="secondary" disabled={status === "LoadingMore"} onClick={() => loadMore(pageSize)}>
        {status === "LoadingMore" ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}

export function Spinner() {
  return <div className="py-12 text-center text-sm text-stone-400">Loading…</div>;
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
      {children}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600";
