import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError, ValidationError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems } from "@/lib/db/schema";
import { UpdateGroceryItemSchema } from "@/lib/validation/grocery";
import { normalizeUnit } from "@/lib/units/normalize";
import { loadItemWithJoin } from "../../../../_items";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

async function loadItemOrThrow(itemId: string, listId: string, familyId: string) {
  const [row] = await db
    .select({ item: groceryListItems })
    .from(groceryListItems)
    .innerJoin(groceryLists, eq(groceryListItems.listId, groceryLists.id))
    .where(
      and(
        eq(groceryListItems.id, itemId),
        eq(groceryListItems.listId, listId),
        eq(groceryLists.familyId, familyId),
      ),
    );
  if (!row) throw new NotFoundError("Item not found");
  return row.item;
}

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const { id, itemId } = await ctx.params;
  const { familyId, userId } = await withFamily();
  await loadItemOrThrow(itemId, id, familyId);

  const json = await req.json();
  const parsed = UpdateGroceryItemSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid grocery item payload", parsed.error.flatten());
  }
  const input = parsed.data;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.displayText !== undefined) patch.displayText = input.displayText;
  if (input.quantity !== undefined) {
    patch.quantity = input.quantity !== null ? String(input.quantity) : null;
  }
  if (input.unit !== undefined) {
    patch.unit = input.unit !== null ? normalizeUnit(input.unit) : null;
  }
  if (input.category !== undefined) patch.category = input.category;
  if (input.checked !== undefined) {
    patch.checked = input.checked;
    patch.checkedAt = input.checked ? new Date() : null;
    patch.checkedByUserId = input.checked ? userId : null;
  }

  await db.update(groceryListItems).set(patch).where(eq(groceryListItems.id, itemId));

  return await loadItemWithJoin(itemId);
});

export const DELETE = apiHandler<Ctx>(async (_req, ctx) => {
  const { id, itemId } = await ctx.params;
  const { familyId } = await withFamily();
  await loadItemOrThrow(itemId, id, familyId);
  await db.delete(groceryListItems).where(eq(groceryListItems.id, itemId));
  return null;
});
