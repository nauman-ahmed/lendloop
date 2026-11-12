/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { signPayload, verifySignature, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./lib/signing";

const modules = import.meta.glob("./**/*.ts");
const INBOUND_SECRET = "n8n-to-lendloop-test-secret";
const OUTBOUND_SECRET = "lendloop-to-n8n-test-secret";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
  process.env.N8N_TO_LENDLOOP_SECRET = INBOUND_SECRET;
  process.env.LENDLOOP_TO_N8N_SECRET = OUTBOUND_SECRET;
  process.env.N8N_NOTIFY_WEBHOOK_URL = "https://n8n.test/webhook/lendloop-loan-events";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  const as = async (name: string, email: string) => {
    const client = t.withIdentity({
      tokenIdentifier: `test|${name}`,
      subject: name,
      name,
      email,
      emailVerified: true,
    });
    const id = await client.mutation(api.users.ensureViewer, {});
    return Object.assign(client, { id });
  };
  const lender = await as("Lena Lender", "lena@example.com");
  const borrower = await as("Bo Borrower", "bo@example.com");
  const other = await as("Ola Other", "ola@example.com");
  const admin = await as("Ada Admin", "ada@example.com");
  await t.mutation(internal.admin.setRole, { userId: admin.id, role: "admin" });

  const toolId = await lender.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power_tools",
    condition: "good",
    description: "18V",
  });
  return { t, lender, borrower, other, admin, toolId };
}

const expectError = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toMatchObject({ data: expect.objectContaining({ code }) });
};

describe("public catalogue", () => {
  test("exposes only name and category, no owner details", async () => {
    const { t } = await setup();
    const tools = await t.query(api.tools.listPublic, {});
    expect(tools).toHaveLength(1);
    expect(Object.keys(tools[0]).sort()).toEqual(["category", "id", "name"]);
  });

  test("signed-out callers cannot use authenticated functions", async () => {
    const { t, toolId } = await setup();
    await expectError(t.query(api.tools.list, {}), "UNAUTHENTICATED");
    await expectError(
      t.mutation(api.loans.request, { toolId, startDate: "2026-06-11", endDate: "2026-06-12" }),
      "UNAUTHENTICATED",
    );
  });
});

describe("listing ownership", () => {
  test("users cannot edit or delete someone else's listing", async () => {
    const { other, toolId } = await setup();
    await expectError(
      other.mutation(api.tools.update, {
        toolId,
        name: "Mine now",
        category: "garden",
        condition: "fair",
        description: "",
      }),
      "FORBIDDEN",
    );
    await expectError(other.mutation(api.tools.remove, { toolId }), "FORBIDDEN");
  });

  test("admins can remove any listing", async () => {
    const { t, admin, toolId } = await setup();
    await admin.mutation(api.tools.remove, { toolId });
    expect(await t.query(api.tools.listPublic, {})).toHaveLength(0);
  });

  test("owners cannot delete a tool that is out on loan", async () => {
    const { lender, borrower, toolId } = await setup();
    const loanId = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: "2026-06-10",
      endDate: "2026-06-12",
    });
    await lender.mutation(api.loans.approve, { loanId });
    await expectError(lender.mutation(api.tools.remove, { toolId }), "CONFLICT");
  });
});

describe("roles", () => {
  test("ensureViewer never changes role, so users cannot self-promote", async () => {
    // (Role changes go through internal.admin.setRole, which clients cannot call.)
    const { other } = await setup();
    await other.mutation(api.users.ensureViewer, {});
    const me = await other.query(api.users.me, {});
    expect(me?.role).toBe("user");
  });

  test("admin-only functions reject regular users", async () => {
    const { other } = await setup();
    await expectError(other.query(api.admin.listLoans, {}), "FORBIDDEN");
    await expectError(other.query(api.admin.automationFailures, {}), "FORBIDDEN");
    await expectError(
      other.mutation(api.admin.setTrustedLender, { userId: other.id, trusted: true }),
      "FORBIDDEN",
    );
  });

  test("admins can mark a Trusted Lender, which shows on listings", async () => {
    const { admin, lender, borrower } = await setup();
    await admin.mutation(api.admin.setTrustedLender, { userId: lender.id, trusted: true });
    const [tool] = await borrower.query(api.tools.list, {});
    expect(tool.ownerTrusted).toBe(true);
  });
});

