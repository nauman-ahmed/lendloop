import { httpRouter } from "convex/server";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { isIsoDate, todayIso } from "./lib/dates";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "./lib/signing";

// Endpoints n8n calls. Every request must carry a valid HMAC signature made
// with N8N_TO_LENDLOOP_SECRET (a different secret from the outbound one, so a
// leak in one direction does not compromise the other).

const http = httpRouter();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function signedEndpoint<T>(
  schema: z.ZodType<T>,
  handler: (ctx: ActionCtx, body: T) => Promise<Response>,
) {
  return httpAction(async (ctx, request) => {
    const secret = process.env.N8N_TO_LENDLOOP_SECRET;
    if (!secret) {
      console.error("N8N_TO_LENDLOOP_SECRET is not set");
      return json(503, { error: "not configured" });
    }
    const rawBody = await request.text();
    const verdict = await verifySignature(
      secret,
      rawBody,
      request.headers.get(TIMESTAMP_HEADER),
      request.headers.get(SIGNATURE_HEADER),
    );
    if (!verdict.ok) {
      // Log the reason for operators, but don't tell the caller which check failed.
      console.warn(`rejected n8n request to ${new URL(request.url).pathname}: ${verdict.reason}`);
      return json(401, { error: "invalid signature" });
    }

    let parsed: T;
    try {
      parsed = schema.parse(JSON.parse(rawBody || "{}"));
    } catch {
      return json(400, { error: "invalid body" });
    }
    return handler(ctx, parsed);
  });
}

const isoDate = z.string().refine(isIsoDate, "expected YYYY-MM-DD");

http.route({
  path: "/n8n/overdue-loans",
  method: "POST",
  handler: signedEndpoint(z.object({ asOf: isoDate.optional() }), async (ctx, body) => {
    const asOf = body.asOf ?? todayIso();
    const loans = await ctx.runQuery(internal.automation.overdueLoans, { asOf });
    return json(200, { asOf, loans });
  }),
});

http.route({
  path: "/n8n/reminders",
  method: "POST",
  handler: signedEndpoint(
    z.object({
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
  ),
});

http.route({
  path: "/n8n/workflow-errors",
  method: "POST",
  handler: signedEndpoint(
    z.object({
      executionId: z.string().min(1).max(64),
      workflowName: z.string().min(1).max(100),
      nodeName: z.string().max(100).optional(),
      message: z.string().max(1000),
    }),
    async (ctx, body) => json(200, await ctx.runMutation(internal.automation.recordWorkflowError, body)),
  ),
});

export default http;
