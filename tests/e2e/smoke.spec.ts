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

  test("authenticated user can create, search, filter, edit, and delete a recipe", async ({ page }) => {
    test.skip(
      !E2E_USER_EMAIL || !E2E_USER_PASSWORD,
      "Recipe flow requires E2E_USER_EMAIL + E2E_USER_PASSWORD",
    );
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(E2E_USER_EMAIL!);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel(/password/i).fill(E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /continue|sign in/i }).click();
    await page.waitForURL("**/app");

    // Create
    const unique = `Test Recipe ${Date.now()}`;
    await page.goto("/app/meals/new");
    await page.getByLabel("Name").fill(unique);
    await page.getByRole("button", { name: "Add ingredient" }).click();
    await page.getByPlaceholder("Ingredient or free text").fill("a pinch of salt");
    // Tag
    const tag = `e2etag${Date.now().toString(36)}`;
    await page.getByPlaceholder(/Add tag/).fill(tag);
    await page.getByPlaceholder(/Add tag/).press("Enter");
    await page.getByRole("button", { name: "Create recipe" }).click();
    await expect(page.getByRole("heading", { name: unique })).toBeVisible();

    // Search by name prefix
    await page.goto("/app/meals");
    await page.getByPlaceholder("Search by name…").fill(unique.slice(0, 6));
    await expect(page.getByRole("link", { name: new RegExp(unique) })).toBeVisible();

    // Filter by tag
    await page.getByPlaceholder("Search by name…").fill("");
    await page.getByRole("button", { name: tag }).click();
    await expect(page.getByRole("link", { name: new RegExp(unique) })).toBeVisible();

    // Edit
    await page.getByRole("link", { name: new RegExp(unique) }).click();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Name").fill(`${unique} (edited)`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: `${unique} (edited)` })).toBeVisible();

    // Delete
    page.once("dialog", (d) => d.accept());
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.waitForURL("**/app/meals");
    await expect(page.getByText(new RegExp(unique))).toHaveCount(0);
  });
});