describe("loan lifecycle", () => {
  test("cannot borrow your own tool or book invalid dates", async () => {
    const { lender, borrower, toolId } = await setup();
    await expectError(
      lender.mutation(api.loans.request, { toolId, startDate: "2026-06-11", endDate: "2026-06-12" }),
      "INVALID_INPUT",
    );
    await expectError(
      borrower.mutation(api.loans.request, { toolId, startDate: "2026-06-01", endDate: "2026-06-12" }),
      "INVALID_INPUT",
    );
  });

  test("only the lender can approve, decline or mark returned; only the borrower can cancel", async () => {
    const { lender, borrower, other, toolId } = await setup();
    const loanId = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: "2026-06-11",
      endDate: "2026-06-12",
    });

    await expectError(borrower.mutation(api.loans.approve, { loanId }), "FORBIDDEN");
    await expectError(other.mutation(api.loans.decline, { loanId }), "FORBIDDEN");
    await expectError(lender.mutation(api.loans.cancel, { loanId }), "FORBIDDEN");

    await lender.mutation(api.loans.approve, { loanId });
    await expectError(borrower.mutation(api.loans.markReturned, { loanId }), "FORBIDDEN");
    await expectError(lender.mutation(api.loans.approve, { loanId }), "CONFLICT");
    await lender.mutation(api.loans.markReturned, { loanId });

    const [view] = await borrower.query(api.loans.myRequests, {});
    expect(view.status).toBe("returned");
  });

  test("approving declines overlapping requests and blocks double booking", async () => {
    const { lender, borrower, other, toolId } = await setup();
    const first = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: "2026-06-11",
      endDate: "2026-06-13",
    });
    const overlapping = await other.mutation(api.loans.request, {
      toolId,
      startDate: "2026-06-13",
      endDate: "2026-06-14",
    });
    const later = await other.mutation(api.loans.request, {
      toolId,
      startDate: "2026-06-20",
      endDate: "2026-06-21",
    });
    await lender.mutation(api.loans.approve, { loanId: first });

    const statuses = Object.fromEntries(
      (await other.query(api.loans.myRequests, {})).map((l) => [l._id, l.status]),
    );
    expect(statuses[overlapping]).toBe("declined");
    expect(statuses[later]).toBe("requested");

    await expectError(
      other.mutation(api.loans.request, { toolId, startDate: "2026-06-12", endDate: "2026-06-12" }),
      "CONFLICT",
    );
  });

  test("loan views never expose the other party's email", async () => {
    const { lender, borrower, toolId } = await setup();
    await borrower.mutation(api.loans.request, { toolId, startDate: "2026-06-11", endDate: "2026-06-12" });
    const [incoming] = await lender.query(api.loans.incoming, {});
    expect(JSON.stringify(incoming)).not.toContain("@example.com");
    expect(incoming.counterpartName).toBe("Bo"); // first name only
  });
});

describe("email verification (LL-04)", () => {
  test("an email is only stored when the token says it is verified", async () => {
    const { t } = await setup();
    const cases = [
      { subject: "unverified", emailVerified: false },
      { subject: "no-claim", emailVerified: undefined },
      { subject: "verified", emailVerified: true },
    ];
    for (const { subject, emailVerified } of cases) {
      const client = t.withIdentity({
        tokenIdentifier: `test|${subject}`,
        subject,
        name: subject,
        email: `${subject}@example.com`,
        ...(emailVerified === undefined ? {} : { emailVerified }),
      });
      const id = await client.mutation(api.users.ensureViewer, {});
      const user = await t.run((ctx) => ctx.db.get(id));
      expect(user?.email).toBe(emailVerified === true ? `${subject}@example.com` : undefined);
    }
  });

  test("an account that loses verification stops receiving mail", async () => {
    const { t } = await setup();
    const verified = t.withIdentity({ tokenIdentifier: "test|flip", subject: "flip", name: "Flip", email: "flip@example.com", emailVerified: true });
    const id = await verified.mutation(api.users.ensureViewer, {});
    const unverified = t.withIdentity({ tokenIdentifier: "test|flip", subject: "flip", name: "Flip", email: "attacker@example.com", emailVerified: false });
    await unverified.mutation(api.users.ensureViewer, {});
    expect((await t.run((ctx) => ctx.db.get(id)))?.email).toBeUndefined();
  });

  test("roles are granted by user id, not by email", async () => {
    const { t, other } = await setup();
    const accounts = await t.query(internal.admin.listAccounts, {});
    expect(accounts.map((a) => a.userId)).toContain(other.id);
    await t.mutation(internal.admin.setRole, { userId: other.id, role: "admin" });
    expect((await other.query(api.users.me, {}))?.role).toBe("admin");
  });
});

