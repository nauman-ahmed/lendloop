import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Route protection is a UX nicety (signed-out users get redirected to sign in).
// Data access is enforced independently inside every Convex function.
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);

// The Convex client uses HTTPS and a WebSocket to the same deployment host.
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexOrigins = convexUrl
  ? [new URL(convexUrl).origin, new URL(convexUrl).origin.replace(/^http/, "ws")]
  : [];

export default clerkMiddleware(
  async (auth, req) => {
    if (isProtectedRoute(req)) await auth.protect();
  },
  {
    // Clerk builds a Content-Security-Policy that already allows its own
    // frontend API, images and bot protection. `strict` adds a per-request
    // nonce and 'strict-dynamic', so only Next.js's own scripts (and what they
    // load) can run; injected inline or third-party scripts are blocked.
    contentSecurityPolicy: {
      strict: true,
      directives: {
        "connect-src": convexOrigins,
        "frame-ancestors": ["none"], // no clickjacking of Approve / Remove buttons
        "object-src": ["none"],
        "base-uri": ["self"],
      },
    },
  },
);

export const config = {
  matcher: [
    // Skip Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
