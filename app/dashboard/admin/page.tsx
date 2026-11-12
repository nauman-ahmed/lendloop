"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  ActionButton,
  Card,
  EmptyState,
  LoanStatusBadge,
  PageHeader,
  Spinner,
  TrustedBadge,
} from "@/components/ui";
import { describeActivity, formatRange, timeAgo } from "@/lib/format";

// The UI only shows this page to admins, but each query below also calls
// requireAdmin on the server, so a non-admin visiting the URL gets nothing.
export default function AdminPage() {
  const me = useQuery(api.users.me);
  if (me && me.role !== "admin") {
    return <EmptyState>This page is for admins only.</EmptyState>;
  }
  if (!me) return <Spinner />;
  return (
    <>
      <PageHeader title="Admin" />
      <div className="space-y-10">
        <AutomationHealth />
        <Users />
        <AllListings />
        <AllLoans />
      </div>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-lg font-semibold text-stone-900">{children}</h2>;
}

function AutomationHealth() {
  const failures = useQuery(api.admin.automationFailures);
  return (
    <section>
      <SectionTitle>Automation failures</SectionTitle>
      {failures === undefined ? (
        <Spinner />
      ) : failures.length === 0 ? (
        <Card className="text-sm text-emerald-800">✓ No failed notifications, reminders or workflow runs.</Card>
      ) : (
        <Card className="divide-y divide-stone-100 p-0">
          {failures.map((f) => (
            <div key={f._id} className="flex flex-wrap justify-between gap-2 px-4 py-2 text-sm">
              <span>
                <span className="font-medium text-red-800">{f.kind.replace("_", " ")}</span> · {f.label}
                <span className="block text-xs text-stone-500">{f.detail}</span>
              </span>
              <span className="text-xs text-stone-500">
                {f.attempts} attempt{f.attempts === 1 ? "" : "s"} · {timeAgo(f.at)}
              </span>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

function Users() {
  const users = useQuery(api.admin.listUsers);
  const setTrusted = useMutation(api.admin.setTrustedLender);
  return (
    <section>
      <SectionTitle>Lenders</SectionTitle>
      {users === undefined ? (
        <Spinner />
      ) : (
        <Card className="divide-y divide-stone-100 p-0">
          {users.map((user) => (
            <div key={user._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="flex items-center gap-2 text-sm">
                <span className="font-medium text-stone-900">{user.name}</span>
                {user.role === "admin" && <span className="text-xs text-stone-500">(admin)</span>}
                <span className="text-xs text-stone-500">{user.listings} listings</span>
                {user.trustedLender && <TrustedBadge />}
              </span>
              <ActionButton
                variant={user.trustedLender ? "ghost" : "secondary"}
                action={() => setTrusted({ userId: user._id, trusted: !user.trustedLender })}
              >
                {user.trustedLender ? "Remove trusted" : "Mark trusted"}
              </ActionButton>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

function AllListings() {
  const tools = useQuery(api.tools.list, {});
  const remove = useMutation(api.tools.remove);
  return (
    <section>
      <SectionTitle>All listings</SectionTitle>
      {tools === undefined ? (
        <Spinner />
      ) : tools.length === 0 ? (
        <EmptyState>No listings.</EmptyState>
      ) : (
        <Card className="divide-y divide-stone-100 p-0">
          {tools.map((tool) => (
            <div key={tool._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span>
                <span className="font-medium text-stone-900">{tool.name}</span>{" "}
                <span className="text-stone-500">by {tool.isMine ? "you" : tool.ownerName}</span>
              </span>
              <ActionButton
                variant="danger"
                confirm="Remove listing?"
                action={() => remove({ toolId: tool._id })}
              >
                Remove
              </ActionButton>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

function AllLoans() {
  const loans = useQuery(api.admin.listLoans);
  return (
    <section>
      <SectionTitle>All loans</SectionTitle>
      {loans === undefined ? (
        <Spinner />
      ) : loans.length === 0 ? (
        <EmptyState>No loans yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium">Tool</th>
                <th className="px-4 py-2 font-medium">Lender → Borrower</th>
                <th className="px-4 py-2 font-medium">Dates</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last automation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loans.map((loan) => (
                <tr key={loan._id}>
                  <td className="px-4 py-2 font-medium text-stone-900">{loan.toolName}</td>
                  <td className="px-4 py-2 text-stone-600">
                    {loan.lenderName} → {loan.borrowerName}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-stone-600">
                    {formatRange(loan.startDate, loan.endDate)}
                  </td>
                  <td className="px-4 py-2">
                    <LoanStatusBadge status={loan.status} overdue={loan.isOverdue} />
                  </td>
                  <td className="px-4 py-2 text-xs text-stone-500">
                    {loan.lastActivity ? describeActivity(loan.lastActivity) : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
