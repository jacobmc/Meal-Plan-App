import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { groceryListItems, ingredients } from "@/lib/db/schema";
import { serializeItem } from "@/lib/grocery/serialize";
import type { GroceryListItemDto } from "@/lib/grocery/types";

const itemJoinSelection = {
  id: groceryListItems.id,
  listId: groceryListItems.listId,
  ingredientId: groceryListItems.ingredientId,
  displayText: groceryListItems.displayText,
  quantity: groceryListItems.quantity,
  unit: groceryListItems.unit,
  category: groceryListItems.category,
  source: groceryListItems.source,
  checked: groceryListItems.checked,
  checkedAt: groceryListItems.checkedAt,
  checkedByUserId: groceryListItems.checkedByUserId,
  sourceScheduleEntryIds: groceryListItems.sourceScheduleEntryIds,
  sortOrder: groceryListItems.sortOrder,
  createdAt: groceryListItems.createdAt,
  updatedAt: groceryListItems.updatedAt,
  ingredientName: ingredients.name,
};

export async function loadItemsWithJoin(listId: string): Promise<GroceryListItemDto[]> {
  const rows = await db
    .select(itemJoinSelection)
    .from(groceryListItems)
    .leftJoin(ingredients, eq(groceryListItems.ingredientId, ingredients.id))
    .where(eq(groceryListItems.listId, listId));
  return rows.map(serializeItem);
}

export async function loadItemWithJoin(itemId: string): Promise<GroceryListItemDto | null> {
  const [row] = await db
    .select(itemJoinSelection)
    .from(groceryListItems)
    .leftJoin(ingredients, eq(groceryListItems.ingredientId, ingredients.id))
    .where(eq(groceryListItems.id, itemId));
  return row ? serializeItem(row) : null;
}
