import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { displayName } from "./lib/auth";
import { daysBetween } from "./lib/dates";

// Internal functions behind the signed HTTP endpoints that n8n calls (see
// http.ts). They are not reachable from the browser.

export const reminderKey = (loanId: string, asOf: string) => `reminder:${loanId}:${asOf}`;

/** Loans per page of the overdue query; n8n follows `nextCursor` for the rest. */
export const OVERDUE_PAGE_SIZE = 100;
export const NO_EMAIL_DETAIL = "No verified email on file, so no reminder could be sent.";

/**
 * One page of approved loans whose end date is before `asOf`, minus those that
 * already have a successful reminder for `asOf`. Re-running the workflow the
 * same day therefore never reminds a borrower twice.
 *
 * Paging walks the index itself, so loans skipped as already reminded never
 * block the ones after them. Loans whose borrower has no verified email are
 * returned separately (ids only) so the caller can record them as failed.
 */
export const overdueLoans = internalQuery({
  args: { asOf: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { asOf, cursor }) => {
    const page = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", asOf))
      .paginate({ cursor, numItems: OVERDUE_PAGE_SIZE });

    const loans = [];
    const undeliverable: { loanId: Id<"loans">; reminderKey: string }[] = [];
    for (const loan of page.page) {
      const key = reminderKey(loan._id, asOf);
      const existing = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
        .unique();
      if (existing?.status === "succeeded") continue;

      const borrower = await ctx.db.get(loan.borrowerId);
      if (!borrower?.email) {
        undeliverable.push({ loanId: loan._id, reminderKey: key });
        continue;
      }
      loans.push({
        loanId: loan._id as string,
        reminderKey: key,
        borrowerName: displayName(borrower),
        borrowerEmail: borrower.email,
        toolName: loan.toolName,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, asOf),
      });
    }
    return { loans, undeliverable, nextCursor: page.isDone ? null : page.continueCursor };
  },
});

type ReminderOutcome = { result: "created" | "updated" | "duplicate" | "rejected" };

/**
 * Idempotent upsert keyed by `reminderKey`. A retried write-back for a reminder
 * that already succeeded is a no-op, so duplicates are impossible.
 */
async function upsertReminder(
  ctx: MutationCtx,
  {
    loanId,
    reminderKey: key,
    status,
    channel,
    detail,
  }: {
    loanId: Id<"loans">;
    reminderKey: string;
    status: "sent" | "failed";
    channel: string;
    detail?: string;
  },
): Promise<ReminderOutcome> {
  // The key must belong to this loan, so a caller cannot write to another loan's record.
  if (!key.startsWith(`reminder:${loanId}:`)) return { result: "rejected" };
  const loan = await ctx.db.get(loanId);
  if (!loan) return { result: "rejected" };

  const nextStatus = status === "sent" ? ("succeeded" as const) : ("failed" as const);
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
    .unique();

  if (existing?.status === "succeeded") return { result: "duplicate" };
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: nextStatus,
      attempts: existing.attempts + 1,
      detail,
      updatedAt: Date.now(),
    });
    return { result: "updated" };
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
  return { result: "created" };
}

export const recordReminder = internalMutation({
  args: {
    loanId: v.id("loans"),
    reminderKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    channel: v.string(),
    detail: v.optional(v.string()),
  },
  handler: upsertReminder,
});

/**
 * Overdue loans that can't be reminded because the borrower has no verified
 * email. Recorded as failed reminders so they show on the admin page and the
 * loan card instead of being skipped silently.
 */
export const recordUndeliverableReminders = internalMutation({
  args: {
    reminders: v.array(v.object({ loanId: v.id("loans"), reminderKey: v.string() })),
  },
  handler: async (ctx, { reminders }) => {
    for (const { loanId, reminderKey: key } of reminders) {
      await upsertReminder(ctx, {
        loanId,
        reminderKey: key,
        status: "failed",
        channel: "none",
        detail: NO_EMAIL_DETAIL,
      });
    }
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
