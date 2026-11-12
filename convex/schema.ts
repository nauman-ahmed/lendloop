import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Keep in sync with CATEGORIES / CONDITIONS / LOAN_STATUSES in ./lib/constants
// (a type test in convex/lib/constants.test.ts guards this).
export const categoryValidator = v.union(
  v.literal("power_tools"),
  v.literal("hand_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("other"),
);
export const conditionValidator = v.union(
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("well_used"),
);
export const loanStatusValidator = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);
export const roleValidator = v.union(v.literal("admin"), v.literal("user"));

export const automationKindValidator = v.union(
  v.literal("notification"),
  v.literal("reminder"),
  v.literal("workflow_error"),
);
export const automationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("succeeded"),
  v.literal("failed"),
);

export default defineSchema({
  users: defineTable({
    // `tokenIdentifier` is issuer + subject, so it is unique across auth providers.
    tokenIdentifier: v.string(),
    name: v.string(),
    // Only used to address notifications; never returned to other users.
    email: v.optional(v.string()),
    role: roleValidator,
    trustedLender: v.boolean(),
  }).index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    // Snapshot so loan history still reads well after a listing is deleted.
    toolName: v.string(),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    // ISO calendar dates (YYYY-MM-DD), inclusive. Lexicographic order == date order.
    startDate: v.string(),
    endDate: v.string(),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status_endDate", ["status", "endDate"]),

  // Audit trail for everything n8n does (or fails to do) on a loan's behalf.
  automationEvents: defineTable({
    kind: automationKindValidator,
    status: automationStatusValidator,
    // Unique per logical event; makes every write-back idempotent.
    idempotencyKey: v.string(),
    loanId: v.optional(v.id("loans")),
    // Notification type (e.g. "loan.approved") or reminder channel.
    label: v.string(),
    recipientId: v.optional(v.id("users")),
    attempts: v.number(),
    // Non-PII diagnostic text (HTTP status, error message, workflow name).
    detail: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"])
    .index("by_kind_status", ["kind", "status"]),
});
