import { internalMutation } from "./_generated/server";
import { todayIso } from "./lib/dates";
import type { Category, Condition } from "./lib/constants";

// Demo data for reviewers:  npx convex run seed:demo
// The seeded neighbours can't sign in (their token identifiers are fake), but
// they give the catalogue something to show and you can borrow from them.

const NEIGHBOURS: {
  name: string;
  trusted: boolean;
  tools: { name: string; category: Category; condition: Condition; description: string }[];
}[] = [
  {
    name: "Amira Haddad",
    trusted: true,
    tools: [
      { name: "Cordless drill", category: "power_tools", condition: "good", description: "18V with two batteries and a bit set." },
      { name: "Hedge trimmer", category: "garden", condition: "fair", description: "Electric, 50cm blade. Extension cable included." },
    ],
  },
  {
    name: "Tomasz Nowak",
    trusted: false,
    tools: [
      { name: "4-person tent", category: "camping", condition: "like_new", description: "Used twice. Pegs and footprint included." },
      { name: "Stand mixer", category: "kitchen", condition: "good", description: "With dough hook, whisk and paddle." },
    ],
  },
  {
    name: "Jo Okafor",
    trusted: false,
    tools: [
      { name: "Pressure washer", category: "cleaning", condition: "well_used", description: "Works fine, a bit scuffed. Patio cleaner attachment." },
      { name: "Socket set", category: "hand_tools", condition: "good", description: "Metric and imperial, 1/4\" and 3/8\" drives." },
    ],
  },
];

export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    let created = 0;
    for (const neighbour of NEIGHBOURS) {
      const tokenIdentifier = `seed|${neighbour.name.toLowerCase().replace(/\W+/g, "-")}`;
      const existing = await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
        .unique();
      // Reserved example domain: reminders in the demo never reach a real inbox.
      const email = `${neighbour.name.split(" ")[0].toLowerCase()}@example.com`;
      if (existing) {
        // Idempotent: safe to run twice.
        if (!existing.email) await ctx.db.patch(existing._id, { email });
        continue;
      }
      const ownerId = await ctx.db.insert("users", {
        tokenIdentifier,
        name: neighbour.name,
        email,
        role: "user",
        trustedLender: neighbour.trusted,
      });
      for (const tool of neighbour.tools) {
        await ctx.db.insert("tools", { ...tool, ownerId, updatedAt: Date.now() });
        created++;
      }
    }
    return `Seeded ${created} tools`;
  },
});

/**
 * Creates an approved loan that ended three days ago, so the overdue-reminder
 * workflow has something to do:  npx convex run seed:overdueLoan
 */
export const overdueLoan = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const seeded = users.filter((u) => u.tokenIdentifier.startsWith("seed|"));
    if (seeded.length < 2) throw new Error("Run seed:demo first.");
    const [lender, borrower] = seeded;
    const tool = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", lender._id))
      .first();
    if (!tool) throw new Error("The seeded lender has no tools.");

    const day = 24 * 60 * 60 * 1000;
    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      toolName: tool.name,
      ownerId: lender._id,
      borrowerId: borrower._id,
      startDate: todayIso(Date.now() - 7 * day),
      endDate: todayIso(Date.now() - 3 * day),
      status: "approved",
      decidedAt: Date.now() - 8 * day,
    });
    return `Created overdue loan ${loanId}: ${borrower.name} has ${lender.name}'s ${tool.name}`;
  },
});
