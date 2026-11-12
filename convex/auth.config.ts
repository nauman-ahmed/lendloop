import type { AuthConfig } from "convex/server";

// Convex verifies Clerk-issued JWTs (template / integration named "convex").
// Set CLERK_JWT_ISSUER_DOMAIN in the Convex deployment's environment variables.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
