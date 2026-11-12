import { mutation, query } from "./_generated/server";
import { fail, getViewer } from "./lib/auth";

/**
 * Creates (or refreshes) the Convex user record for the signed-in Clerk user.
 * Called by the client once per session. It never touches `role` or
 * `trustedLender`, so a user cannot grant themselves privileges through it.
 */
export const ensureViewer = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("UNAUTHENTICATED", "Please sign in first.");

    const name =
      identity.name?.trim() ||
      identity.givenName?.trim() ||
      identity.nickname?.trim() ||
      identity.email?.split("@")[0] ||
      "Neighbour";
    // Fail closed: only an address the identity provider says is verified is
    // used for notifications. A missing `email_verified` claim counts as unverified.
    const email = identity.emailVerified === true ? identity.email : undefined;

    const existing = await getViewer(ctx);
    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: "user",
      trustedLender: false,
    });
  },
});

/** What the UI needs to know about the current user. Email is deliberately omitted. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    return {
      _id: viewer._id,
      name: viewer.name,
      role: viewer.role,
      trustedLender: viewer.trustedLender,
    };
  },
});
