"use client";
import { useState } from "react";
import type { GroceryListItemDto } from "@/lib/grocery/types";

export function GroceryItemRow({
  listId,
  item,
  onChange,
}: {
  listId: string;
  item: GroceryListItemDto;
  onChange: (next: GroceryListItemDto) => void;
}) {
  const [pending, setPending] = useState(false);

  async function toggle() {
    const optimistic = { ...item, checked: !item.checked };
    onChange(optimistic);
    setPending(true);
    try {
      const res = await fetch(`/api/grocery/lists/${listId}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checked: optimistic.checked }),
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) onChange(item);
      } else {
        const body = (await res.json()) as GroceryListItemDto;
        onChange(body);
      }
    } catch {
      // Network failure: keep the optimistic state; the SW Background Sync queue replays the PATCH.
    } finally {
      setPending(false);
    }
  }

  const label = item.ingredientName ?? item.displayText ?? "";
  const qty = item.quantity !== null ? `${item.quantity}` : "";
  const unit = item.unit ?? "";
  const badge = item.source === "manual" ? "manual" : null;

  return (
    <div className="flex items-center gap-3 py-2">
      <input
        type="checkbox"
        checked={item.checked}
        onChange={toggle}
        disabled={pending}
        className="h-5 w-5"
        aria-label={`Check off ${label}`}
      />
      <div className={item.checked ? "line-through text-muted-foreground flex-1" : "flex-1"}>
        <span className="font-medium">{label}</span>
        {(qty || unit) && (
          <span className="ml-2 text-sm text-muted-foreground">
            {[qty, unit].filter(Boolean).join(" ")}
          </span>
        )}
        {badge && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">{badge}</span>}
      </div>
    </div>
  );
}
