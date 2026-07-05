import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError, ValidationError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems, ingredients } from "@/lib/db/schema";
import { CreateGroceryItemSchema } from "@/lib/validation/grocery";
import { normalizeUnit } from "@/lib/units/normalize";
import { loadItemWithJoin } from "../../../_items";

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const { familyId } = await withFamily();
  const [list] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.familyId, familyId)));
  if (!list) throw new NotFoundError("Grocery list not found");

  const json = await req.json();
  const parsed = CreateGroceryItemSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid grocery item payload", parsed.error.flatten());
  }
  const input = parsed.data;

  if (input.ingredientId) {
    const [ing] = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.id, input.ingredientId), eq(ingredients.familyId, familyId)));
    if (!ing) throw new NotFoundError("Ingredient not found");
  }

  const [row] = await db
    .insert(groceryListItems)
    .values({
      listId: id,
      ingredientId: input.ingredientId ?? null,
      displayText: input.displayText ?? null,
      quantity: input.quantity !== undefined ? String(input.quantity) : null,
      unit: normalizeUnit(input.unit ?? null),
      category: input.category,
      source: "manual",
    })
    .returning();
  if (!row) throw new ValidationError("Insert failed");

  return await loadItemWithJoin(row.id);
});
