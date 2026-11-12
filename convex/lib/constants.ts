// Shared between Convex functions and the Next.js UI so labels and validation
// never drift apart.

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  other: "Other",
};

export const CONDITIONS = ["like_new", "good", "fair", "well_used"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  well_used: "Well used",
};

export const LOAN_STATUSES = [
  "requested",
  "approved",
  "declined",
  "cancelled",
  "returned",
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const LIMITS = {
  toolName: 80,
  toolDescription: 500,
  maxLoanDays: 30,
  maxAdvanceBookingDays: 90,
  // Abuse limits: every request notifies a lender, so these cap how much
  // notification traffic (and data) one account can generate.
  maxRequestsPerHour: 10,
  maxOpenRequestsPerBorrower: 10,
  maxOpenRequestsPerTool: 15,
  maxListingsPerHour: 10,
  maxListingsPerUser: 50,
} as const;
