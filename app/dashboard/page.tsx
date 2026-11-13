"use client";

import { useMutation, usePaginatedQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CONDITION_LABELS,
  type Category,
} from "@/convex/lib/constants";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadMore,
  PageHeader,
  Spinner,
  TrustedBadge,
  inputClass,
} from "@/components/ui";
import { errorMessage, formatRange, todayIso } from "@/lib/format";

const PAGE_SIZE = 20;

export default function BrowsePage() {
  const [category, setCategory] = useState<Category | undefined>();
  const { results: tools, status, loadMore } = usePaginatedQuery(
    api.tools.list,
    { category },
    { initialNumItems: PAGE_SIZE },
  );

  return (
    <>
      <PageHeader title="Browse tools" />
      <div className="mb-6 flex flex-wrap gap-2">
        <FilterChip active={!category} onClick={() => setCategory(undefined)}>
          All
        </FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_LABELS[c]}
          </FilterChip>
        ))}
      </div>

      {status === "LoadingFirstPage" ? (
        <Spinner />
      ) : tools.length === 0 ? (
        <EmptyState>Nothing in this category yet.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {tools.map((tool) => (
            <Card key={tool._id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-stone-900">{tool.name}</h3>
                  <p className="mt-0.5 text-sm text-stone-500">
                    {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
                  </p>
                </div>
                {tool.available ? (
                  <Badge tone="green">Available</Badge>
                ) : (
                  <Badge tone="amber">On loan</Badge>
                )}
              </div>
              {tool.description && (
                <p className="mt-3 text-sm text-stone-700">{tool.description}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-stone-600">
                {tool.isMine ? (
                  <span className="italic">Your listing</span>
                ) : (
                  <>
                    Lent by {tool.ownerName}
                    {tool.ownerTrusted && <TrustedBadge />}
                  </>
                )}
              </div>
              {tool.bookings.length > 0 && (
                <p className="mt-2 text-xs text-stone-500">
                  Booked: {tool.bookings.map((b) => formatRange(b.startDate, b.endDate)).join(", ")}
                </p>
              )}
              {!tool.isMine && <RequestForm toolId={tool._id} />}
            </Card>
          ))}
        </div>
      )}
      <LoadMore status={status} loadMore={loadMore} pageSize={PAGE_SIZE} />
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm transition ${
        active
          ? "bg-stone-900 text-white"
          : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
      }`}
    >
      {children}
    </button>
  );
}

function RequestForm({ toolId }: { toolId: Id<"tools"> }) {
  const requestLoan = useMutation(api.loans.request);
  const [open, setOpen] = useState(false);
  const today = todayIso();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [status, setStatus] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await requestLoan({ toolId, startDate, endDate });
      setStatus({ kind: "ok", text: "Request sent! The lender has been notified." });
      setOpen(false);
    } catch (error) {
      setStatus({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-stone-100 pt-3">
      {open ? (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-stone-600">
            From
            <input
              type="date"
              required
              min={today}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className="text-xs text-stone-600">
            To
            <input
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={`${inputClass} mt-1`}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send request"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Request to borrow
        </Button>
      )}
      {status && (
        <p className={`mt-2 text-sm ${status.kind === "error" ? "text-red-700" : "text-emerald-700"}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}
