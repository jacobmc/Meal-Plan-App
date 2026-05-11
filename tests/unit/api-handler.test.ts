import { describe, it, expect } from "vitest";
import { apiHandler } from "@/lib/auth/api-handler";
import {
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from "@/lib/auth/errors";

function makeRequest() {
  return new Request("http://localhost/test");
}

const ctx = { params: Promise.resolve({}) };

describe("apiHandler", () => {
  it("returns the handler's resolved value as 200 JSON", async () => {
    const handler = apiHandler(async () => ({ hello: "world" }));
    const res = await handler(makeRequest(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
  });

  it("returns 204 when handler resolves to undefined", async () => {
    const handler = apiHandler(async () => undefined);
    const res = await handler(makeRequest(), ctx);
    expect(res.status).toBe(204);
  });

  it("converts UnauthorizedError to 401 with envelope", async () => {
    const handler = apiHandler(async () => {
      throw new UnauthorizedError();
    });
    const res = await handler(makeRequest(), ctx);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "unauthorized", message: "Authentication required" },
    });
  });

  it("converts NotFoundError to 404 with custom message", async () => {
    const handler = apiHandler(async () => {
      throw new NotFoundError("Profile not found");
    });
    const res = await handler(makeRequest(), ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "Profile not found" },
    });
  });

  it("includes details on ValidationError", async () => {
    const handler = apiHandler(async () => {
      throw new ValidationError("Bad input", { field: "name" });
    });
    const res = await handler(makeRequest(), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "validation_failed",
        message: "Bad input",
        details: { field: "name" },
      },
    });
  });

  it("converts unknown errors to 500 internal", async () => {
    const handler = apiHandler(async () => {
      throw new Error("kaboom");
    });
    const res = await handler(makeRequest(), ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "internal", message: "Internal server error" },
    });
  });
});
