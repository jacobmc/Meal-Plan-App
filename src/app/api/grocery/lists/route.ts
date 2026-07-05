import { and, count, desc, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { ValidationError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems } from "@/lib/db/schema";
import { CreateGroceryListSchema } from "@/lib/validation/grocery";
import { generateDerivedItems } from "@/lib/grocery/aggregate";
import { serializeDetail, serializeSummary } from "@/lib/grocery/serialize";
import { loadItemsWithJoin } from "../_items";

function defaultName(startDate: string, endDate: string): string {
  return `Groceries — ${startDate} → ${endDate}`;
}

export const GET = apiHandler(async (req) => {
  const { familyId } = await withFamily();
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "true";

  const rows = await db
    .select({
      list: groceryLists,
      itemCount: count(groceryListItems.id),
    })
    .from(groceryLists)
    .leftJoin(groceryListItems, eq(groceryListItems.listId, groceryLists.id))
    .where(
      includeArchived
        ? eq(groceryLists.familyId, familyId)
        : and(eq(groceryLists.familyId, familyId), eq(groceryLists.isArchived, false)),
    )
    .groupBy(groceryLists.id)
    .orderBy(desc(groceryLists.generatedAt));

  // Second query for unchecked counts — avoids nested aggregates.
  const uncheckedRows = await db
    .select({ listId: groceryListItems.listId, unchecked: count(groceryListItems.id) })
    .from(groceryListItems)
    .innerJoin(groceryLists, eq(groceryListItems.listId, groceryLists.id))
    .where(and(eq(groceryLists.familyId, familyId), eq(groceryListItems.checked, false)))
    .groupBy(groceryListItems.listId);
  const uncheckedByList = new Map(uncheckedRows.map((r) => [r.listId, Number(r.unchecked)]));

  return {
    items: rows.map((r) =>
      serializeSummary(r.list, Number(r.itemCount), uncheckedByList.get(r.list.id) ?? 0),
    ),
  };
});

export const POST = apiHandler(async (req) => {
  const { familyId, userId } = await withFamily();
  const json = await req.json();
  const parsed = CreateGroceryListSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid grocery list payload", parsed.error.flatten());
  }
  const input = parsed.data;
  const name = input.name ?? defaultName(input.startDate, input.endDate);

  const detail = await db.transaction(async (tx) => {
    const [list] = await tx
      .insert(groceryLists)
      .values({
        familyId,
        name,
        startDate: input.startDate,
        endDate: input.endDate,
        createdByUserId: userId,
        updatedByUserId: userId,
      })
      .returning();
    if (!list) throw new ValidationError("Failed to create list");

    const derived = await generateDerivedItems(familyId, input.startDate, input.endDate);
    if (derived.length > 0) {
      await tx.insert(groceryListItems).values(
        derived.map((it) => ({
          listId: list.id,
          ingredientId: it.ingredientId,
          displayText: it.displayText,
          quantity: it.quantity !== null ? String(it.quantity) : null,
          unit: it.unit,
          category: it.category,
          source: "derived" as const,
          sourceScheduleEntryIds: it.sourceScheduleEntryIds,
        })),
      );
    }

    return list;
  });

  const items = await loadItemsWithJoin(detail.id);
  return serializeDetail(detail, items);
});
