"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!evt) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md border bg-background p-3 shadow-md">
      <div className="mb-2 text-sm">Install Meal Plan on your home screen?</div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={async () => {
            await evt.prompt();
            await evt.userChoice;
            setEvt(null);
          }}
        >
          Install
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEvt(null)}>
          Not now
        </Button>
      </div>
    </div>
  );
}
