"use client";
import { useRouter, useSearchParams } from "next/navigation";
import type { GroceryListSummaryDto } from "@/lib/grocery/types";
import { GroceryListCard } from "./grocery-list-card";

export function GroceryListIndex({
  items,
  includeArchived,
}: {
  items: GroceryListSummaryDto[];
  includeArchived: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function toggleArchived() {
    const next = new URLSearchParams(params);
    if (includeArchived) next.delete("includeArchived");
    else next.set("includeArchived", "true");
    router.replace(`?${next.toString()}`);
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={toggleArchived}
        className="text-xs text-muted-foreground underline"
      >
        {includeArchived ? "Hide archived" : "Show archived"}
      </button>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No grocery lists yet.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <GroceryListCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
