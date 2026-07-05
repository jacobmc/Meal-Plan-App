import type { GroceryList, GroceryListItem } from "@/lib/db/schema";
import type {
  GroceryListDetailDto,
  GroceryListItemDto,
  GroceryListSummaryDto,
  IngredientCategory,
  GrocerySource,
} from "./types";

type ItemJoinRow = GroceryListItem & { ingredientName: string | null };

export function serializeItem(row: ItemJoinRow): GroceryListItemDto {
  return {
    id: row.id,
    ingredientId: row.ingredientId,
    ingredientName: row.ingredientName,
    displayText: row.displayText,
    quantity: row.quantity !== null ? Number(row.quantity) : null,
    unit: row.unit,
    category: row.category as IngredientCategory,
    source: row.source as GrocerySource,
    checked: row.checked,
    checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
    sourceScheduleEntryIds: row.sourceScheduleEntryIds,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeSummary(
  list: GroceryList,
  itemCount: number,
  uncheckedCount: number,
): GroceryListSummaryDto {
  return {
    id: list.id,
    name: list.name,
    startDate: list.startDate,
    endDate: list.endDate,
    isArchived: list.isArchived,
    generatedAt: list.generatedAt.toISOString(),
    lastRegeneratedAt: list.lastRegeneratedAt ? list.lastRegeneratedAt.toISOString() : null,
    itemCount,
    uncheckedCount,
    updatedAt: list.updatedAt.toISOString(),
  };
}

export function serializeDetail(
  list: GroceryList,
  items: GroceryListItemDto[],
): GroceryListDetailDto {
  const uncheckedCount = items.filter((i) => !i.checked).length;
  return {
    ...serializeSummary(list, items.length, uncheckedCount),
    items,
  };
}
