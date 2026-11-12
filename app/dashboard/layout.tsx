"use client";

import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { RedirectToSignIn } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { Header } from "@/components/Header";
import { Spinner, TrustedBadge } from "@/components/ui";

const NAV = [
  { href: "/dashboard", label: "Browse tools" },
  { href: "/dashboard/listings", label: "My listings" },
  { href: "/dashboard/requests", label: "My requests" },
  { href: "/dashboard/incoming", label: "Incoming requests" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthLoading>
        <Header />
        <Spinner />
      </AuthLoading>
      <Unauthenticated>
        <RedirectToSignIn />
      </Unauthenticated>
      <Authenticated>
        <ProvisionedShell>{children}</ProvisionedShell>
      </Authenticated>
    </>
  );
}

/** Makes sure the Convex user record exists before any page queries run. */
function ProvisionedShell({ children }: { children: ReactNode }) {
  const ensureViewer = useMutation(api.users.ensureViewer);
  const me = useQuery(api.users.me);
  const pathname = usePathname();

  useEffect(() => {
    void ensureViewer();
  }, [ensureViewer]);

  const nav = me?.role === "admin" ? [...NAV, { href: "/dashboard/admin", label: "Admin" }] : NAV;

  return (
    <>
      <Header>
        {me && (
          <span className="hidden items-center gap-2 text-sm text-stone-600 sm:flex">
            {me.name}
            {me.trustedLender && <TrustedBadge />}
            {me.role === "admin" && (
              <span className="rounded bg-stone-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                admin
              </span>
            )}
          </span>
        )}
      </Header>
      <nav className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition ${
                  active
                    ? "border-emerald-700 text-emerald-800"
                    : "border-transparent text-stone-500 hover:text-stone-800"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <main className="mx-auto max-w-5xl px-4 py-8">{me ? children : <Spinner />}</main>
    </>
  );
}
