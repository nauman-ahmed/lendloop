import { ConvexError } from "convex/values";

/** User-facing message for an error thrown by a Convex function. */
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string;
    return typeof data === "string" ? data : (data.message ?? "Something went wrong.");
  }
  return "Something went wrong. Please try again.";
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(`${iso}T00:00:00Z`));
}

export function formatRange(startDate: string, endDate: string): string {
  return startDate === endDate
    ? formatDate(startDate)
    : `${formatDate(startDate)} – ${formatDate(endDate)}`;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Human-readable line for an automation event, e.g. "Reminder sent 2 days ago". */
export function describeActivity(event: {
  kind: "notification" | "reminder" | "workflow_error";
  label: string;
  status: "pending" | "succeeded" | "failed";
  at: number;
}): string {
  const when = timeAgo(event.at);
  if (event.kind === "reminder") {
    return event.status === "succeeded"
      ? `Overdue reminder sent ${when}`
      : `Overdue reminder failed ${when}`;
  }
  const what = event.label.replace(/^loan\./, "").replace(/_/g, " ");
  if (event.status === "pending") return `Notifying (${what})…`;
  if (event.status === "failed") return `Notification failed (${what}) ${when}`;
  return `Notified (${what}) ${when}`;
}