describe("abuse limits (LL-03)", () => {
  type Client = Awaited<ReturnType<typeof setup>>["lender"];

  async function addTools(owner: Client, count: number) {
    const ids: Id<"tools">[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(
        await owner.mutation(api.tools.create, {
          name: `Tool ${i}`,
          category: "other",
          condition: "good",
          description: "",
        }),
      );
    }
    return ids;
  }

  /** 11 tools from two lenders, staying under the hourly listing limit. */
  async function elevenTools({ lender, other, toolId }: Awaited<ReturnType<typeof setup>>) {
    return [toolId, ...(await addTools(lender, 9)), ...(await addTools(other, 1))];
  }

  const borrowTomorrow = (client: Client, toolId: Id<"tools">) =>
    client.mutation(api.loans.request, { toolId, startDate: "2026-06-11", endDate: "2026-06-11" });

  test("a borrower can send at most 10 requests per hour", async () => {
    const ctx = await setup();
    const { borrower } = ctx;
    const tools = await elevenTools(ctx);
    for (const toolId of tools.slice(0, 10)) {
      const loanId = await borrowTomorrow(borrower, toolId);
      await borrower.mutation(api.loans.cancel, { loanId }); // isolate the hourly limit
    }
    await expectError(borrowTomorrow(borrower, tools[10]), "RATE_LIMITED");

    vi.setSystemTime(new Date("2026-06-10T13:01:00Z"));
    await borrowTomorrow(borrower, tools[10]);
  });

  test("a borrower can have at most 10 unanswered requests", async () => {
    const ctx = await setup();
    const { borrower } = ctx;
    const tools = await elevenTools(ctx);
    for (const [i, toolId] of tools.slice(0, 10).entries()) {
      if (i === 5) vi.setSystemTime(new Date("2026-06-10T13:01:00Z")); // stay under the hourly limit
      await borrowTomorrow(borrower, toolId);
    }
    await expectError(borrowTomorrow(borrower, tools[10]), "RATE_LIMITED");

    const [newest] = await borrower.query(api.loans.myRequests, {});
    await borrower.mutation(api.loans.cancel, { loanId: newest._id });
    await borrowTomorrow(borrower, tools[10]);
  });

  test("one tool can have at most 15 pending requests, even from many accounts", async () => {
    const { t, toolId } = await setup();
    const borrowers = [];
    for (let i = 0; i < 16; i++) {
      const client = t.withIdentity({ tokenIdentifier: `test|b${i}`, subject: `b${i}`, name: `B ${i}` });
      await client.mutation(api.users.ensureViewer, {});
      borrowers.push(client);
    }
    for (const client of borrowers.slice(0, 15)) await borrowTomorrow(client as Client, toolId);
    await expectError(borrowTomorrow(borrowers[15] as Client, toolId), "RATE_LIMITED");
  });

  test("a user can list at most 10 tools per hour and 50 in total", async () => {
    const { other } = await setup();
    await addTools(other, 10);
    await expectError(addTools(other, 1), "RATE_LIMITED");

    for (let hour = 1; hour <= 4; hour++) {
      vi.setSystemTime(new Date(Date.parse("2026-06-10T12:00:00Z") + hour * 61 * 60 * 1000));
      await addTools(other, 10);
    }
    vi.setSystemTime(new Date("2026-06-10T20:00:00Z"));
    await expectError(addTools(other, 1), "RATE_LIMITED"); // 50 listings, hourly window clear
  });
});

