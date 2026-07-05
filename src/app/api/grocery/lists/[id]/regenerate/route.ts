import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { groceryLists } from "@/lib/db/schema";
import { regenerateList } from "@/lib/grocery/regenerate";
import { serializeDetail } from "@/lib/grocery/serialize";
import { loadItemsWithJoin } from "../../../_items";

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { familyId, userId } = await withFamily();
  const [list] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.familyId, familyId)));
  if (!list) throw new NotFoundError("Grocery list not found");

  await regenerateList(id, userId);

  const [fresh] = await db.select().from(groceryLists).where(eq(groceryLists.id, id));
  const items = await loadItemsWithJoin(id);
  return serializeDetail(fresh!, items);
});
