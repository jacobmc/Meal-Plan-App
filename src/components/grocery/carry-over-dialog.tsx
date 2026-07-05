"use client";
import { useEffect, useState } from "react";
import type { GroceryListSummaryDto } from "@/lib/grocery/types";
import { Button } from "@/components/ui/button";

export function CarryOverDialog({
  listId,
  onComplete,
}: {
  listId: string;
  onComplete: (added: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [others, setOthers] = useState<GroceryListSummaryDto[]>([]);
  const [target, setTarget] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/grocery/lists")
      .then((r) => r.json())
      .then((body: { items: GroceryListSummaryDto[] }) => {
        setOthers(body.items.filter((l) => l.id !== listId));
      })
      .catch(() => setError("Could not load lists"));
  }, [open, listId]);

  async function run() {
    if (!target) return;
    setPending(true);
    setError(null);
    const res = await fetch(`/api/grocery/lists/${listId}/carry-over`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toListId: target }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(body.error?.message ?? "Failed");
      setPending(false);
      return;
    }
    const body = (await res.json()) as { added: number };
    onComplete(body.added);
    setOpen(false);
    setPending(false);
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Carry over unchecked
      </Button>
    );
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="text-sm">Copy unchecked items to another list as manual entries.</div>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="rounded border px-2 py-1 text-sm"
        aria-label="Target list"
      >
        <option value="">Pick a target list…</option>
        {others.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={run} disabled={!target || pending}>
          {pending ? "…" : "Carry over"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