describe("request notifications (Convex -> n8n)", () => {
  test("each transition enqueues exactly one signed, minimal webhook call", async () => {
    const { t, lender, borrower, toolId } = await setup();
    const calls: { body: string; headers: Headers }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push({ body: init.body as string, headers: new Headers(init.headers) });
        return new Response("ok", { status: 200 });
      }),
    );

    const loanId = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: "2026-06-11",
      endDate: "2026-06-12",
    });
    await lender.mutation(api.loans.approve, { loanId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls.map((c) => JSON.parse(c.body).type)).toEqual(["loan.requested", "loan.approved"]);
    const approved = JSON.parse(calls[1].body);
    expect(approved.recipient).toEqual({ name: "Bo", email: "bo@example.com" });
    expect(approved.counterpartName).toBe("Lena");
    expect(calls[1].body).not.toContain("lena@example.com");

    const verdict = await verifySignature(
      OUTBOUND_SECRET,
      calls[1].body,
      calls[1].headers.get(TIMESTAMP_HEADER),
      calls[1].headers.get(SIGNATURE_HEADER),
    );
    expect(verdict.ok).toBe(true);

    const [view] = await borrower.query(api.loans.myRequests, {});
    expect(view.activity.map((a) => a.status)).toEqual(["succeeded", "succeeded"]);
  });

  test("failed deliveries are retried with backoff, then marked failed for admins", async () => {
    const { t, admin, borrower, toolId } = await setup();
    const fetchMock = vi.fn(async () => new Response("boom", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await borrower.mutation(api.loans.request, { toolId, startDate: "2026-06-11", endDate: "2026-06-12" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const failures = await admin.query(api.admin.automationFailures, {});
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ kind: "notification", attempts: 5, detail: "n8n responded HTTP 503" });
  });

  test("4xx responses are not retried", async () => {
    const { t, borrower, toolId } = await setup();
    const fetchMock = vi.fn(async () => new Response("bad signature", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await borrower.mutation(api.loans.request, { toolId, startDate: "2026-06-11", endDate: "2026-06-12" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("overdue reminders (n8n -> Convex)", () => {
  async function signedPost(t: ReturnType<typeof convexTest>, path: string, body: unknown, secret = INBOUND_SECRET) {
    const raw = JSON.stringify(body);
    return t.fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await signPayload(secret, raw)) },
      body: raw,
    });
  }

  async function overdueLoan() {
    const ctx = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    const loanId: Id<"loans"> = await ctx.borrower.mutation(api.loans.request, {
      toolId: ctx.toolId,
      startDate: "2026-06-10",
      endDate: "2026-06-12",
    });
    await ctx.lender.mutation(api.loans.approve, { loanId });
    vi.setSystemTime(new Date("2026-06-15T09:00:00Z"));
    return { ...ctx, loanId };
  }

  test("rejects unsigned or wrongly signed requests", async () => {
    const { t } = await setup();
    const unsigned = await t.fetch("/n8n/overdue-loans", { method: "POST", body: "{}" });
    expect(unsigned.status).toBe(401);
    const wrong = await signedPost(t, "/n8n/overdue-loans", {}, "not-the-secret");
    expect(wrong.status).toBe(401);
  });

  test("lists overdue loans with only the fields a reminder needs", async () => {
    const { t, loanId } = await overdueLoan();
    const response = await signedPost(t, "/n8n/overdue-loans", {});
    expect(response.status).toBe(200);
    const { asOf, loans } = await response.json();
    expect(asOf).toBe("2026-06-15");
    expect(loans).toEqual([
      {
        loanId,
        reminderKey: `reminder:${loanId}:2026-06-15`,
        borrowerName: "Bo",
        borrowerEmail: "bo@example.com",
        toolName: "Cordless drill",
        endDate: "2026-06-12",
        daysOverdue: 3,
      },
    ]);
  });

  test("reminder write-back is idempotent and hides the loan for the rest of the day", async () => {
    const { t, borrower, loanId } = await overdueLoan();
    const reminder = {
      loanId,
      reminderKey: `reminder:${loanId}:2026-06-15`,
      status: "sent",
      channel: "mock",
    };

    const first = await signedPost(t, "/n8n/reminders", reminder);
    expect(await first.json()).toEqual({ result: "created" });
    const retry = await signedPost(t, "/n8n/reminders", reminder);
    expect(await retry.json()).toEqual({ result: "duplicate" });

    const { loans } = await (await signedPost(t, "/n8n/overdue-loans", {})).json();
    expect(loans).toEqual([]);

    const [view] = await borrower.query(api.loans.myRequests, {});
    expect(view.isOverdue).toBe(true);
    expect(view.activity.filter((a) => a.kind === "reminder")).toHaveLength(1);
  });

  test("a reminder key cannot be written against a different loan", async () => {
    const { t, loanId, toolId, other } = await overdueLoan();
    const otherLoan = await other.mutation(api.loans.request, {
      toolId,
      startDate: "2026-06-20",
      endDate: "2026-06-21",
    });
    const response = await signedPost(t, "/n8n/reminders", {
      loanId: otherLoan,
      reminderKey: `reminder:${loanId}:2026-06-15`,
      status: "sent",
      channel: "mock",
    });
    expect(response.status).toBe(422);
  });

  test("workflow errors are recorded once per execution", async () => {
    const { t, admin } = await setup();
    const error = { executionId: "42", workflowName: "LendLoop: overdue reminders", message: "timeout" };
    expect(await (await signedPost(t, "/n8n/workflow-errors", error)).json()).toEqual({ result: "created" });
    expect(await (await signedPost(t, "/n8n/workflow-errors", error)).json()).toEqual({ result: "duplicate" });
    expect(await admin.query(api.admin.automationFailures, {})).toHaveLength(1);
  });
});
