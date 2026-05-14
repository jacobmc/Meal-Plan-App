"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

type ProfileOption = { id: string; displayName: string; color: string };

export function ProfileToggle({
  profiles,
  selectedProfileId,
}: {
  profiles: ProfileOption[];
  selectedProfileId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function setProfile(value: string) {
    const p = new URLSearchParams(sp.toString());
    if (value === "default") p.delete("profile");
    else p.set("profile", value);
    const qs = p.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  return (
    <select
      value={selectedProfileId ?? "default"}
      onChange={(e) => setProfile(e.target.value)}
      className="rounded border px-2 py-1 text-sm"
      aria-label="View profile"
    >
      <option value="default">Family default</option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>{p.displayName}</option>
      ))}
    </select>
  );
}
