import { expect, test } from "@playwright/test";
import { fileURLToPath as __f2p } from "node:url";
const __dirname = __f2p(new URL(".", import.meta.url));

import { existsSync } from "node:fs";
import { resolve } from "node:path";
const hasRef = () => !!(process.env.CCRL_REF || existsSync(resolve(__dirname, "../../../CCRL_ScirptsTests/tournaments")));

test("dashboard loads with health and events", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Health")).toBeVisible();
  await expect(page.getByTestId("status-pill")).toBeVisible();
});

test("imported Triumviratus gauntlet matches the reference numbers", async ({ page }) => {
  test.skip(!hasRef(), "CCRL_ScirptsTests not available");
  await page.goto("/#/tournaments");
  const row = page.getByRole("row", { name: /Triumviratus_7\.0_8CPU/ });
  await expect(row).toContainText("870/870");
  await row.click();
  await expect(page.getByText("+32 =831 −7").first()).toBeVisible();
  await expect(page.getByText("51.4%").first()).toBeVisible();
  const standings = page.getByTestId("standings");
  await expect(standings.getByRole("row", { name: /Stockfish 19/ })).toContainText("15/15");
  await expect(standings.getByRole("row", { name: /RubiChess/ })).toContainText("+4 =26 −0");
  // games tab opens the PGN viewer
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByTestId("games-table").locator("tbody tr").first().click();
  await expect(page.getByTestId("move-list")).toBeVisible();
  await expect(page.getByTestId("eval-bar")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("game archive: tournaments and an external PGN folder, viewer with autoplay", async ({ page }) => {
  await page.goto("/#/games");
  const sources = page.getByTestId("archive-source");
  await expect(sources.first()).toBeVisible();
  // the Caissa export folder of the reference repository was added as an archive path
  const ext = sources.filter({ hasText: "Caissa 2.0 64-bit 4CPU" });
  if (await ext.count()) {
    await ext.first().click();
    await expect(page.getByTestId("games-table").locator("tbody tr")).toHaveCount(380);
  }
  await page.getByTestId("games-table").locator("tbody tr").first().click();
  await expect(page.getByTestId("move-list")).toBeVisible();
  await page.keyboard.press("Home");
  await page.getByTestId("autoplay").click();
  await page.waitForTimeout(2300);
  await expect(page.getByTestId("move-list").locator("button.active")).toHaveCount(1);
  await page.keyboard.press("Escape");
});

test("tournament file: tolerant names, preview, save as draft", async ({ page }) => {
  await page.goto("/#/tournaments");
  await page.getByTestId("tfile-open").click();
  await page.getByTestId("tfile-text").fill('kind = "gauntlet"\nseed = "mock alpha"\nopponents = ["Mock Bravo 2.1"]\ngames_per_opponent = 4\ntc = "10+0.1"\nafter_import = "draft"\n');
  await expect(page.getByTestId("tfile-total")).toHaveText("4");
  await expect(page.getByTestId("tfile-result")).toContainText("Mock Alpha 1.0");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByRole("heading", { name: /Blitz gauntlet Mock Alpha 1\.0 1CPU/ })).toBeVisible();
  // a name that is not in the library is reported with suggestions
  await page.goto("/#/tournaments");
  await page.getByTestId("tfile-open").click();
  await page.getByTestId("tfile-text").fill('seed = "Mock Alpha 1.0"\nopponents = ["Mock Brovo 9"]\n');
  await expect(page.getByTestId("tfile-errors")).toContainText("Mock Brovo 9");
});

test("board appearance is applied and remembered", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByTestId("theme-marble").click();
  await page.getByTestId("pieces-fantasy").click();
  await page.reload();
  await expect(page.locator(".board-box").first()).toHaveClass(/board-theme-marble/);
  await expect(page.locator(".board-box").first()).toHaveClass(/pieces-fantasy/);
  // custom colours
  await page.getByTestId("theme-custom").click();
  await page.getByLabel("Dark squares").fill("#336699");
  await expect(page.locator(".board-box.board-theme-custom").first()).toHaveAttribute("style", /--sq-dark: #336699/);
  await page.getByTestId("theme-minimal").click();
  await page.getByTestId("pieces-cburnett").click();
});

test("wizard computes the total number of games", async ({ page }) => {
  await page.goto("/#/tournaments/new");
  await page.getByLabel(/seed Mock Alpha/).check();
  await page.getByLabel(/opponent Mock Bravo/).check();
  await page.getByTestId("games-per-pairing").fill("30");
  await expect(page.getByTestId("total-games")).toHaveText("30");
  await expect(page.getByTestId("event-name")).toHaveValue(/CCRL Blitz gauntlet Mock Alpha 1\.0 1CPU/);
});

test("CCRL export and forum post", async ({ page }) => {
  test.skip(!hasRef(), "CCRL_ScirptsTests not available");
  const list = await (await page.request.post("/api/tournaments_list", { data: {} })).json();
  const t = list.find((x: any) => x.record.name.includes("Triumviratus"));
  await page.goto(`/#/export?id=${encodeURIComponent(t.record.id)}`);
  await expect(page.getByTestId("forum-post")).toContainText("Result: [b]+32 =831 −7 (51.4%)[/b]");
  await expect(page.getByTestId("forum-post")).toContainText("Stockfish 19             0  30   0   15.0/30");
  await page.getByTestId("export-run").click();
  await expect(page.getByTestId("export-result")).toContainText("870");
  await expect(page.getByTestId("export-result")).toContainText("Triumviratus 7.0 64-bit 8CPU - Sep 27");
});

test("command palette and keyboard navigation", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByPlaceholder("Type a command or search…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Type a command or search…")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("engines");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Engines" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("b");
  await expect(page.getByRole("heading", { name: "Bench & calibration" })).toBeVisible();
});

test("TC calculator reproduces the reference Blitz TC", async ({ page }) => {
  await page.goto("/#/bench");
  await page.getByTestId("tc-factor").fill("0.86");
  await expect(page.getByTestId("tc-result")).toHaveText("103+1");
});

test("every screen renders without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const p of ["/", "/tournaments", "/live", "/games", "/engines", "/ccrl", "/bench", "/export", "/settings", "/logs"]) {
    await page.goto(`/#${p}`);
    await page.waitForTimeout(600);
  }
  expect(errors).toEqual([]);
});
