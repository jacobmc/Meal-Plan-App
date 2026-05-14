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

  test("calendar: plan, override, eat-out, copy-last-week", async ({ page }) => {
    test.skip(
      !E2E_USER_EMAIL || !E2E_USER_PASSWORD,
      "Calendar flow requires E2E_USER_EMAIL + E2E_USER_PASSWORD",
    );
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(E2E_USER_EMAIL!);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel(/password/i).fill(E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /continue|sign in/i }).click();
    await page.waitForURL("**/app");

    // Pre-req: signed-in session is established by the sign-in flow (mirror Phase 1's pattern).
    await page.goto("/app/calendar");

    // The page should land on the current week; we don't assert the week date, only the shape.
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

    // 1. Pick a meal for the first dinner slot
    await page.locator('button[aria-label="Edit dinner"]').first().click();
    await page.getByPlaceholder("Search meals…").fill(""); // load default list
    await page.locator("ul li button").first().click();
    await page.getByRole("button", { name: "Save" }).click();

    // 2. Mark first lunch as eating out
    await page.locator('button[aria-label="Edit lunch"]').first().click();
    await page.getByRole("button", { name: "Eating out" }).click();
    await page.getByPlaceholder("Cost (optional)").fill("12.50");
    await page.getByPlaceholder("Label (e.g. Chipotle)").fill("Chipotle");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("text=🍴")).toBeVisible();

    // 3. Override the first dinner for a specific profile
    // Switch view to a profile via the dropdown
    await page.getByRole("combobox", { name: "View profile" }).selectOption({ index: 1 });
    await page.waitForURL(/profile=/);
    await page.locator('button[aria-label="Edit dinner"]').first().click();
    await page.locator("ul li button").first().click();
    await page.getByRole("button", { name: "Save" }).click();
    // Back to family default
    await page.getByRole("combobox", { name: "View profile" }).selectOption("default");
    await page.waitForURL((u) => !u.searchParams.has("profile"));

    // 4. Copy last week — set the dialog handler BEFORE clicking the trigger
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Copy last week" }).click();
    // Toast / page refresh; just confirm we're still on the calendar
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  });
});
