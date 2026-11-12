import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Every authorization decision in LendLoop goes through these helpers. The UI
// hides buttons a user may not use, but that is cosmetic: the checks here are
// what actually protect the data.

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_PROVISIONED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "RATE_LIMITED";

export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}

/** The signed-in user's record, or null if signed out / not yet provisioned. */
export async function getViewer(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
}

export async function requireViewer(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("UNAUTHENTICATED", "Please sign in first.");
  const viewer = await getViewer(ctx);
  if (!viewer) fail("NOT_PROVISIONED", "Your account is still being set up.");
  return viewer;
}

export async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const viewer = await requireViewer(ctx);
  if (viewer.role !== "admin") fail("FORBIDDEN", "Admins only.");
  return viewer;
}

export function assertOwnsTool(viewer: Doc<"users">, tool: Doc<"tools">) {
  if (tool.ownerId !== viewer._id) {
    fail("FORBIDDEN", "You can only manage your own listings.");
  }
}

/** First name only: enough to be friendly, without broadcasting full names. */
export function displayName(user: Doc<"users"> | null | undefined): string {
  if (!user) return "A neighbour";
  return user.name.trim().split(/\s+/)[0] || "A neighbour";
}
