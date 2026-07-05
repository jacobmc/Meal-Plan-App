import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError, ValidationError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { groceryLists } from "@/lib/db/schema";
import { UpdateGroceryListSchema } from "@/lib/validation/grocery";
import { regenerateList } from "@/lib/grocery/regenerate";
import { serializeDetail } from "@/lib/grocery/serialize";
import { loadItemsWithJoin } from "../../_items";

type Ctx = { params: Promise<{ id: string }> };

async function loadOrThrow(listId: string, familyId: string) {
  const [list] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, listId), eq(groceryLists.familyId, familyId)));
  if (!list) throw new NotFoundError("Grocery list not found");
  return list;
}

export const GET = apiHandler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { familyId } = await withFamily();
  const list = await loadOrThrow(id, familyId);
  const items = await loadItemsWithJoin(id);
  return serializeDetail(list, items);
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const { familyId, userId } = await withFamily();
  const list = await loadOrThrow(id, familyId);
  const json = await req.json();
  const parsed = UpdateGroceryListSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid grocery list payload", parsed.error.flatten());
  }
  const input = parsed.data;

  const dateChanged =
    (input.startDate && input.startDate !== list.startDate) ||
    (input.endDate && input.endDate !== list.endDate);

  await db
    .update(groceryLists)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.endDate ? { endDate: input.endDate } : {}),
      updatedAt: new Date(),
      updatedByUserId: userId,
    })
    .where(eq(groceryLists.id, id));

  if (dateChanged) {
    await regenerateList(id, userId);
  }

  const fresh = await loadOrThrow(id, familyId);
  const items = await loadItemsWithJoin(id);
  return serializeDetail(fresh, items);
});

export const DELETE = apiHandler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { familyId } = await withFamily();
  await loadOrThrow(id, familyId);
  await db.delete(groceryLists).where(eq(groceryLists.id, id));
  return null;
});
