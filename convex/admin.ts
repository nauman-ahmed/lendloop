import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { displayName, fail, requireAdmin } from "./lib/auth";
import { todayIso } from "./lib/dates";

/** All loans, newest first, for the admin overview. */
export const listLoans = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(200);
    const today = todayIso();
    return Promise.all(
      loans.map(async (loan) => {
        const [owner, borrower, lastEvent] = await Promise.all([
          ctx.db.get(loan.ownerId),
          ctx.db.get(loan.borrowerId),
          ctx.db
            .query("automationEvents")
            .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
            .order("desc")
            .first(),
        ]);
        return {
          _id: loan._id,
          toolName: loan.toolName,
          lenderName: owner?.name ?? "Deleted user",
          borrowerName: borrower?.name ?? "Deleted user",
          startDate: loan.startDate,
          endDate: loan.endDate,
          status: loan.status,
          isOverdue: loan.status === "approved" && loan.endDate < today,
          lastActivity: lastEvent
            ? {
                kind: lastEvent.kind,
                label: lastEvent.label,
                status: lastEvent.status,
                at: lastEvent.updatedAt,
              }
            : null,
        };
      }),
    );
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(500);
    return Promise.all(
      users.map(async (user) => ({
        _id: user._id,
        name: user.name,
        role: user.role,
        trustedLender: user.trustedLender,
        listings: (
          await ctx.db
            .query("tools")
            .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
            .collect()
        ).length,
      })),
    );
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) fail("NOT_FOUND", "User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/** Failed automation runs, so nothing fails silently. */
export const automationFailures = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const kinds = ["notification", "reminder", "workflow_error"] as const;
    const perKind = await Promise.all(
      kinds.map((kind) =>
        ctx.db
          .query("automationEvents")
          .withIndex("by_kind_status", (q) => q.eq("kind", kind).eq("status", "failed"))
          .order("desc")
          .take(25),
      ),
    );
    const failed = perKind
      .flat()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 25);
    return failed.map((event) => ({
      _id: event._id,
      kind: event.kind,
      label: event.label,
      detail: event.detail ?? "",
      attempts: event.attempts,
      at: event.updatedAt,
    }));
  },
});

/**
 * Lists accounts so an operator can pick the right id for setRole:
 *   npx convex run admin:listAccounts
 */
export const listAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").order("desc").take(500);
    return users.map((user) => ({
      userId: user._id,
      name: user.name,
      role: user.role,
      createdAt: new Date(user._creationTime).toISOString(),
    }));
  },
});

/**
 * Role changes happen out-of-band, never from the browser:
 *   npx convex run admin:setRole '{"userId":"<id from listAccounts>","role":"admin"}'
 * Internal functions can only be invoked with deployment credentials. Accounts
 * are addressed by id, not email: an email is a user-supplied attribute, the
 * id is not, so the wrong account can't be promoted by a look-alike address.
 */
export const setRole = internalMutation({
  args: { userId: v.id("users"), role: v.union(v.literal("admin"), v.literal("user")) },
  handler: async (ctx, { userId, role }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error(`No user with id ${userId}. Sign in once first so the account exists.`);
    await ctx.db.patch(userId, { role });
    return `${displayName(user)} is now ${role}`;
  },
});
