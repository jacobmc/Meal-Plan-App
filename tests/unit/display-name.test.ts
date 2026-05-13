import { describe, it, expect } from "vitest";
import { computeDisplayName } from "@/lib/webhooks/display-name";

describe("computeDisplayName", () => {
  it("uses first + last when both present", () => {
    expect(computeDisplayName("Ada", "Lovelace", "ada@x.com")).toBe("Ada Lovelace");
  });
  it("uses first only when last is empty", () => {
    expect(computeDisplayName("Ada", "", "ada@x.com")).toBe("Ada");
    expect(computeDisplayName("Ada", null, "ada@x.com")).toBe("Ada");
  });
  it("uses email-local-part when no first name", () => {
    expect(computeDisplayName("", "Lovelace", "ada@x.com")).toBe("ada");
    expect(computeDisplayName(null, null, "ada.lovelace@x.com")).toBe("ada.lovelace");
  });
  it("trims whitespace on the inputs", () => {
    expect(computeDisplayName("  Ada  ", "  Lovelace  ", "")).toBe("Ada Lovelace");
  });
  it("clamps to 80 characters", () => {
    const long = "a".repeat(200);
    expect(computeDisplayName(long, "", "x@y.com")).toHaveLength(80);
  });
  it("falls back to 'User' when nothing usable is provided", () => {
    expect(computeDisplayName(null, null, null)).toBe("User");
    expect(computeDisplayName("", "", "")).toBe("User");
  });
});
