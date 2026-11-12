import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { displayName, fail, requireViewer } from "./lib/auth";
import { rangesOverlap, todayIso, validateLoanRange } from "./lib/dates";
import { enqueueLoanNotification } from "./notifications";

// Loan lifecycle:
//
//   requested --approve (lender)--> approved --markReturned (lender)--> returned
//       |--decline (lender)--> declined
//       '--cancel (borrower)--> cancelled
//
// Every transition checks *who* is acting against the loan's own ownerId /
// borrowerId, so users can only act on loans that involve them.

const MAX_LOANS = 100;

async function loadLoan(ctx: QueryCtx, loanId: Id<"loans">) {
  const loan = await ctx.db.get(loanId);
  if (!loan) fail("NOT_FOUND", "That request no longer exists.");
  return loan;
}

function assertStatus(loan: Doc<"loans">, expected: Doc<"loans">["status"]) {
  if (loan.status !== expected) {
    fail("CONFLICT", `This request is already ${loan.status}.`);
  }
}

async function approvedLoansFor(ctx: QueryCtx, toolId: Id<"tools">) {
  return ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) fail("NOT_FOUND", "That listing no longer exists.");
    if (tool.ownerId === viewer._id) fail("INVALID_INPUT", "You can't borrow your own tool.");

    const rangeError = validateLoanRange(startDate, endDate);
    if (rangeError) fail("INVALID_INPUT", rangeError);

    const range = { startDate, endDate };
    if ((await approvedLoansFor(ctx, toolId)).some((loan) => rangesOverlap(loan, range))) {
      fail("CONFLICT", "The tool is already booked for some of those dates.");
    }
    const myPending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "requested"))
      .filter((q) => q.eq(q.field("borrowerId"), viewer._id))
      .collect();
    if (myPending.some((loan) => rangesOverlap(loan, range))) {
      fail("CONFLICT", "You already have a pending request for those dates.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId,
      toolName: tool.name,
      ownerId: tool.ownerId,
      borrowerId: viewer._id,
      startDate,
      endDate,
      status: "requested",
    });
    await enqueueLoanNotification(ctx, loanId, "loan.requested", tool.ownerId);
    return loanId;
  },
});

export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await loadLoan(ctx, loanId);
    if (loan.ownerId !== viewer._id) fail("FORBIDDEN", "Only the lender can approve this.");
    assertStatus(loan, "requested");
    if (loan.endDate < todayIso()) fail("CONFLICT", "These dates have already passed.");
    if ((await approvedLoansFor(ctx, loan.toolId)).some((other) => rangesOverlap(other, loan))) {
      fail("CONFLICT", "You've already approved another loan for overlapping dates.");
    }

    const now = Date.now();
    await ctx.db.patch(loanId, { status: "approved", decidedAt: now });
    await enqueueLoanNotification(ctx, loanId, "loan.approved", loan.borrowerId);

    // A tool can only be in one place: decline competing requests for the same days.
    const competing = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", loan.toolId).eq("status", "requested"))
      .collect();
    for (const other of competing) {
      if (other._id === loanId || !rangesOverlap(other, loan)) continue;
      await ctx.db.patch(other._id, { status: "declined", decidedAt: now });
      await enqueueLoanNotification(ctx, other._id, "loan.declined", other.borrowerId);
    }
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await loadLoan(ctx, loanId);
    if (loan.ownerId !== viewer._id) fail("FORBIDDEN", "Only the lender can decline this.");
    assertStatus(loan, "requested");
    await ctx.db.patch(loanId, { status: "declined", decidedAt: Date.now() });
    await enqueueLoanNotification(ctx, loanId, "loan.declined", loan.borrowerId);
  },
});

export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await loadLoan(ctx, loanId);
    if (loan.borrowerId !== viewer._id) fail("FORBIDDEN", "Only the borrower can cancel this.");
    assertStatus(loan, "requested");
    await ctx.db.patch(loanId, { status: "cancelled", decidedAt: Date.now() });
    await enqueueLoanNotification(ctx, loanId, "loan.cancelled", loan.ownerId);
  },
});

/** The lender confirms they have their tool back. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await loadLoan(ctx, loanId);
    if (loan.ownerId !== viewer._id) {
      fail("FORBIDDEN", "Only the lender can confirm the tool was returned.");
    }
    assertStatus(loan, "approved");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await enqueueLoanNotification(ctx, loanId, "loan.returned", loan.borrowerId);
  },
});

// ---------------------------------------------------------------------------
// Views

export type LoanView = Awaited<ReturnType<typeof toView>>;

async function recentActivity(ctx: QueryCtx | MutationCtx, loanId: Id<"loans">) {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .order("desc")
    .take(5);
  return events.map((event) => ({
    kind: event.kind,
    label: event.label,
    status: event.status,
    at: event.updatedAt,
  }));
}

export async function toView(ctx: QueryCtx, loan: Doc<"loans">, viewerId: Id<"users"> | null) {
  const counterpartId = loan.borrowerId === viewerId ? loan.ownerId : loan.borrowerId;
  const counterpart = await ctx.db.get(counterpartId);
  return {
    _id: loan._id,
    toolId: loan.toolId,
    toolName: loan.toolName,
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    counterpartName: displayName(counterpart),
    counterpartTrusted: counterpart?.trustedLender ?? false,
    isOverdue: loan.status === "approved" && loan.endDate < todayIso(),
    activity: await recentActivity(ctx, loan._id),
  };
}

/** Requests I made as a borrower. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .order("desc")
      .take(MAX_LOANS);
    return Promise.all(loans.map((loan) => toView(ctx, loan, viewer._id)));
  },
});

/** Requests other people made for my tools. */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .take(MAX_LOANS);
    return Promise.all(loans.map((loan) => toView(ctx, loan, viewer._id)));
  },
});
