"use client";
import Link from "next/link";
import { parseISODate } from "@/lib/schedule/week";
import type { GroceryListSummaryDto } from "@/lib/grocery/types";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function GroceryListCard({ item }: { item: GroceryListSummaryDto }) {
  const progress =
    item.itemCount === 0
      ? 0
      : Math.round(((item.itemCount - item.uncheckedCount) / item.itemCount) * 100);
  return (
    <Link
      href={`/app/grocery/${item.id}`}
      className="block rounded-lg border p-4 hover:bg-muted transition"
    >
      <div className="flex items-baseline justify-between">
        <div className="font-medium">{item.name}</div>
        <div className="text-xs text-muted-foreground">
          {DATE_FMT.format(parseISODate(item.startDate))} →{" "}
          {DATE_FMT.format(parseISODate(item.endDate))}
        </div>
      </div>
      <div className="mt-2 text-sm text-muted-foreground">
        {item.itemCount - item.uncheckedCount} of {item.itemCount} checked ({progress}%)
        {item.isArchived ? " · archived" : ""}
      </div>
    </Link>
  );
}
