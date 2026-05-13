export function computeDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined,
): string {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();

  let candidate: string;
  if (first && last) {
    candidate = `${first} ${last}`;
  } else if (first) {
    candidate = first;
  } else {
    const localPart = (email ?? "").split("@")[0]?.trim() ?? "";
    candidate = localPart || "User";
  }

  return candidate.slice(0, 80);
}
