import { describe, expect, test } from "vitest";
import { isIsoDate, rangesOverlap, validateLoanRange } from "./dates";
import { signPayload, verifySignature, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./signing";
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
  const body = JSON.stringify({ hello: "world" });

  test("round-trips", async () => {
    const headers = await signPayload(secret, body, 1_000);
    const result = await verifySignature(secret, body, headers[TIMESTAMP_HEADER], headers[SIGNATURE_HEADER], 1_010);
    expect(result).toEqual({ ok: true });
  });

  test("rejects tampering, wrong secret, staleness and missing headers", async () => {
    const headers = await signPayload(secret, body, 1_000);
    const ts = headers[TIMESTAMP_HEADER];
    const sig = headers[SIGNATURE_HEADER];
    expect((await verifySignature(secret, body + " ", ts, sig, 1_000)).ok).toBe(false);
    expect((await verifySignature("other", body, ts, sig, 1_000)).ok).toBe(false);
    expect((await verifySignature(secret, body, ts, sig, 1_000 + 301)).ok).toBe(false);
    expect((await verifySignature(secret, body, null, sig, 1_000)).ok).toBe(false);
    // The timestamp is part of the MAC, so it can't be swapped for a fresh one.
    expect((await verifySignature(secret, body, "1200", sig, 1_200)).ok).toBe(false);
  });
});
