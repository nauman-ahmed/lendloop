import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { fail } from "./auth";
import { LIMITS } from "./constants";

// Per-account abuse limits, enforced inside the mutations. Counts use indexed,
// bounded reads (`take(limit)`), so checking a limit never scans a whole table.

const HOUR_MS = 60 * 60 * 1000;

export async function assertCanRequestLoan(
  ctx: MutationCtx,
  borrowerId: Id<"users">,
  toolId: Id<"tools">,
) {
  const recent = await ctx.db
    .query("loans")
    .withIndex("by_borrower", (q) =>
      q.eq("borrowerId", borrowerId).gt("_creationTime", Date.now() - HOUR_MS),
    )
    .take(LIMITS.maxRequestsPerHour);
  if (recent.length >= LIMITS.maxRequestsPerHour) {
    fail("RATE_LIMITED", "You've sent a lot of requests recently. Please try again in an hour.");
  }

  const open = await ctx.db
    .query("loans")
    .withIndex("by_borrower_status", (q) =>
      q.eq("borrowerId", borrowerId).eq("status", "requested"),
    )
    .take(LIMITS.maxOpenRequestsPerBorrower);
  if (open.length >= LIMITS.maxOpenRequestsPerBorrower) {
    fail(
      "RATE_LIMITED",
      `You have ${LIMITS.maxOpenRequestsPerBorrower} requests waiting for an answer. Cancel one or wait for replies first.`,
    );
  }

  // Caps how much one lender can be flooded on a single tool, even by many accounts.
  const pendingForTool = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "requested"))
    .take(LIMITS.maxOpenRequestsPerTool);
  if (pendingForTool.length >= LIMITS.maxOpenRequestsPerTool) {
    fail("RATE_LIMITED", "This tool has too many pending requests right now. Try again later.");
  }
}

export async function assertCanCreateListing(ctx: MutationCtx, ownerId: Id<"users">) {
  const recent = await ctx.db
    .query("tools")
    .withIndex("by_owner", (q) =>
      q.eq("ownerId", ownerId).gt("_creationTime", Date.now() - HOUR_MS),
    )
    .take(LIMITS.maxListingsPerHour);
  if (recent.length >= LIMITS.maxListingsPerHour) {
    fail("RATE_LIMITED", "You've listed a lot of tools recently. Please try again in an hour.");
  }

  const total = await ctx.db
    .query("tools")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .take(LIMITS.maxListingsPerUser);
  if (total.length >= LIMITS.maxListingsPerUser) {
    fail("RATE_LIMITED", `You can have at most ${LIMITS.maxListingsPerUser} listings.`);
  }
}
