import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { displayName } from "./lib/auth";
import { daysBetween } from "./lib/dates";

// Internal functions behind the signed HTTP endpoints that n8n calls (see
// http.ts). They are not reachable from the browser.

export const reminderKey = (loanId: string, asOf: string) => `reminder:${loanId}:${asOf}`;

/**
 * Approved loans whose end date is before `asOf`, minus those that already have
 * a successful reminder for `asOf`. Re-running the workflow the same day
 * therefore never reminds a borrower twice.
 */
export const overdueLoans = internalQuery({
  args: { asOf: v.string() },
  handler: async (ctx, { asOf }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", asOf))
      .take(500);

    const result = [];
    for (const loan of loans) {
      const key = reminderKey(loan._id, asOf);
      const existing = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
        .unique();
      if (existing?.status === "succeeded") continue;

      const borrower = await ctx.db.get(loan.borrowerId);
      if (!borrower?.email) continue; // nowhere to send it
      result.push({
        loanId: loan._id as string,
        reminderKey: key,
        borrowerName: displayName(borrower),
        borrowerEmail: borrower.email,
        toolName: loan.toolName,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, asOf),
      });
    }
    return result;
  },
});

/**
 * Idempotent upsert keyed by `reminderKey`. A retried write-back for a reminder
 * that already succeeded is a no-op, so duplicates are impossible.
 */
export const recordReminder = internalMutation({
  args: {
    loanId: v.id("loans"),
    reminderKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    channel: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { loanId, reminderKey: key, status, channel, detail }) => {
    // The key must belong to this loan, so a caller cannot write to another loan's record.
    if (!key.startsWith(`reminder:${loanId}:`)) return { result: "rejected" as const };
    const loan = await ctx.db.get(loanId);
    if (!loan) return { result: "rejected" as const };

    const nextStatus = status === "sent" ? ("succeeded" as const) : ("failed" as const);
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
      .unique();

    if (existing?.status === "succeeded") return { result: "duplicate" as const };
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: nextStatus,
        attempts: existing.attempts + 1,
        detail,
        updatedAt: Date.now(),
      });
      return { result: "updated" as const };
    }
    await ctx.db.insert("automationEvents", {
      kind: "reminder",
      status: nextStatus,
      idempotencyKey: key,
      loanId,
      label: `overdue_reminder:${channel}`,
      recipientId: loan.borrowerId,
      attempts: 1,
      detail,
      updatedAt: Date.now(),
    });
    return { result: "created" as const };
  },
});

/** Called by the n8n error workflow; deduplicated per failed execution. */
export const recordWorkflowError = internalMutation({
  args: {
    executionId: v.string(),
    workflowName: v.string(),
    nodeName: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, { executionId, workflowName, nodeName, message }) => {
    const key = `workflow_error:${executionId}`;
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
      .unique();
    if (existing) return { result: "duplicate" as const };
    await ctx.db.insert("automationEvents", {
      kind: "workflow_error",
      status: "failed",
      idempotencyKey: key,
      label: workflowName,
      attempts: 1,
      detail: `${nodeName ? `[${nodeName}] ` : ""}${message}`.slice(0, 300),
      updatedAt: Date.now(),
    });
    return { result: "created" as const };
  },
});

/** Turns an untrusted string from n8n into a loan id, or null if it isn't one. */
export const normalizeLoanId = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => ctx.db.normalizeId("loans", id),
});
