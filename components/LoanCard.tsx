"use client";

import type { ReactNode } from "react";
import type { LoanView } from "@/convex/loans";
import { ActivityList, Card, LoanStatusBadge, TrustedBadge } from "./ui";
import { formatRange } from "@/lib/format";

export function LoanCard({
  loan,
  counterpartLabel,
  actions,
}: {
  loan: LoanView;
  counterpartLabel: string;
  actions?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-stone-900">{loan.toolName}</h3>
            <LoanStatusBadge status={loan.status} overdue={loan.isOverdue} />
          </div>
          <p className="mt-1 text-sm text-stone-600">
            {formatRange(loan.startDate, loan.endDate)} · {counterpartLabel} {loan.counterpartName}{" "}
            {loan.counterpartTrusted && <TrustedBadge />}
          </p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <ActivityList activity={loan.activity} />
    </Card>
  );
}
