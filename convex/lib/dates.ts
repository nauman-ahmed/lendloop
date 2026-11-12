import { LIMITS } from "./constants";

// Loans are booked by calendar day. Dates are ISO strings (YYYY-MM-DD) in UTC so
// that string comparison is date comparison and indexes can range over them.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function todayIso(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / DAY_MS);
}

/** Returns an error message, or null if the range is acceptable. */
export function validateLoanRange(
  startDate: string,
  endDate: string,
  now: number = Date.now(),
): string | null {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return "Dates must be valid calendar dates.";
  }
  const today = todayIso(now);
  if (startDate < today) return "The loan cannot start in the past.";
  if (endDate < startDate) return "The end date must be on or after the start date.";
  if (daysBetween(startDate, endDate) + 1 > LIMITS.maxLoanDays) {
    return `Loans can last at most ${LIMITS.maxLoanDays} days.`;
  }
  if (daysBetween(today, startDate) > LIMITS.maxAdvanceBookingDays) {
    return `Loans can be booked at most ${LIMITS.maxAdvanceBookingDays} days ahead.`;
  }
  return null;
}

/** Inclusive ranges overlap if neither ends before the other starts. */
export function rangesOverlap(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}
