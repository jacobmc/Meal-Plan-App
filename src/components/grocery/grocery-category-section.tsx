"use client";
import { useState } from "react";
import type { GroceryListItemDto, IngredientCategory } from "@/lib/grocery/types";
import { GroceryItemRow } from "./grocery-item-row";

const LABELS: Record<IngredientCategory, string> = {
  produce: "Produce",
  meat: "Meat",
  dairy: "Dairy",
  pantry: "Pantry",
  frozen: "Frozen",
  bakery: "Bakery",
  other: "Other",
};

export function GroceryCategorySection({
  listId,
  category,
  items,
  onItemChange,
}: {
  listId: string;
  category: IngredientCategory;
  items: GroceryListItemDto[];
  onItemChange: (next: GroceryListItemDto) => void;
}) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  const checked = items.filter((i) => i.checked).length;

  return (
    <section className="border-t">
      <button
        type="button"
        className="flex w-full items-center justify-between py-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-semibold">{LABELS[category]}</span>
        <span className="text-xs text-muted-foreground">
          {checked}/{items.length}
        </span>
      </button>
      {open && (
        <div>
          {items.map((item) => (
            <GroceryItemRow key={item.id} listId={listId} item={item} onChange={onItemChange} />
          ))}
        </div>
      )}
    </section>
  );
}
