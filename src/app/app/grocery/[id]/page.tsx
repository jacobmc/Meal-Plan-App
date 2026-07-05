import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { groceryLists } from "@/lib/db/schema";
import { serializeDetail } from "@/lib/grocery/serialize";
import { loadItemsWithJoin } from "@/app/api/grocery/_items";
import { GroceryListView } from "@/components/grocery/grocery-list-view";

export default async function GroceryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { familyId } = await withFamily();
  const [list] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.familyId, familyId)));
  if (!list) notFound();

  const items = await loadItemsWithJoin(id);
  const detail = serializeDetail(list, items);
  return <GroceryListView initial={detail} />;
}
