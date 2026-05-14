"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";

export function WeekNav({
  prevISO,
  nextISO,
  weekStartISO,
}: {
  prevISO: string;
  nextISO: string;
  weekStartISO: string;
}) {
  const sp = useSearchParams();
  const profile = sp.get("profile");
  const qs = (week: string) => {
    const p = new URLSearchParams();
    p.set("week", week);
    if (profile) p.set("profile", profile);
    return `?${p.toString()}`;
  };
  return (
    <div className="flex items-center gap-2">
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/app/calendar${qs(prevISO)}`}>
        ← Prev
      </Link>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/app/calendar`}>
        Today
      </Link>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/app/calendar${qs(nextISO)}`}>
        Next →
      </Link>
      <span className="text-muted-foreground ml-2 text-sm">Week of {weekStartISO}</span>
    </div>
  );
}
