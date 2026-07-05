"use client";
import { useState } from "react";
import type { GroceryListItemDto, IngredientCategory } from "@/lib/grocery/types";
import { INGREDIENT_CATEGORIES } from "@/lib/grocery/types";
import { Button } from "@/components/ui/button";

const LABELS: Record<IngredientCategory, string> = {
  produce: "Produce",
  meat: "Meat",
  dairy: "Dairy",
  pantry: "Pantry",
  frozen: "Frozen",
  bakery: "Bakery",
  other: "Other",
};

export function ManualItemForm({
  listId,
  onAdd,
}: {
  listId: string;
  onAdd: (next: GroceryListItemDto) => void;
}) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState<IngredientCategory>("other");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setPending(true);
    setError(null);
    const res = await fetch(`/api/grocery/lists/${listId}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayText: text.trim(), category }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(body.error?.message ?? "Failed to add");
      setPending(false);
      return;
    }
    const row = (await res.json()) as GroceryListItemDto;
    onAdd(row);
    setText("");
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add item…"
          className="flex-1 rounded border px-3 py-2 text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as IngredientCategory)}
          className="rounded border px-2 py-2 text-sm"
          aria-label="Category"
        >
          {INGREDIENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {LABELS[c]}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={pending || !text.trim()}>
          Add
        </Button>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
    </form>
  );
}
