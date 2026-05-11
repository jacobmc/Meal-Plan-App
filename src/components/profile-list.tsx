"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProfileForm } from "./profile-form";
import { api } from "@/lib/http/fetcher";

export interface ProfileItem {
  id: string;
  displayName: string;
  color: string;
  isActive: boolean;
}

export function ProfileList({ initialItems }: { initialItems: ProfileItem[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    setCreating(false);
    setEditingId(null);
    startTransition(() => router.refresh());
  }

  async function archive(id: string) {
    if (!confirm("Archive this profile?")) return;
    await api(`/api/profiles/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Profiles</h2>
        {!creating ? (
          <Button onClick={() => setCreating(true)}>Add profile</Button>
        ) : null}
      </div>

      {creating ? (
        <Card className="p-4">
          <ProfileForm onSaved={refresh} onCancel={() => setCreating(false)} />
        </Card>
      ) : null}

      <ul className="flex flex-col gap-2">
        {initialItems.map((p) => (
          <li key={p.id}>
            <Card className="flex flex-row items-center gap-3 p-3">
              <span
                className="h-6 w-6 shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
                aria-hidden
              />
              {editingId === p.id ? (
                <div className="flex-1">
                  <ProfileForm
                    initial={p}
                    onSaved={refresh}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : (
                <>
                  <div className="flex-1">
                    <div className="font-medium">{p.displayName}</div>
                    {!p.isActive ? (
                      <div className="text-xs text-muted-foreground">Archived</div>
                    ) : null}
                  </div>
                  <Button variant="ghost" onClick={() => setEditingId(p.id)}>
                    Edit
                  </Button>
                  {p.isActive ? (
                    <Button variant="ghost" onClick={() => archive(p.id)} disabled={pending}>
                      Archive
                    </Button>
                  ) : null}
                </>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
