"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/http/fetcher";

export interface ProfileFormProps {
  initial?: { id?: string; displayName: string; color: string };
  onSaved: () => void;
  onCancel?: () => void;
}

export function ProfileForm({ initial, onSaved, onCancel }: ProfileFormProps) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [color, setColor] = useState(initial?.color ?? "#94a3b8");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (initial?.id) {
        await api(`/api/profiles/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify({ displayName, color }),
        });
      } else {
        await api("/api/profiles", {
          method: "POST",
          body: JSON.stringify({ displayName, color }),
        });
      }
      onSaved();
    } catch (err) {
      if (err instanceof ClientApiError) setError(err.message);
      else setError("Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">Name</Label>
        <Input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          maxLength={80}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="color">Color</Label>
        <Input
          id="color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-10 w-20 p-1"
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {initial?.id ? "Save" : "Create profile"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
