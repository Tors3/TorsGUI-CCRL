// Screenshots of every screen for the README and docs/screenshots.
import { fileURLToPath as __f2p } from "node:url";
const __dirname = __f2p(new URL(".", import.meta.url));
import { test } from "@playwright/test";
import { join } from "node:path";

const OUT = join(__dirname, "..", "..", "docs", "screenshots");
const shot = (name: string) => join(OUT, `${name}.png`);

test.describe.configure({ mode: "serial" });

test("screenshots", async ({ page }) => {
  test.setTimeout(240_000);
  const list = await (await page.request.post("/api/tournaments_list", { data: {} })).json();
  const tri = list.find((x: any) => x.record.name.includes("Triumviratus"));
  const live = list.find((x: any) => x.record.state === "running");

  await page.goto("/#/");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: shot("01-dashboard") });

  await page.goto("/#/tournaments");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("02-tournaments") });

  if (tri) {
    await page.goto(`/#/tournaments/${encodeURIComponent(tri.record.id)}`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: shot("03-tournament-standings") });
    await page.getByRole("tab", { name: "Games" }).click();
    await page.waitForTimeout(1200);
    const rows = page.getByTestId("games-table").locator("tbody tr");
    await rows.nth(3).click();
    await page.waitForTimeout(1500);
    // a middlegame position: captured material, eval bar and the next-move arrow are visible
    await page.keyboard.press("Home");
    for (let i = 0; i < 41; i++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(900);
    await page.screenshot({ path: shot("04-pgn-viewer") });
    await page.keyboard.press("t");
    await page.waitForTimeout(900);
    await page.screenshot({ path: shot("18-pgn-viewer-theater") });
    await page.keyboard.press("Escape");
  }
  if (live) {
    await page.goto(`/#/tournaments/${encodeURIComponent(live.record.id)}`);
    await page.waitForTimeout(1500);
    await page.getByRole("tab", { name: /Lanes/ }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot("05-tournament-lanes") });
  }

  await page.goto("/#/tournaments/new");
  await page.waitForTimeout(1200);
  const seed = page.getByLabel(/seed Mock Alpha/);
  if (await seed.count()) await seed.check();
  const opp = page.getByLabel(/opponent Mock Bravo/);
  if (await opp.count()) await opp.check();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot("06-wizard") });

  await page.goto("/#/live");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot("07-live") });
  const card = page.getByTestId("lane-card").first();
  if (await card.count()) {
    await card.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: shot("08-live-board") });
    await page.keyboard.press("Escape");
  }

  await page.goto("/#/games");
  await page.waitForTimeout(2000);
  const src = page.getByTestId("archive-source");
  if ((await src.count()) > 1) {
    await src.last().click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: shot("19-games-archive") });
  await page.getByRole("button", { name: "Board appearance" }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot("20-board-appearance") });
  await page.keyboard.press("Escape");

  await page.goto("/#/tournaments");
  await page.waitForTimeout(800);
  await page.getByTestId("tfile-open").click();
  await page.getByTestId("tfile-text").fill(
    [
      "# written by Claude: \"a Blitz gauntlet of Mock Alpha against the Bravo engine\"",
      'kind = "gauntlet"',
      'list = "Blitz"',
      'seed = "mock alpha"',
      'opponents = ["Mock Bravo"]',
      "threads = 1",
      "games_per_opponent = 20",
      "passes = 2",
      'after_import = "queue"',
      'notes = "quick sanity gauntlet before the real 8CPU run"',
    ].join("\n"),
  );
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot("21-tournament-file") });
  await page.keyboard.press("Escape");

  if (live) {
    await page.goto(`/#/tournaments/${encodeURIComponent(live.record.id)}`);
    await page.waitForTimeout(1200);
    await page.getByRole("tab", { name: "Games" }).click();
    await page.waitForTimeout(1000);
    const frcRows = page.getByTestId("games-table").locator("tbody tr");
    if (await frcRows.count()) {
      await frcRows.first().click();
      await page.waitForTimeout(1200);
      await page.keyboard.press("Home");
      for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(800);
      await page.screenshot({ path: shot("22-chess960-game") });
      await page.keyboard.press("Escape");
    }
  }
  await page.goto("/#/tournaments/new");
  await page.waitForTimeout(1000);
  const s2 = page.getByLabel(/seed Mock Alpha/);
  if (await s2.count()) await s2.check();
  const o2 = page.getByLabel(/opponent Mock Bravo/);
  if (await o2.count()) await o2.check();
  await page.getByRole("button", { name: "FRC (960)", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("23-wizard-chess960") });

  await page.goto("/#/engines");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("09-engines") });

  await page.goto("/#/ccrl");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("10-ccrl-lists") });

  await page.goto("/#/bench");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: shot("11-bench") });

  await page.goto(tri ? `/#/export?id=${encodeURIComponent(tri.record.id)}` : "/#/export");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: shot("12-export") });

  await page.goto("/#/settings");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("13-settings") });

  await page.goto("/#/logs");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("14-logs") });

  await page.goto("/#/");
  await page.waitForTimeout(1500);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("15-command-palette") });
  await page.keyboard.press("Escape");

  await page.evaluate(() => localStorage.setItem("torsgui-theme", "light"));
  await page.goto("/#/");
  await page.reload();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: shot("16-dashboard-light") });
  await page.evaluate(() => localStorage.setItem("torsgui-theme", "dark"));
  await page.reload();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#/");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: shot("17-dashboard-1280x800") });
});
