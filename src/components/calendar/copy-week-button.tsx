"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CopyWeekButton({
  fromWeekISO,
  toWeekISO,
}: {
  fromWeekISO: string;
  toWeekISO: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!confirm(`Copy last week (${fromWeekISO}) into this week (${toWeekISO})?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/schedule/copy-week`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromWeekISO, to: toWeekISO }),
      });
      if (res.ok) router.refresh();
      else alert("Copy failed");
    } finally { setBusy(false); }
  }

  return (
    <Button size="sm" variant="outline" onClick={run} disabled={busy}>
      Copy last week
    </Button>
  );
}
