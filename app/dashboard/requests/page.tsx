"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LoanCard } from "@/components/LoanCard";
import { ActionButton, EmptyState, PageHeader, Spinner } from "@/components/ui";

export default function MyRequestsPage() {
  const loans = useQuery(api.loans.myRequests);
  const cancel = useMutation(api.loans.cancel);

  return (
    <>
      <PageHeader title="My requests" />
      {loans === undefined ? (
        <Spinner />
      ) : loans.length === 0 ? (
        <EmptyState>You haven&apos;t asked to borrow anything yet.</EmptyState>
      ) : (
        <div className="space-y-3">
          {loans.map((loan) => (
            <LoanCard
              key={loan._id}
              loan={loan}
              counterpartLabel="from"
              actions={
                loan.status === "requested" && (
                  <ActionButton
                    variant="secondary"
                    confirm="Cancel request?"
                    action={() => cancel({ loanId: loan._id })}
                  >
                    Cancel
                  </ActionButton>
                )
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
