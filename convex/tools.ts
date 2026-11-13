import { paginationOptsValidator, type PaginationOptions } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { categoryValidator, conditionValidator } from "./schema";
import { assertOwnsTool, displayName, fail, requireViewer } from "./lib/auth";
import { LIMITS } from "./lib/constants";
import { todayIso } from "./lib/dates";
import { assertCanCreateListing } from "./lib/limits";
import { enqueueLoanNotification } from "./notifications";

// A user's own listings are capped by LIMITS (see lib/limits.ts), so `mine`
// can read them all. The shared catalogue grows without bound, so it is paged.
const MAX_TOOLS = 200;
// Callers choose the page size; this stops one request from reading a huge page.
const MAX_PAGE_SIZE = 50;

const boundedPage = (opts: PaginationOptions): PaginationOptions => ({
  ...opts,
  numItems: Math.max(1, Math.min(opts.numItems, MAX_PAGE_SIZE)),
});

type Booking = { startDate: string; endDate: string };

/**
 * Approved, not-yet-returned loans. Returning a loan changes its status, so
 * these are exactly the current and future bookings (overdue ones included).
 */
async function activeBookings(ctx: QueryCtx, toolId: Id<"tools">): Promise<Booking[]> {
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
  return approved
    .map(({ startDate, endDate }) => ({ startDate, endDate }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** On loan today: an active booking has already started (overdue counts too). */
function isOnLoan(bookings: Booking[], today: string): boolean {
  return bookings.some((b) => b.startDate <= today);
}

function cleanToolInput(input: { name: string; description: string }) {
  const name = input.name.trim();
  const description = input.description.trim();
  if (!name) fail("INVALID_INPUT", "Give your tool a name.");
  if (name.length > LIMITS.toolName) {
    fail("INVALID_INPUT", `Names can be at most ${LIMITS.toolName} characters.`);
  }
  if (description.length > LIMITS.toolDescription) {
    fail("INVALID_INPUT", `Descriptions can be at most ${LIMITS.toolDescription} characters.`);
  }
  return { name, description };
}

/**
 * Public, unauthenticated catalogue. Returns only name and category of tools
 * that are currently available: no owner, condition, or description.
 */
export const listPublic = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const today = todayIso();
    const page = await ctx.db.query("tools").order("desc").paginate(boundedPage(paginationOpts));
    const available = [];
    for (const tool of page.page) {
      if (isOnLoan(await activeBookings(ctx, tool._id), today)) continue;
      available.push({ id: tool._id, name: tool.name, category: tool.category });
    }
    // A page can come back short (tools on loan are left out); the cursor still advances.
    return { ...page, page: available };
  },
});

/** Full catalogue for signed-in users, with availability and lender trust badge. */
export const list = query({
  args: { category: v.optional(categoryValidator), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { category, paginationOpts }) => {
    const viewer = await requireViewer(ctx);
    const today = todayIso();
    const tools = category
      ? ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", category))
          .order("desc")
      : ctx.db.query("tools").order("desc");
    const page = await tools.paginate(boundedPage(paginationOpts));

    const items = await Promise.all(
      page.page.map(async (tool) => {
        const owner = await ctx.db.get(tool.ownerId);
        const bookings = await activeBookings(ctx, tool._id);
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          isMine: tool.ownerId === viewer._id,
          ownerName: displayName(owner),
          ownerTrusted: owner?.trustedLender ?? false,
          available: !isOnLoan(bookings, today),
          bookings,
        };
      }),
    );
    return { ...page, page: items };
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const today = todayIso();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .take(MAX_TOOLS);
    return Promise.all(
      tools.map(async (tool) => {
        const bookings = await activeBookings(ctx, tool._id);
        const pending = await ctx.db
          .query("loans")
          .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "requested"))
          .collect();
        return {
          ...tool,
          available: !isOnLoan(bookings, today),
          bookings,
          pendingRequests: pending.length,
        };
      }),
    );
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const { name, description } = cleanToolInput(args);
    await assertCanCreateListing(ctx, viewer._id);
    return await ctx.db.insert("tools", {
      ownerId: viewer._id,
      name,
      description,
      category: args.category,
      condition: args.condition,
      updatedAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, { toolId, ...args }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) fail("NOT_FOUND", "That listing no longer exists.");
    // Admins moderate by removing listings; they do not edit other people's.
    assertOwnsTool(viewer, tool);
    const { name, description } = cleanToolInput(args);
    await ctx.db.patch(toolId, {
      name,
      description,
      category: args.category,
      condition: args.condition,
      updatedAt: Date.now(),
    });
  },
});

/** Owners may delete their own listing; admins may remove any listing. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) fail("NOT_FOUND", "That listing no longer exists.");
    const isAdmin = viewer.role === "admin";
    if (!isAdmin) assertOwnsTool(viewer, tool);

    const active = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
      .first();
    if (active && !isAdmin) {
      fail("CONFLICT", "This tool has an approved loan. Mark it returned before deleting.");
    }

    await cancelPendingRequests(ctx, tool);
    await ctx.db.delete(toolId);
  },
});

async function cancelPendingRequests(ctx: MutationCtx, tool: Doc<"tools">) {
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "requested"))
    .collect();
  for (const loan of pending) {
    await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: Date.now() });
    await enqueueLoanNotification(ctx, loan._id, "loan.listing_removed", loan.borrowerId);
  }
}
