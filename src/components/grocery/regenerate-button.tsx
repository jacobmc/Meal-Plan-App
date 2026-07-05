"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function RegenerateButton({ listId }: { listId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    const res = await fetch(`/api/grocery/lists/${listId}/regenerate`, { method: "POST" });
    setPending(false);
    if (res.ok) router.refresh();
    setConfirming(false);
  }

  if (!confirming) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Refresh
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        Refresh derived items? Manual items and check-offs are preserved.
      </span>
      <Button type="button" size="sm" onClick={run} disabled={pending}>
        {pending ? "…" : "Confirm"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
