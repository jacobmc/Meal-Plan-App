import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError, ValidationError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { groceryLists } from "@/lib/db/schema";
import { CarryOverSchema } from "@/lib/validation/grocery";
import { carryOverUnchecked } from "@/lib/grocery/carry-over";

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const { familyId, userId } = await withFamily();

  const json = await req.json();
  const parsed = CarryOverSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid carry-over payload", parsed.error.flatten());
  }
  const input = parsed.data;
  if (input.toListId === id) throw new ValidationError("Source and target lists must differ");

  const [src] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.familyId, familyId)));
  const [dst] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, input.toListId), eq(groceryLists.familyId, familyId)));
  if (!src || !dst) throw new NotFoundError("List not found");

  return await carryOverUnchecked(id, input.toListId, userId);
});
