import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { displayName } from "./lib/auth";
import { signPayload } from "./lib/signing";

// Convex -> n8n "request notification" pipeline.
//
// 1. A loan mutation calls `enqueueLoanNotification` inside its own
//    transaction, so the notification is recorded if and only if the state
//    change commits (a transactional outbox).
// 2. The scheduler runs `deliver`, which POSTs a signed, minimal payload to the
//    n8n webhook.
// 3. Failures are retried with exponential backoff; after the last attempt the
//    event is marked `failed` and shows up on the admin automation panel.

export type NotificationType =
  | "loan.requested"
  | "loan.approved"
  | "loan.declined"
  | "loan.cancelled"
  | "loan.returned"
  | "loan.listing_removed";

export const RETRY_DELAYS_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;

export async function enqueueLoanNotification(
  ctx: MutationCtx,
  loanId: Id<"loans">,
  type: NotificationType,
  recipientId: Id<"users">,
) {
  // Each loan passes through each transition at most once, so this key makes
  // enqueueing idempotent even if a mutation is retried.
  const idempotencyKey = `notify:${loanId}:${type}`;
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (existing) return existing._id;

  const eventId = await ctx.db.insert("automationEvents", {
    kind: "notification",
    status: "pending",
    idempotencyKey,
    loanId,
    label: type,
    recipientId,
    attempts: 0,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { eventId });
  return eventId;
}

/**
 * Builds the webhook body. Data minimisation: the recipient's first name and
 * address, the other party's first name, and the loan facts. Nothing else.
 */
export const payloadFor = internalQuery({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending" || !event.loanId || !event.recipientId) {
      return null;
    }
    const loan = await ctx.db.get(event.loanId);
    const recipient = await ctx.db.get(event.recipientId);
    if (!loan || !recipient) return null;
    const counterpartId = recipient._id === loan.ownerId ? loan.borrowerId : loan.ownerId;
    const counterpart = await ctx.db.get(counterpartId);

    return {
      eventId: event._id as string,
      type: event.label,
      occurredAt: new Date(event._creationTime).toISOString(),
      recipient: { name: displayName(recipient), email: recipient.email ?? null },
      counterpartName: displayName(counterpart),
      loan: {
        id: loan._id as string,
        toolName: loan.toolName,
        startDate: loan.startDate,
        endDate: loan.endDate,
        status: loan.status,
      },
    };
  },
});

export const deliver = internalAction({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const payload = await ctx.runQuery(internal.notifications.payloadFor, { eventId });
    if (!payload) return; // already delivered, or the loan/user is gone

    const url = process.env.N8N_NOTIFY_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_TO_N8N_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.notifications.recordAttempt, {
        eventId,
        ok: false,
        retryable: false,
        detail: "n8n webhook not configured (N8N_NOTIFY_WEBHOOK_URL / LENDLOOP_TO_N8N_SECRET)",
      });
      return;
    }

    const body = JSON.stringify(payload);
    let ok = false;
    let retryable = true;
    let detail: string;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": payload.eventId,
          ...(await signPayload(secret, body)),
        },
        body,
        signal: controller.signal,
      });
      ok = response.ok;
      // 4xx (other than 408/429) means the request itself is wrong; retrying won't help.
      retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      detail = `n8n responded HTTP ${response.status}`;
    } catch (error) {
      detail = `delivery error: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      clearTimeout(timer);
    }

    const { retryInMs } = await ctx.runMutation(internal.notifications.recordAttempt, {
      eventId,
      ok,
      retryable,
      detail: detail.slice(0, 300),
    });
    if (retryInMs !== null) {
      await ctx.scheduler.runAfter(retryInMs, internal.notifications.deliver, { eventId });
    }
  },
});

export const recordAttempt = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    ok: v.boolean(),
    retryable: v.boolean(),
    detail: v.string(),
  },
  handler: async (ctx, { eventId, ok, retryable, detail }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending") return { retryInMs: null };

    const attempts = event.attempts + 1;
    if (ok) {
      await ctx.db.patch(eventId, { status: "succeeded", attempts, detail, updatedAt: Date.now() });
      return { retryInMs: null };
    }
    if (!retryable || attempts >= MAX_ATTEMPTS) {
      console.error(`notification ${eventId} failed permanently: ${detail}`);
      await ctx.db.patch(eventId, { status: "failed", attempts, detail, updatedAt: Date.now() });
      return { retryInMs: null };
    }
    await ctx.db.patch(eventId, { attempts, detail, updatedAt: Date.now() });
    return { retryInMs: RETRY_DELAYS_MS[attempts - 1] };
  },
});
