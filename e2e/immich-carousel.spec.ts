import { createId } from "@paralleldrive/cuid2";
import { chromium, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { stringify } from "superjson";
import { describe, test } from "vitest";

import * as sqliteSchema from "../packages/db/schema/sqlite";
import { createHomarrContainer } from "./shared/create-homarr-container";
import { createSqliteDbFileAsync } from "./shared/e2e-db";
import { loginAsync } from "./shared/login";
import { seedAdminUserAsync } from "./shared/seed-admin-user";

const adminCredentials = { username: "immich-admin", password: createId() + "Aa1!" };

const baseOptions = {
  albumId: "demo-paris",
  rotationIntervalSeconds: 3600,
  showPhotoInfo: false,
  randomizePhotos: true,
  showNavigationArrows: true,
  photoFit: "fit",
  backdrop: "blur",
  backdropColor: "#000000",
};

const stageOf = (page: Page, itemId: string) => page.locator(`[data-item-id="${itemId}"] [data-asset-id]`).first();
const assetIdOf = async (page: Page, itemId: string) => stageOf(page, itemId).getAttribute("data-asset-id");

describe("immich album carousel", () => {
  test("arrows, stable order, backdrops, and state across edit mode", async () => {
    const { db, localMountPath } = await createSqliteDbFileAsync();
    const { userId } = await seedAdminUserAsync(db, adminCredentials);
    const boardId = createId();
    const layoutId = createId();
    const sectionId = createId();
    const integrationId = createId();
    const blurItemId = createId();
    const colorItemId = createId();
    await db.insert(sqliteSchema.boards).values({ id: boardId, name: "immich", creatorId: userId });
    await db.insert(sqliteSchema.layouts).values({ id: layoutId, name: "Base", boardId, columnCount: 12 });
    await db.insert(sqliteSchema.sections).values({ id: sectionId, boardId, kind: "empty", xOffset: 0, yOffset: 0 });
    await db
      .insert(sqliteSchema.integrations)
      .values({ id: integrationId, name: "Mock immich", url: "http://mock.local", kind: "mock" });
    await db.insert(sqliteSchema.items).values([
      { id: blurItemId, boardId, kind: "immich-albumCarousel", options: stringify(baseOptions) },
      {
        id: colorItemId,
        boardId,
        kind: "immich-albumCarousel",
        options: stringify({ ...baseOptions, backdrop: "color", backdropColor: "#336699" }),
      },
    ]);
    await db.insert(sqliteSchema.integrationItems).values([
      { itemId: blurItemId, integrationId },
      { itemId: colorItemId, integrationId },
    ]);
    await db.insert(sqliteSchema.itemLayouts).values([
      { itemId: blurItemId, sectionId, layoutId, xOffset: 0, yOffset: 0, width: 4, height: 3 },
      { itemId: colorItemId, sectionId, layoutId, xOffset: 4, yOffset: 0, width: 4, height: 3 },
    ]);
    await db.update(sqliteSchema.users).set({ homeBoardId: boardId }).where(eq(sqliteSchema.users.id, userId));

    const container = await createHomarrContainer({
      environment: { AUTH_PROVIDERS: "credentials", UNSAFE_ENABLE_MOCK_INTEGRATION: "true" },
      mounts: { "/appdata": localMountPath },
    }).start();
    const baseUrl = `http://${container.getHost()}:${container.getMappedPort(7575)}`;
    const browser = await chromium.launch();
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error" && !/net::ERR|Failed to load resource/.test(message.text())) {
        errors.push(message.text());
      }
    });

    try {
      await loginAsync({ page, baseUrl, credentials: adminCredentials, destination: "/boards/immich" });
      await expect(stageOf(page, blurItemId)).toBeVisible({ timeout: 30_000 });
      await expect(stageOf(page, colorItemId)).toBeVisible({ timeout: 30_000 });

      // Backdrops.
      await expect(page.locator(`[data-item-id="${blurItemId}"] [data-backdrop-layer="blur"]`)).toHaveCount(1);
      const blurFilter = await page
        .locator(`[data-item-id="${blurItemId}"] [data-backdrop-layer="blur"]`)
        .evaluate((element) => getComputedStyle(element).filter);
      expect(blurFilter).toContain("blur(");
      const colorBackground = await stageOf(page, colorItemId).evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      expect(colorBackground).toBe("rgb(51, 102, 153)");

      // Arrows hidden until hover.
      const nextArrow = page.locator(`[data-item-id="${blurItemId}"] [data-carousel-nav="next"]`);
      const previousArrow = page.locator(`[data-item-id="${blurItemId}"] [data-carousel-nav="previous"]`);
      await page.mouse.move(5, 5);
      await expect.poll(() => nextArrow.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
      await stageOf(page, blurItemId).hover();
      await expect(nextArrow).toBeVisible();
      await expect.poll(() => nextArrow.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");

      // Navigation.
      const first = await assetIdOf(page, blurItemId);
      await nextArrow.click();
      await expect(stageOf(page, blurItemId)).not.toHaveAttribute("data-asset-id", first ?? "");
      const second = await assetIdOf(page, blurItemId);
      await previousArrow.click();
      await expect(stageOf(page, blurItemId)).toHaveAttribute("data-asset-id", first ?? "");
      await nextArrow.click();
      await expect(stageOf(page, blurItemId)).toHaveAttribute("data-asset-id", second ?? "");

      // Pause, then round-trip edit mode.
      const pauseButton = page.locator(`[data-item-id="${blurItemId}"] button[aria-pressed]`).first();
      await pauseButton.click();
      await expect(pauseButton).toHaveAttribute("aria-pressed", "true");
      // The header renders the toggle twice (one copy hidden per breakpoint).
      const editButton = page.getByTestId("board-edit-mode-toggle").filter({ visible: true }).first();
      await editButton.click();
      await expect(editButton).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
      await page.waitForTimeout(1000);
      await editButton.click();
      await expect(editButton).toHaveAttribute("aria-pressed", "false", { timeout: 30_000 });
      await page.waitForTimeout(1000);
      await expect(stageOf(page, blurItemId)).toBeVisible({ timeout: 30_000 });
      expect(await assetIdOf(page, blurItemId)).toBe(second);
      await expect(page.locator(`[data-item-id="${blurItemId}"] button[aria-pressed]`).first()).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      // Reload keeps the photo (sessionStorage).
      await page.reload({ waitUntil: "load" });
      await expect(stageOf(page, blurItemId)).toBeVisible({ timeout: 30_000 });
      expect(await assetIdOf(page, blurItemId)).toBe(second);

      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await container.stop();
    }
  }, 300_000);
});
