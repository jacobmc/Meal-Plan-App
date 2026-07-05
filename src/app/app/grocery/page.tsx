import { and, count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { groceryLists, groceryListItems } from "@/lib/db/schema";
import { serializeSummary } from "@/lib/grocery/serialize";
import { GroceryListIndex } from "@/components/grocery/grocery-list-index";
import { buttonVariants } from "@/components/ui/button";

type Search = { includeArchived?: string };

export default async function GroceryIndexPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const includeArchived = sp.includeArchived === "true";
  const { familyId } = await withFamily();

  const rows = await db
    .select({ list: groceryLists, itemCount: count(groceryListItems.id) })
    .from(groceryLists)
    .leftJoin(groceryListItems, eq(groceryListItems.listId, groceryLists.id))
    .where(
      includeArchived
        ? eq(groceryLists.familyId, familyId)
        : and(eq(groceryLists.familyId, familyId), eq(groceryLists.isArchived, false)),
    )
    .groupBy(groceryLists.id)
    .orderBy(desc(groceryLists.generatedAt));

  const uncheckedRows = await db
    .select({ listId: groceryListItems.listId, unchecked: count(groceryListItems.id) })
    .from(groceryListItems)
    .innerJoin(groceryLists, eq(groceryListItems.listId, groceryLists.id))
    .where(and(eq(groceryLists.familyId, familyId), eq(groceryListItems.checked, false)))
    .groupBy(groceryListItems.listId);
  const uncheckedByList = new Map(uncheckedRows.map((r) => [r.listId, Number(r.unchecked)]));

  const items = rows.map((r) =>
    serializeSummary(r.list, Number(r.itemCount), uncheckedByList.get(r.list.id) ?? 0),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Groceries</h1>
        <Link href="/app/grocery/new" className={buttonVariants({ size: "sm" })}>
          New list
        </Link>
      </div>
      <GroceryListIndex items={items} includeArchived={includeArchived} />
    </div>
  );
}
