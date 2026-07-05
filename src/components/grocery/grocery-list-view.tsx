"use client";
import { useState } from "react";
import type {
  GroceryListDetailDto,
  GroceryListItemDto,
  IngredientCategory,
} from "@/lib/grocery/types";
import { INGREDIENT_CATEGORIES } from "@/lib/grocery/types";
import { GroceryCategorySection } from "./grocery-category-section";
import { ManualItemForm } from "./manual-item-form";
import { RegenerateButton } from "./regenerate-button";
import { CarryOverDialog } from "./carry-over-dialog";

export function GroceryListView({ initial }: { initial: GroceryListDetailDto }) {
  const [detail, setDetail] = useState(initial);

  function onItemChange(next: GroceryListItemDto) {
    setDetail((d) => ({
      ...d,
      items: d.items.map((it) => (it.id === next.id ? next : it)),
    }));
  }

  function onAdd(row: GroceryListItemDto) {
    setDetail((d) => ({ ...d, items: [...d.items, row] }));
  }

  const byCategory: Record<IngredientCategory, GroceryListItemDto[]> = {
    produce: [],
    meat: [],
    dairy: [],
    pantry: [],
    frozen: [],
    bakery: [],
    other: [],
  };
  for (const item of detail.items) {
    byCategory[item.category].push(item);
  }

  const itemCount = detail.items.length;
  const checkedCount = detail.items.filter((i) => i.checked).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{detail.name}</h1>
        <p className="text-sm text-muted-foreground">
          {detail.startDate} → {detail.endDate}
          {" · "}
          {checkedCount}/{itemCount} checked
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <RegenerateButton listId={detail.id} />
        <CarryOverDialog listId={detail.id} onComplete={() => {}} />
      </div>
      <ManualItemForm listId={detail.id} onAdd={onAdd} />
      {INGREDIENT_CATEGORIES.map((c) => (
        <GroceryCategorySection
          key={c}
          listId={detail.id}
          category={c}
          items={byCategory[c]}
          onItemChange={onItemChange}
        />
      ))}
    </div>
  );
}
