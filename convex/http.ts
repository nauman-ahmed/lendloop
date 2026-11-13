import { httpRouter } from "convex/server";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { isIsoDate, todayIso } from "./lib/dates";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyRequest } from "./lib/signing";

// Endpoints n8n calls. Every request must carry a valid HMAC signature made
// with N8N_TO_LENDLOOP_SECRET (a different secret from the outbound one, so a
// leak in one direction does not compromise the other). The signature covers
// the method and path, so a request signed for one endpoint fails on the others.

const http = httpRouter();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Registers a POST endpoint that only runs `handler` for a correctly signed
 * request whose body matches `schema`. Schemas are strict: unknown keys are
 * rejected rather than silently dropped.
 */
function signedRoute<T>(
  path: string,
  schema: z.ZodType<T>,
  handler: (ctx: ActionCtx, body: T) => Promise<Response>,
) {
  http.route({
    path,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const secret = process.env.N8N_TO_LENDLOOP_SECRET;
      if (!secret) {
        console.error("N8N_TO_LENDLOOP_SECRET is not set");
        return json(503, { error: "not configured" });
      }
      const rawBody = await request.text();
      const verdict = await verifyRequest(
        secret,
        { method: "POST", path, body: rawBody },
        request.headers.get(TIMESTAMP_HEADER),
        request.headers.get(SIGNATURE_HEADER),
      );
      if (!verdict.ok) {
        // Log the reason for operators, but don't tell the caller which check failed.
        console.warn(`rejected n8n request to ${path}: ${verdict.reason}`);
        return json(401, { error: "invalid signature" });
      }

      let parsed: T;
      try {
        parsed = schema.parse(JSON.parse(rawBody || "{}"));
      } catch {
        return json(400, { error: "invalid body" });
      }
      return handler(ctx, parsed);
    }),
  });
}

const isoDate = z.string().refine(isIsoDate, "expected YYYY-MM-DD");

/**
 * One page of overdue loans. n8n loops while `nextCursor` is non-null, passing
 * back the same `asOf`, so no loan is dropped however many are overdue.
 * Loans whose borrower has no verified email can't be reminded; they are
 * recorded as failed reminders here so admins see them instead of n8n never
 * hearing about them.
 */
signedRoute(
  "/n8n/overdue-loans",
  z
    .strictObject({
      asOf: isoDate.optional(),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .refine((body) => !body.cursor || body.asOf, "a cursor must be sent with its asOf"),
  async (ctx, body) => {
    const asOf = body.asOf ?? todayIso();
    const page = await ctx.runQuery(internal.automation.overdueLoans, {
      asOf,
      cursor: body.cursor ?? null,
    });
    if (page.undeliverable.length > 0) {
      await ctx.runMutation(internal.automation.recordUndeliverableReminders, {
        reminders: page.undeliverable,
      });
    }
    return json(200, {
      asOf,
      loans: page.loans,
      undeliverable: page.undeliverable.length,
      nextCursor: page.nextCursor,
    });
  },
);

signedRoute(
  "/n8n/reminders",
  z.strictObject({
    loanId: z.string().min(1).max(64),
    reminderKey: z.string().min(1).max(128),
    status: z.enum(["sent", "failed"]),
    channel: z.string().min(1).max(32),
    detail: z.string().max(300).optional(),
  }),
  async (ctx, body) => {
    const loanId = await ctx.runQuery(internal.automation.normalizeLoanId, { id: body.loanId });
    if (!loanId) return json(404, { error: "unknown loan" });
    const outcome = await ctx.runMutation(internal.automation.recordReminder, {
      ...body,
      loanId: loanId as Id<"loans">,
    });
    return json(outcome.result === "rejected" ? 422 : 200, outcome);
  },
);

signedRoute(
  "/n8n/workflow-errors",
  z.strictObject({
    executionId: z.string().min(1).max(64),
    workflowName: z.string().min(1).max(100),
    nodeName: z.string().max(100).optional(),
    message: z.string().max(1000),
  }),
  async (ctx, body) => json(200, await ctx.runMutation(internal.automation.recordWorkflowError, body)),
);

export default http;
