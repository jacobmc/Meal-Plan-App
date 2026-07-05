"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatISODate, weekStartFor } from "@/lib/schedule/week";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "./date-range-picker";

function addDaysUTC(d: Date, n: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + n);
  return next;
}

export function GroceryListForm({ weekStartsOn }: { weekStartsOn: number }) {
  const router = useRouter();
  const weekStart = weekStartFor(new Date(), weekStartsOn);
  const [name, setName] = useState("");
  const [range, setRange] = useState({
    startDate: formatISODate(weekStart),
    endDate: formatISODate(addDaysUTC(weekStart, 6)),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/grocery/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || undefined,
        startDate: range.startDate,
        endDate: range.endDate,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(body.error?.message ?? "Failed to create list");
      setSubmitting(false);
      return;
    }
    const body = (await res.json()) as { id: string };
    router.push(`/app/grocery/${body.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-md">
      <label className="block">
        <span className="text-sm">Name (optional)</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Groceries"
          className="mt-1 block w-full rounded border px-3 py-2"
        />
      </label>
      <div>
        <div className="text-sm mb-1">Date range</div>
        <DateRangePicker weekStartsOn={weekStartsOn} value={range} onChange={setRange} />
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create list"}
      </Button>
    </form>
  );
}
