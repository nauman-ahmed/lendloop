"use client";

import { SignInButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated, usePaginatedQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/convex/lib/constants";
import { Header } from "@/components/Header";
import { Badge, Button, EmptyState, LoadMore, Spinner } from "@/components/ui";

const PAGE_SIZE = 24;

export default function HomePage() {
  // Public query: returns only name + category of currently available tools.
  const { results: tools, status, loadMore } = usePaginatedQuery(
    api.tools.listPublic,
    {},
    { initialNumItems: PAGE_SIZE },
  );

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-4">
        <section className="py-16 text-center sm:py-24">
          <p className="mb-3 text-sm font-medium uppercase tracking-widest text-emerald-700">
            Neighbourhood tool library
          </p>
          <h1 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
            Borrow what you need.
            <br />
            Lend what you don&apos;t.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-stone-600">
            LendLoop helps neighbours share drills, tents, mixers and more, with
            automatic reminders so everything finds its way home.
          </p>
          <div className="mt-8 flex justify-center">
            <Unauthenticated>
              <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                <Button className="px-5 py-2.5 text-base">Sign in to lend or borrow</Button>
              </SignInButton>
            </Unauthenticated>
            <Authenticated>
              <Link href="/dashboard">
                <Button className="px-5 py-2.5 text-base">Go to your dashboard →</Button>
              </Link>
            </Authenticated>
          </div>
        </section>

        <section className="pb-20">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-stone-900">Available right now</h2>
            {status !== "LoadingFirstPage" && (
              <span className="text-sm text-stone-500">
                {tools.length} {status === "Exhausted" ? "tools" : "shown"}
              </span>
            )}
          </div>
          {status === "LoadingFirstPage" ? (
            <Spinner />
          ) : tools.length === 0 && status === "Exhausted" ? (
            <EmptyState>No tools available right now. Be the first to lend one!</EmptyState>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((tool) => (
                <li
                  key={tool.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3"
                >
                  <span className="font-medium text-stone-800">{tool.name}</span>
                  <Badge>{CATEGORY_LABELS[tool.category]}</Badge>
                </li>
              ))}
            </ul>
          )}
          <LoadMore status={status} loadMore={loadMore} pageSize={PAGE_SIZE} />
        </section>
      </main>
    </>
  );
}
