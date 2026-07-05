import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems, type NewGroceryListItem } from "@/lib/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/auth/errors";

export async function carryOverUnchecked(
  fromListId: string,
  toListId: string,
  actorUserId: string,
): Promise<{ added: number }> {
  if (fromListId === toListId) {
    throw new ValidationError("Source and target lists must differ");
  }
  const [from] = await db.select().from(groceryLists).where(eq(groceryLists.id, fromListId));
  const [to] = await db.select().from(groceryLists).where(eq(groceryLists.id, toListId));
  if (!from) throw new NotFoundError("Source list not found");
  if (!to) throw new NotFoundError("Target list not found");
  if (from.familyId !== to.familyId) throw new ForbiddenError("Cross-family carry-over");

  const unchecked = await db
    .select()
    .from(groceryListItems)
    .where(and(eq(groceryListItems.listId, fromListId), eq(groceryListItems.checked, false)));

  if (unchecked.length === 0) return { added: 0 };

  const inserts: NewGroceryListItem[] = unchecked.map((row) => ({
    listId: toListId,
    ingredientId: row.ingredientId,
    displayText: row.displayText,
    quantity: row.quantity,
    unit: row.unit,
    category: row.category,
    source: "manual",
    checked: false,
    sourceScheduleEntryIds: [],
  }));

  await db.transaction(async (tx) => {
    await tx.insert(groceryListItems).values(inserts);
    await tx
      .update(groceryLists)
      .set({ updatedAt: new Date(), updatedByUserId: actorUserId })
      .where(eq(groceryLists.id, toListId));
  });

  return { added: inserts.length };
}
