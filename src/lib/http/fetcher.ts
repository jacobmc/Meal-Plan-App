export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export class ClientApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = "ClientApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body as ApiErrorBody | null;
    throw new ClientApiError(
      err?.error.code ?? "internal",
      err?.error.message ?? `Request failed: ${res.status}`,
      err?.error.details,
    );
  }
  return body as T;
}
