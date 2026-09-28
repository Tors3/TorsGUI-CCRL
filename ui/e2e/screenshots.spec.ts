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
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("04-pgn-viewer") });
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
