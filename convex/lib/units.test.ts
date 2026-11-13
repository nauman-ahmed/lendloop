import { describe, expect, test } from "vitest";
import { isIsoDate, rangesOverlap, validateLoanRange } from "./dates";
import { signRequest, verifyRequest, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./signing";
import { CATEGORIES, CONDITIONS, LOAN_STATUSES, type Category, type Condition, type LoanStatus } from "./constants";
import type { Infer } from "convex/values";
import type { categoryValidator, conditionValidator, loanStatusValidator } from "../schema";

// Compile-time guard: schema validators and shared constants must agree.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _categories: Same<Category, Infer<typeof categoryValidator>> = true;
const _conditions: Same<Condition, Infer<typeof conditionValidator>> = true;
const _statuses: Same<LoanStatus, Infer<typeof loanStatusValidator>> = true;
void [_categories, _conditions, _statuses, CATEGORIES, CONDITIONS, LOAN_STATUSES];

const NOW = Date.parse("2026-06-10T12:00:00Z");

describe("dates", () => {
  test("isIsoDate rejects impossible dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("10/06/2026")).toBe(false);
  });

  test("validateLoanRange", () => {
    expect(validateLoanRange("2026-06-10", "2026-06-12", NOW)).toBeNull();
    expect(validateLoanRange("2026-06-09", "2026-06-12", NOW)).toMatch(/past/);
    expect(validateLoanRange("2026-06-12", "2026-06-11", NOW)).toMatch(/on or after/);
    expect(validateLoanRange("2026-06-10", "2026-07-20", NOW)).toMatch(/at most 30 days/);
    expect(validateLoanRange("2026-12-01", "2026-12-02", NOW)).toMatch(/ahead/);
  });

  test("rangesOverlap is inclusive", () => {
    const a = { startDate: "2026-06-10", endDate: "2026-06-12" };
    expect(rangesOverlap(a, { startDate: "2026-06-12", endDate: "2026-06-14" })).toBe(true);
    expect(rangesOverlap(a, { startDate: "2026-06-13", endDate: "2026-06-14" })).toBe(false);
  });
});

describe("signing", () => {
  const secret = "test-secret";
  const request = { method: "POST", path: "/n8n/reminders", body: JSON.stringify({ hello: "world" }) };

  test("round-trips", async () => {
    const headers = await signRequest(secret, request, 1_000);
    expect(headers[SIGNATURE_HEADER]).toMatch(/^v2=[0-9a-f]{64}$/);
    const result = await verifyRequest(secret, request, headers[TIMESTAMP_HEADER], headers[SIGNATURE_HEADER], 1_010);
    expect(result).toEqual({ ok: true });
  });

  test("rejects tampering, wrong secret, staleness and missing headers", async () => {
    const headers = await signRequest(secret, request, 1_000);
    const ts = headers[TIMESTAMP_HEADER];
    const sig = headers[SIGNATURE_HEADER];
    expect((await verifyRequest(secret, { ...request, body: request.body + " " }, ts, sig, 1_000)).ok).toBe(false);
    expect((await verifyRequest("other", request, ts, sig, 1_000)).ok).toBe(false);
    expect((await verifyRequest(secret, request, ts, sig, 1_000 + 301)).ok).toBe(false);
    expect((await verifyRequest(secret, request, null, sig, 1_000)).ok).toBe(false);
    // The timestamp is part of the MAC, so it can't be swapped for a fresh one.
    expect((await verifyRequest(secret, request, "1200", sig, 1_200)).ok).toBe(false);
  });

  test("a signature is only valid for the method and path it was made for", async () => {
    const headers = await signRequest(secret, request, 1_000);
    const ts = headers[TIMESTAMP_HEADER];
    const sig = headers[SIGNATURE_HEADER];
    expect((await verifyRequest(secret, { ...request, path: "/n8n/overdue-loans" }, ts, sig, 1_000)).ok).toBe(false);
    expect((await verifyRequest(secret, { ...request, method: "PUT" }, ts, sig, 1_000)).ok).toBe(false);
    // Fields are newline-separated, so moving a character between path and body
    // changes the signed string (with "." as the separator these two would match).
    const dotted = await signRequest(secret, { method: "POST", path: "/x", body: ".y" }, 1_000);
    const moved = { method: "POST", path: "/x.", body: "y" };
    expect((await verifyRequest(secret, moved, dotted[TIMESTAMP_HEADER], dotted[SIGNATURE_HEADER], 1_000)).ok).toBe(false);
  });
});
