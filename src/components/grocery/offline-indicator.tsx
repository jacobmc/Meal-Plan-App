"use client";
import { useEffect, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";

export function OfflineIndicator() {
  const online = useOnlineStatus();
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data as { type?: string; count?: number } | undefined;
      if (data?.type === "grocery-checkoff-queue-status" && typeof data.count === "number") {
        setQueued(data.count);
      }
    }
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  if (online && queued === 0) return null;

  return (
    <div className="fixed bottom-4 inset-x-4 mx-auto max-w-sm rounded-lg border bg-background/90 backdrop-blur px-3 py-2 text-sm shadow">
      {!online && "Offline — check-offs will sync when you reconnect."}
      {online && queued > 0 && `Syncing ${queued} update${queued > 1 ? "s" : ""}…`}
    </div>
  );
}
