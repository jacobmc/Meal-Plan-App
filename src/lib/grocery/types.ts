export { INGREDIENT_CATEGORIES } from "@/lib/validation/ingredient";
export type { IngredientCategory } from "@/lib/validation/ingredient";
import type { IngredientCategory } from "@/lib/validation/ingredient";

export type GrocerySource = "derived" | "manual";

// Output of the aggregation step — feeds INSERT rows for grocery_list_items.
export type DerivedItem = {
  ingredientId: string | null;
  displayText: string | null;
  quantity: number | null;
  unit: string | null; // canonical (post-normalization)
  category: IngredientCategory;
  sourceScheduleEntryIds: string[];
};

// Shape returned to the client from every list endpoint.
export type GroceryListItemDto = {
  id: string;
  ingredientId: string | null;
  ingredientName: string | null;
  displayText: string | null;
  quantity: number | null;
  unit: string | null;
  category: IngredientCategory;
  source: GrocerySource;
  checked: boolean;
  checkedAt: string | null;
  sourceScheduleEntryIds: string[];
  sortOrder: number;
  updatedAt: string;
};

export type GroceryListSummaryDto = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isArchived: boolean;
  generatedAt: string;
  lastRegeneratedAt: string | null;
  itemCount: number;
  uncheckedCount: number;
  updatedAt: string;
};

export type GroceryListDetailDto = GroceryListSummaryDto & {
  items: GroceryListItemDto[];
};
