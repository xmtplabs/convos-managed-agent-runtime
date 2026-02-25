import { test, expect } from "@playwright/test";
import { setMockState } from "./helpers";

// ---------------------------------------------------------------------------
// Template page tests (/a/:slug)
//
// Verifies SSR rendering, OG meta tags, 404 handling, and interactive elements
// on the individual assistant template pages.
// ---------------------------------------------------------------------------

/** A known slug from the fixture catalog. */
const KNOWN_SLUG = "the-racket-club-manager";
const KNOWN_NAME = "The Racket Club Manager";

test.beforeEach(async () => {
  await setMockState("idle");
});

test.describe("Template page SSR", () => {
  test("renders agent name, emoji, description, and category", async ({
    page,
  }) => {
    await page.goto(`/a/${KNOWN_SLUG}`);
    await expect(page.locator("h1")).toContainText(KNOWN_NAME);
    await expect(page.locator('[role="img"]')).toBeVisible();
    // Category badge
    await expect(page.getByText("Sports")).toBeVisible();
    // Description is rendered
    await expect(page.locator("main p").first()).not.toBeEmpty();
  });

  test("renders skill badges when skills are present", async ({ page }) => {
    await page.goto(`/a/${KNOWN_SLUG}`);
    // The Racket Club Manager has skills: Search, Browse, Schedule
    await expect(page.getByText("Search")).toBeVisible();
    await expect(page.getByText("Browse")).toBeVisible();
    await expect(page.getByText("Schedule")).toBeVisible();
  });

  test("renders action buttons", async ({ page }) => {
    await page.goto(`/a/${KNOWN_SLUG}`);
    await expect(
      page.getByRole("link", { name: "Add to group chat" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy prompt" }),
    ).toBeVisible();
  });

  test("renders QR code section", async ({ page }) => {
    await page.goto(`/a/${KNOWN_SLUG}`);
    await expect(page.getByText("Share this assistant")).toBeVisible();
    await expect(
      page.getByAltText(`QR code for ${KNOWN_NAME}`),
    ).toBeVisible();
  });

  test("has correct OG meta tags", async ({ page }) => {
    await page.goto(`/a/${KNOWN_SLUG}`);
    const ogTitle = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content");
    expect(ogTitle).toContain(KNOWN_NAME);

    const ogDescription = await page
      .locator('meta[property="og:description"]')
      .getAttribute("content");
    expect(ogDescription).toBeTruthy();

    const ogImage = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content");
    expect(ogImage).toContain(`/og/${KNOWN_SLUG}`);

    const twitterCard = await page
      .locator('meta[name="twitter:card"]')
      .getAttribute("content");
    expect(twitterCard).toBe("summary_large_image");
  });

  test("has Convos branding header with link to homepage", async ({
    page,
  }) => {
    await page.goto(`/a/${KNOWN_SLUG}`);
    const homeLink = page.locator("header a[href='/']");
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toContainText("Convos");
  });
});

test.describe("Template page 404", () => {
  test("returns 404 for unknown slug", async ({ page }) => {
    const response = await page.goto("/a/this-agent-does-not-exist-at-all");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Assistant not found")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browse all assistants" }),
    ).toBeVisible();
  });
});

test.describe("Template page actions", () => {
  test("Add to group chat links to homepage with agent param", async ({
    page,
  }) => {
    await page.goto(`/a/${KNOWN_SLUG}`);
    const addLink = page.getByRole("link", { name: "Add to group chat" });
    const href = await addLink.getAttribute("href");
    expect(href).toContain(`/?agent=${KNOWN_SLUG}`);
  });
});
