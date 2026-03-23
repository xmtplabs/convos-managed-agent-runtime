import { expect, test } from "@playwright/test";
import { setMockState } from "./helpers";

test.beforeEach(async () => {
  await setMockState("idle");
});

test.describe("First-release contact channel filter", () => {
  test("homepage hides contact-channel assistants and marketing copy", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });

    await expect(page.locator(".story-text").first()).toContainText(
      "browse the web and use crypto wallets",
    );
    await expect(page.locator(".story-text").first()).not.toContainText(
      /email|sms|phone/i,
    );

    await page.locator(".prompt-store").scrollIntoViewIfNeeded();
    await page.locator(".ps-search").fill("email");
    await expect(page.getByText("No assistants match your search")).toBeVisible();
    await expect(page.getByText("Hide My Email")).toHaveCount(0);

    await page.locator(".ps-search").fill("phone");
    await expect(page.getByText("No assistants match your search")).toBeVisible();
    await expect(page.getByText("Hide My Phone")).toHaveCount(0);
  });

  test("safety page omits email and phone provider rows", async ({ page }) => {
    await page.goto("/safety");
    await expect(page.getByRole("heading", { name: "Safety & Privacy" })).toBeVisible();
    await expect(page.getByText("AgentMail")).toHaveCount(0);
    await expect(page.getByText("Telnyx")).toHaveCount(0);
    await expect(page.getByText("SMS & phone")).toHaveCount(0);
  });
});
