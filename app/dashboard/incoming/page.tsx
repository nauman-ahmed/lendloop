"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LoanCard } from "@/components/LoanCard";
import { ActionButton, EmptyState, PageHeader, Spinner } from "@/components/ui";

export default function IncomingRequestsPage() {
  const loans = useQuery(api.loans.incoming);
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const markReturned = useMutation(api.loans.markReturned);

  const pending = loans?.filter((loan) => loan.status === "requested") ?? [];
  const active = loans?.filter((loan) => loan.status === "approved") ?? [];
  const past = loans?.filter((loan) => !["requested", "approved"].includes(loan.status)) ?? [];

  return (
    <>
      <PageHeader title="Incoming requests" />
      {loans === undefined ? (
        <Spinner />
      ) : loans.length === 0 ? (
        <EmptyState>No one has asked to borrow your tools yet.</EmptyState>
      ) : (
        <div className="space-y-8">
          <Section title="Waiting for you" empty="Nothing waiting.">
            {pending.map((loan) => (
              <LoanCard
                key={loan._id}
                loan={loan}
                counterpartLabel="requested by"
                actions={
                  <>
                    <ActionButton action={() => approve({ loanId: loan._id })}>Approve</ActionButton>
                    <ActionButton variant="secondary" action={() => decline({ loanId: loan._id })}>
                      Decline
                    </ActionButton>
                  </>
                }
              />
            ))}
          </Section>
          <Section title="Out on loan" empty="Nothing out right now.">
            {active.map((loan) => (
              <LoanCard
                key={loan._id}
                loan={loan}
                counterpartLabel="borrowed by"
                actions={
                  <ActionButton
                    variant="secondary"
                    confirm="Got it back?"
                    action={() => markReturned({ loanId: loan._id })}
                  >
                    Mark returned
                  </ActionButton>
                }
              />
            ))}
          </Section>
          {past.length > 0 && (
            <Section title="History" empty="">
              {past.map((loan) => (
                <LoanCard key={loan._id} loan={loan} counterpartLabel="with" />
              ))}
            </Section>
          )}
        </div>
      )}
    </>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
        {title} <span className="text-stone-400">({children.length})</span>
      </h2>
      {children.length === 0 ? (
        <p className="text-sm text-stone-400">{empty}</p>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </section>
  );
}
