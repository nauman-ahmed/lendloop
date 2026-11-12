"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import Link from "next/link";
import { Button } from "./ui";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-stone-900">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-700 text-sm text-white">
        ⟳
      </span>
      LendLoop
    </Link>
  );
}

export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="border-b border-stone-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <Logo />
        <div className="flex items-center gap-3">
          {children}
          <AuthLoading>
            <div className="h-7 w-7 animate-pulse rounded-full bg-stone-200" />
          </AuthLoading>
          <Unauthenticated>
            <SignInButton mode="modal">
              <Button>Sign in</Button>
            </SignInButton>
          </Unauthenticated>
          <Authenticated>
            <UserButton />
          </Authenticated>
        </div>
      </div>
    </header>
  );
}
