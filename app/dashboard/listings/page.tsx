"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  LIMITS,
  type Category,
  type Condition,
} from "@/convex/lib/constants";
import {
  ActionButton,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  inputClass,
} from "@/components/ui";
import { errorMessage, formatRange } from "@/lib/format";

type ToolFields = {
  name: string;
  category: Category;
  condition: Condition;
  description: string;
};

const EMPTY: ToolFields = { name: "", category: "power_tools", condition: "good", description: "" };

export default function MyListingsPage() {
  const tools = useQuery(api.tools.mine);
  const createTool = useMutation(api.tools.create);
  const updateTool = useMutation(api.tools.update);
  const removeTool = useMutation(api.tools.remove);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Doc<"tools"> | null>(null);

  return (
    <>
      <PageHeader title="My listings">
        {!showForm && !editing && <Button onClick={() => setShowForm(true)}>+ List a tool</Button>}
      </PageHeader>

      {showForm && (
        <ToolForm
          title="List a tool"
          initial={EMPTY}
          submitLabel="Publish listing"
          onCancel={() => setShowForm(false)}
          onSubmit={async (fields) => {
            await createTool(fields);
            setShowForm(false);
          }}
        />
      )}

      {tools === undefined ? (
        <Spinner />
      ) : tools.length === 0 && !showForm ? (
        <EmptyState>You haven&apos;t listed anything yet.</EmptyState>
      ) : (
        <div className="space-y-3">
          {tools.map((tool) =>
            editing?._id === tool._id ? (
              <ToolForm
                key={tool._id}
                title={`Edit ${tool.name}`}
                initial={tool}
                submitLabel="Save changes"
                onCancel={() => setEditing(null)}
                onSubmit={async (fields) => {
                  await updateTool({ toolId: tool._id, ...fields });
                  setEditing(null);
                }}
              />
            ) : (
              <Card key={tool._id} className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-stone-900">{tool.name}</h3>
                    {tool.available ? <Badge tone="green">Available</Badge> : <Badge tone="amber">On loan</Badge>}
                    {tool.pendingRequests > 0 && (
                      <Badge tone="blue">
                        {tool.pendingRequests} pending request{tool.pendingRequests > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-stone-500">
                    {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
                  </p>
                  {tool.description && <p className="mt-2 text-sm text-stone-700">{tool.description}</p>}
                  {tool.bookings.length > 0 && (
                    <p className="mt-2 text-xs text-stone-500">
                      Booked: {tool.bookings.map((b) => formatRange(b.startDate, b.endDate)).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(tool)}>
                    Edit
                  </Button>
                  <ActionButton
                    variant="danger"
                    confirm="Really delete?"
                    action={() => removeTool({ toolId: tool._id })}
                  >
                    Delete
                  </ActionButton>
                </div>
              </Card>
            ),
          )}
        </div>
      )}
    </>
  );
}

function ToolForm({
  title,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: ToolFields;
  submitLabel: string;
  onSubmit: (fields: ToolFields) => Promise<void>;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<ToolFields>({
    name: initial.name,
    category: initial.category,
    condition: initial.condition,
    description: initial.description,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof ToolFields>(key: K, value: ToolFields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(fields);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-semibold text-stone-900">{title}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-medium text-stone-700 sm:col-span-3">
            Name
            <input
              required
              maxLength={LIMITS.toolName}
              value={fields.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Cordless drill"
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className="block text-sm font-medium text-stone-700">
            Category
            <select
              value={fields.category}
              onChange={(e) => set("category", e.target.value as Category)}
              className={`${inputClass} mt-1`}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-stone-700">
            Condition
            <select
              value={fields.condition}
              onChange={(e) => set("condition", e.target.value as Condition)}
              className={`${inputClass} mt-1`}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-stone-700 sm:col-span-3">
            Short description
            <textarea
              rows={3}
              maxLength={LIMITS.toolDescription}
              value={fields.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What's included? Anything borrowers should know?"
              className={`${inputClass} mt-1`}
            />
          </label>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : submitLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
