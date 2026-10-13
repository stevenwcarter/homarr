import { mkdirSync } from "node:fs";
import { createId } from "@paralleldrive/cuid2";
import { chromium, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { stringify } from "superjson";
import { describe, test } from "vitest";

import * as sqliteSchema from "../packages/db/schema/sqlite";
import { createHomarrContainer } from "./shared/create-homarr-container";
import { createSqliteDbFileAsync } from "./shared/e2e-db";
import { loginAsync } from "./shared/login";
import { seedAdminUserAsync } from "./shared/seed-admin-user";

const adminCredentials = { username: "countdown-admin", password: createId() + "Aa1!" };
const zone = "America/Detroit";
const plus = (ms: number) => new Date(Date.now() + ms).toISOString();
const d = 86_400_000;
const events = [
  {
    id: "e1",
    label: "Launch day",
    targetUtc: plus(45 * d + 3 * 3_600_000 + 7 * 60_000 + 9_000),
    timeZone: zone,
    recurrence: "none" as const,
    startUtc: plus(-10 * d),
  },
  { id: "e2", label: "Mortgage paid off", targetUtc: plus(23 * 365 * d), timeZone: zone, recurrence: "none" as const },
  {
    id: "e3",
    label: "Anniversary",
    targetUtc: "2020-06-15T16:00:00.000Z",
    timeZone: zone,
    recurrence: "yearly" as const,
  },
  { id: "e4", label: "Already happened", targetUtc: plus(-2 * d), timeZone: zone, recurrence: "none" as const },
];
const item = (overrides: Record<string, unknown>) => ({
  events,
  units: ["day", "hour", "minute"],
  font: "default",
  scale: 100,
  glow: false,
  showProgress: true,
  ...overrides,
});

describe("countdown display layout", () => {
  test("renders without overflow, falls back inline at 1x1, and loads its fonts", async () => {
    const { db, localMountPath } = await createSqliteDbFileAsync();
    const { userId } = await seedAdminUserAsync(db, adminCredentials);
    const boardId = createId();
    const layoutId = createId();
    const sectionId = createId();
    await db.insert(sqliteSchema.boards).values({ id: boardId, name: "countdown-display", creatorId: userId });
    await db.insert(sqliteSchema.layouts).values({ id: layoutId, name: "Base", boardId, columnCount: 12 });
    await db.insert(sqliteSchema.sections).values({ id: sectionId, boardId, kind: "empty", xOffset: 0, yOffset: 0 });
    const tiles = [
      { opts: item({}), x: 0, y: 0, w: 3, h: 2 },
      {
        opts: item({ units: ["day", "hour", "minute", "second"], font: "sevenSegment", glow: true }),
        x: 3,
        y: 0,
        w: 4,
        h: 2,
      },
      {
        opts: item({ units: ["month", "day", "hour", "minute", "second"], font: "orbitron", glow: true, scale: 120 }),
        x: 7,
        y: 0,
        w: 5,
        h: 2,
      },
      { opts: item({ units: ["day"], font: "bebasNeue" }), x: 0, y: 2, w: 6, h: 1 },
      { opts: item({ units: ["week", "day", "hour"], font: "jetbrainsMono" }), x: 6, y: 2, w: 2, h: 1 },
      {
        opts: item({
          events: [events[1]!],
          units: ["decade", "year", "month", "week", "day", "hour", "minute", "second"],
          font: "spaceGrotesk",
          scale: 80,
        }),
        x: 8,
        y: 2,
        w: 4,
        h: 1,
      },
      {
        opts: item({ events: [events[1]!], units: ["second"], font: "sevenSegment", glow: true }),
        x: 0,
        y: 3,
        w: 6,
        h: 2,
      },
      { opts: item({ events: [] }), x: 6, y: 3, w: 2, h: 2 },
      { opts: item({ events: [events[3]!] }), x: 8, y: 3, w: 2, h: 2 },
      {
        opts: item({ units: ["day", "hour", "minute", "second"], font: "sevenSegment", glow: true }),
        x: 10,
        y: 3,
        w: 1,
        h: 1,
      },
    ];
    const ids = tiles.map(() => createId());
    await db
      .insert(sqliteSchema.items)
      .values(tiles.map((t, i) => ({ id: ids[i]!, boardId, kind: "countdownDisplay", options: stringify(t.opts) })));
    await db
      .insert(sqliteSchema.itemLayouts)
      .values(
        tiles.map((t, i) => ({
          itemId: ids[i]!,
          sectionId,
          layoutId,
          xOffset: t.x,
          yOffset: t.y,
          width: t.w,
          height: t.h,
        })),
      );
    await db.update(sqliteSchema.users).set({ homeBoardId: boardId }).where(eq(sqliteSchema.users.id, userId));

    const container = await createHomarrContainer({
      environment: { AUTH_PROVIDERS: "credentials" },
      mounts: { "/appdata": localMountPath },
    }).start();
    const baseUrl = `http://${container.getHost()}:${container.getMappedPort(7575)}`;
    const browser = await chromium.launch();
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    try {
      await loginAsync({ page, baseUrl, credentials: adminCredentials, destination: "/boards/countdown-display" });
      await expect(page.locator("[data-countdown-unit]").first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(5000);

      const shotsDir = process.env.COUNTDOWN_SHOTS_DIR;
      if (shotsDir) {
        mkdirSync(shotsDir, { recursive: true });
        await page.screenshot({ path: `${shotsDir}/board-dark.png`, fullPage: true });
        await page.evaluate(() => document.documentElement.setAttribute("data-mantine-color-scheme", "light"));
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${shotsDir}/board-light.png`, fullPage: true });
        await page.evaluate(() => document.documentElement.setAttribute("data-mantine-color-scheme", "dark"));
      }

      const heroes = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[class*="hero"]')].map((hero) => {
          const numeral = hero.querySelector<HTMLElement>("[data-countdown-unit]");
          const display = (selector: string) => {
            const element = hero.querySelector<HTMLElement>(selector);
            return element ? getComputedStyle(element).display : null;
          };
          return {
            width: hero.offsetWidth,
            height: hero.offsetHeight,
            overflow: hero.scrollHeight - hero.clientHeight,
            // A flex child squeezed below its content height clips its glyphs.
            squeezed: [...hero.children]
              .filter((child) => getComputedStyle(child).display !== "none")
              .map((child) => ({
                name: child.className,
                scroll: child.scrollHeight,
                client: child.clientHeight,
              }))
              .filter((child) => child.scroll > child.client + 1),
            numeralFontSize: numeral ? Number.parseFloat(getComputedStyle(numeral).fontSize) : null,
            tilesHostDisplay: display('[class*="tilesHost"]'),
            inlineHostDisplay: display('[class*="inlineHost"]'),
          };
        }),
      );
      const fonts = await page.evaluate(() => [
        ...new Set([...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family)),
      ]);

      expect(errors).toEqual([]);
      // The empty-events tile renders an empty state instead of a hero.
      expect(heroes.length).toBe(tiles.length - 1);
      for (const hero of heroes) {
        expect(hero.overflow, JSON.stringify(hero)).toBeLessThanOrEqual(1);
        expect(hero.squeezed, JSON.stringify(hero)).toEqual([]);
      }

      const oneByOne = heroes.filter((hero) => hero.width <= 160 && hero.tilesHostDisplay !== null);
      expect(oneByOne).toHaveLength(1);
      expect(oneByOne[0]?.tilesHostDisplay).toBe("none");
      expect(oneByOne[0]?.inlineHostDisplay).not.toBe("none");

      const twoRow = heroes.filter((hero) => hero.height > 300 && hero.numeralFontSize !== null);
      expect(twoRow.length).toBeGreaterThan(0);
      for (const hero of twoRow) expect(hero.numeralFontSize ?? 0).toBeGreaterThanOrEqual(60);

      for (const family of ["DSEG7", "Orbitron", "Bebas", "Space Grotesk", "JetBrains Mono"]) {
        expect(
          fonts.some((loaded) => loaded.includes(family)),
          `font ${family} loaded (got ${JSON.stringify(fonts)})`,
        ).toBe(true);
      }
    } finally {
      await browser.close();
      await container.stop();
    }
  }, 300_000);
});
