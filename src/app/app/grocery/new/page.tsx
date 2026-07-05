import { eq } from "drizzle-orm";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { families } from "@/lib/db/schema";
import { GroceryListForm } from "@/components/grocery/grocery-list-form";

export default async function NewGroceryListPage() {
  const { familyId } = await withFamily();
  const [family] = await db.select().from(families).where(eq(families.id, familyId));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New grocery list</h1>
      <GroceryListForm weekStartsOn={family?.weekStartsOn ?? 0} />
    </div>
  );
}
