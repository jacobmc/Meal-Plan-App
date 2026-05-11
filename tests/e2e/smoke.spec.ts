import { test, expect } from "@playwright/test";

const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL;
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD;

test.describe("foundation smoke", () => {
  test("landing page renders without auth", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Meal Plan" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("manifest is served", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Meal Plan");
    expect(json.start_url).toBe("/app");
  });

  test("authenticated user can view profiles page", async ({ page }) => {
    test.skip(
      !E2E_USER_EMAIL || !E2E_USER_PASSWORD,
      "Authenticated flow requires E2E_USER_EMAIL + E2E_USER_PASSWORD",
    );
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(E2E_USER_EMAIL!);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel(/password/i).fill(E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /continue|sign in/i }).click();
    await page.waitForURL("**/app");

    await page.goto("/app/settings/profiles");
    await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible();
  });
});
