import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems, type NewGroceryListItem } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/auth/errors";
import { generateDerivedItems } from "./aggregate";

type PreservedCheck = {
  checkedAt: Date | null;
  checkedByUserId: string | null;
};

function matchKey(row: {
  ingredientId: string | null;
  displayText: string | null;
  unit: string | null;
}): string {
  if (row.ingredientId) {
    return `s:${row.ingredientId}:${row.unit ?? ""}`;
  }
  const norm = (row.displayText ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `m:${norm}`;
}

export async function regenerateList(listId: string, actorUserId: string): Promise<void> {
  const [list] = await db.select().from(groceryLists).where(eq(groceryLists.id, listId));
  if (!list) throw new NotFoundError("Grocery list not found");

  const current = await db
    .select()
    .from(groceryListItems)
    .where(and(eq(groceryListItems.listId, listId), eq(groceryListItems.source, "derived")));

  const preservedByKey = new Map<string, PreservedCheck>();
  for (const row of current) {
    if (!row.checked) continue;
    preservedByKey.set(matchKey(row), {
      checkedAt: row.checkedAt,
      checkedByUserId: row.checkedByUserId,
    });
  }

  const newItems = await generateDerivedItems(list.familyId, list.startDate, list.endDate);

  await db.transaction(async (tx) => {
    await tx
      .delete(groceryListItems)
      .where(and(eq(groceryListItems.listId, listId), eq(groceryListItems.source, "derived")));

    if (newItems.length > 0) {
      const inserts: NewGroceryListItem[] = newItems.map((it) => {
        const preserved = preservedByKey.get(
          matchKey({ ingredientId: it.ingredientId, displayText: it.displayText, unit: it.unit }),
        );
        return {
          listId,
          ingredientId: it.ingredientId,
          displayText: it.displayText,
          quantity: it.quantity !== null ? String(it.quantity) : null,
          unit: it.unit,
          category: it.category,
          source: "derived",
          checked: preserved !== undefined,
          checkedAt: preserved?.checkedAt ?? null,
          checkedByUserId: preserved?.checkedByUserId ?? null,
          sourceScheduleEntryIds: it.sourceScheduleEntryIds,
        };
      });
      await tx.insert(groceryListItems).values(inserts);
    }

    await tx
      .update(groceryLists)
      .set({ lastRegeneratedAt: new Date(), updatedByUserId: actorUserId, updatedAt: new Date() })
      .where(eq(groceryLists.id, listId));
  });
}
