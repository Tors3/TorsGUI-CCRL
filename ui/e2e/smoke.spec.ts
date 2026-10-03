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

test("Chess960: FRC list, generated start positions, engines supporting it, live 960 game", async ({ page }) => {
  await page.goto("/#/tournaments/new");
  await page.getByLabel(/seed Mock Alpha/).check();
  await page.getByLabel(/opponent Mock Bravo/).check();
  await page.getByRole("button", { name: "FRC (960)", exact: true }).click();
  await expect(page.getByTestId("book")).toHaveValue(/chess960-all-seed1\.epd$/);
  await expect(page.getByTestId("event-name")).toHaveValue(/CCRL FRC gauntlet Mock Alpha 1\.0 1CPU/);
  await expect(page.getByText("does not support Chess960")).toHaveCount(0);
  // a double Chess960 book
  await page.getByTestId("frc-generate").click();
  await page.getByRole("button", { name: "Double 960" }).click();
  await page.getByTestId("frc-create").click();
  await expect(page.getByTestId("book")).toHaveValue(/dfrc-200-seed1\.epd$/);
  // the running demo tournament is Chess960: its games replay from their start position
  const list = await (await page.request.post("/api/tournaments_list", { data: {} })).json();
  const live = list.find((x: any) => x.record.config.variant === "chess960");
  if (live) {
    await page.goto(`/#/tournaments/${encodeURIComponent(live.record.id)}`);
    await page.getByRole("tab", { name: "Games" }).click();
    const rows = page.getByTestId("games-table").locator("tbody tr");
    if (await rows.count()) {
      await rows.first().click();
      await expect(page.getByTestId("move-list")).toBeVisible();
      await expect(page.getByText("cannot replay")).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
  }
});

test("in-app help: sections, search, the ? button of a screen", async ({ page }) => {
  await page.goto("/#/help");
  await expect(page.getByTestId("help-body")).toContainText("CCRL submission checklist");
  await page.getByTestId("help-search").fill("Chess960");
  await expect(page.getByTestId("help-body")).toContainText("UCI_Chess960");
  await expect(page.getByTestId("help-body")).not.toContainText("Bench and time control");
  await page.goto("/#/engines");
  await page.getByTestId("help-link").first().click();
  await expect(page).toHaveURL(/#\/help\?s=engines/);
  await expect(page.locator("#engines")).toBeVisible();
  // the tournament-file guide is reachable too
  await page.goto("/#/help?doc=file");
  await expect(page.getByTestId("help-body")).toContainText("after_import");
});

test("CCRL checklist on the export page", async ({ page }) => {
  const list = await (await page.request.post("/api/tournaments_list", { data: {} })).json();
  const tri = list.find((x: any) => x.record.name.includes("Triumviratus"));
  test.skip(!tri, "reference data not available");
  await page.goto(`/#/export?id=${encodeURIComponent(tri.record.id)}`);
  const c = page.getByTestId("checklist");
  await expect(c).toContainText("All games played");
  await expect(c.locator('[data-status="ok"]').filter({ hasText: "All games played" })).toHaveCount(1);
  await expect(c.locator('[data-status="ok"]').filter({ hasText: "Hash 512 MB per thread" })).toHaveCount(1);
  await expect(c.locator('[data-status="ok"]').filter({ hasText: "Every opening with both colours" })).toHaveCount(1);
  await expect(page.getByTestId("checklist-status")).toBeVisible();
});

test("getting started: live steps and the demo tournament", async ({ page }) => {
  await page.goto("/#/");
  await page.goto("/#/start");
  await expect(page.getByTestId("step-tester")).toHaveAttribute("data-done", "yes");
  await expect(page.getByTestId("setup-progress")).toContainText("/7 done");
  const st = await (await page.request.post("/api/setup_status", { data: {} })).json();
  await expect(page.getByTestId("step-fastchess")).toHaveAttribute("data-done", st.fastchess ? "yes" : "no");
  if (!st.fastchess) {
    // without fastchess (CI browser job) the demo cannot start: the button says why
    await expect(page.getByTestId("demo-standard")).toBeDisabled();
    await expect(page.getByText("install fastchess first")).toBeVisible();
    return;
  }
  await page.getByTestId("demo-standard").click();
  await expect(page.getByTestId("demo-tour")).toBeVisible();
  const list = await (await page.request.post("/api/tournaments_list", { data: {} })).json();
  const demo = list.find((x: any) => x.record.name.startsWith("Demo Blitz gauntlet"));
  expect(demo).toBeTruthy();
  expect(demo.record.expected_games).toBe(16);
  const engines = await (await page.request.post("/api/engines_list", { data: {} })).json();
  expect(engines.filter((e: any) => e.notes.startsWith("TorsGUI demo engine")).length).toBe(3);
});

test("bundled CCRL opening books: install, then pick one in the wizard", async ({ page }) => {
  const b = await (await page.request.post("/api/books_bundled", { data: {} })).json();
  expect(b.books.length).toBe(18);
  await page.goto("/#/settings");
  const table = page.getByTestId("books-table");
  await expect(table.locator("tbody tr")).toHaveCount(18);
  await page.getByTestId("books-install").first().click();
  await expect(table.locator('tr[data-book="AVT2026d.pgn"]')).toHaveAttribute("data-installed", "yes");
  await expect(table.locator('tr[data-book="Hert500.cgb"]')).toHaveAttribute("data-installed", "yes");
  await page.goto("/#/tournaments/new");
  const select = page.getByTestId("book-select");
  await expect(select.locator("option", { hasText: "LowDraw1000.pgn" })).toHaveCount(1);
  await expect(select.locator("option", { hasText: ".cgb" })).toHaveCount(0);
  const low = await select.locator("option", { hasText: "LowDraw1000.pgn" }).getAttribute("value");
  await select.selectOption(low!);
  await expect(page.getByTestId("book")).toHaveValue(/LowDraw1000\.pgn$/);
});

test("a draft is edited in the tournament wizard", async ({ page }) => {
  await page.goto("/#/tournaments/new");
  await page.getByLabel(/seed Mock Alpha/).check();
  await page.getByLabel(/opponent Mock Bravo/).check();
  await page.getByTestId("games-per-pairing").fill("20");
  await expect(page.getByTestId("total-games")).toHaveText("20");
  await page.getByTestId("create-draft").click();
  // wait for the tournament page (the wizard's own URL is /tournaments/new)
  await expect(page.getByTestId("edit-tournament")).toBeVisible();
  const id = decodeURIComponent(page.url().split("/tournaments/")[1]);
  await page.getByTestId("edit-tournament").click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(page.getByTestId("games-per-pairing")).toHaveValue("20");
  await expect(page.getByLabel(/seed Mock Alpha/)).toBeChecked();
  await expect(page.getByLabel(/opponent Mock Bravo/)).toBeChecked();
  await page.getByTestId("games-per-pairing").fill("40");
  await expect(page.getByTestId("total-games")).toHaveText("40");
  await page.getByTestId("create-draft").click(); // "Save changes" in edit mode
  await expect(page).toHaveURL((u) => u.hash === `#/tournaments/${encodeURIComponent(id)}`);
  const d = await (await page.request.post("/api/tournament_get", { data: { id } })).json();
  expect(d.summary.record.config.games_per_pairing).toBe(40);
  expect(d.summary.record.expected_games).toBe(40);
  expect(d.summary.record.state).toBe("draft");
  await page.request.post("/api/tournament_delete", { data: { id, delete_files: true } });
});

test("CCRL lists bundled with TorsGUI and the known engine repositories", async ({ page }) => {
  const lists = await (await page.request.post("/api/ccrl_lists", { data: {} })).json();
  const bundled = lists.filter((l: any) => l.source.startsWith("bundled snapshot"));
  expect(bundled.map((l: any) => l.list).sort()).toEqual(["40/15", "Blitz", "FRC"]);
  await page.goto("/#/ccrl");
  await expect(page.getByText(/bundled \(September 2[68], 2026\)/).first()).toBeVisible();
  await expect(page.getByTestId("ccrl-fetch-all")).toBeVisible();
  const known = await (await page.request.post("/api/known_repos", { data: {} })).json();
  expect(known.length).toBeGreaterThanOrEqual(30);
  await page.goto("/#/engines");
  await page.getByRole("button", { name: /Add from GitHub/ }).first().click();
  await expect(page.getByTestId("known-repos")).toBeVisible();
  await page.getByTestId("known-filter").fill("stock");
  await expect(page.getByTestId("known-Stockfish")).toContainText("official-stockfish/Stockfish");
});

test("live broadcast: settings and the tournament's Lichess / ccrl.live switches", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(page.getByTestId("lichess-token")).toBeVisible();
  await expect(page.getByTestId("ccrl-live-port")).toHaveValue("16001");
  const list = await (await page.request.post("/api/tournaments_list", { data: {} })).json();
  const t = list.find((x: any) => !x.record.imported);
  await page.goto(`/#/tournaments/${encodeURIComponent(t.record.id)}`);
  await page.getByTestId("tab-broadcast").click();
  await expect(page.getByTestId("broadcast-panel")).toBeVisible();
  // Lichess needs a token first
  await page.getByTestId("broadcast-lichess").click();
  await expect(page.getByText(/no Lichess token saved/)).toBeVisible();
  await expect(page.getByTestId("broadcast-lichess")).not.toBeChecked();
  await page.getByTestId("broadcast-ccrl").check();
  await expect(page.getByTestId("broadcast-ccrl")).toBeChecked();
  // the switch answers at once, the saved setting follows
  const get = async () => (await page.request.post("/api/broadcast_get", { data: { id: t.record.id } })).json();
  await expect.poll(async () => (await get()).config).toEqual({ lichess: false, ccrl_live: true });
  expect((await get()).first_port).toBe(16001);
  await page.getByTestId("broadcast-ccrl").uncheck();
  await expect(page.getByTestId("broadcast-ccrl")).not.toBeChecked();
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
  // every player with the name CCRL uses in its list
  await expect(page.getByTestId("export-names")).toContainText("as in the CCRL Blitz list");
  await expect(page.getByTestId("export-names")).toContainText("Triumviratus 7.0 64-bit 8CPU");
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
  for (const p of ["/", "/tournaments", "/live", "/games", "/engines", "/ccrl", "/bench", "/export", "/settings", "/logs", "/help", "/start"]) {
    await page.goto(`/#${p}`);
    await page.waitForTimeout(600);
  }
  expect(errors).toEqual([]);
});

test("engines: CCRL ratings, search and sort; wizard search, Elo range and sorting", async ({ page }) => {
  const r = await (await page.request.post("/api/engines_ccrl", { data: {} })).json();
  const blitz = r.ratings.filter((x: any) => x.list === "Blitz" && x.exact).sort((a: any, b: any) => b.rating - a.rating);
  expect(blitz.length).toBeGreaterThan(3);
  const engines = await (await page.request.post("/api/engines_list", { data: {} })).json();
  const top = blitz[0];
  const name = engines.find((e: any) => e.id === top.engine_id).display_name;
  await page.goto("/#/engines");
  await expect(page.getByTestId(`elo-Blitz-${top.engine_id}`)).toContainText(top.rating.toLocaleString("en-US"));
  const rows = page.getByTestId("engines-table").locator("tbody tr");
  await page.getByTestId("sort-Blitz").click();
  await expect(rows.first()).toContainText(name);
  await page.getByTestId("sort-Blitz").click();
  await expect(rows.first()).not.toContainText(name);
  await page.getByTestId("engines-search").fill(name);
  await expect(rows.filter({ hasText: name }).first()).toBeVisible();
  await page.getByTestId("engines-search").fill("no such engine zzz");
  await expect(page.getByText(/No engine matches/)).toBeVisible();

  await page.goto("/#/tournaments/new");
  await page.getByTestId("wizard-search").fill("mock bravo");
  await expect(page.getByLabel(/opponent Mock Bravo/)).toBeVisible();
  await expect(page.getByLabel(`opponent ${name}`, { exact: true })).toHaveCount(0);
  await page.getByTestId("wizard-search").fill("");
  await page.getByTestId("elo-min").fill(String(Math.floor(top.rating)));
  await expect(page.getByLabel(`opponent ${name}`, { exact: true })).toBeVisible();
  await expect(page.getByLabel(/opponent Mock Bravo/)).toHaveCount(0);
  await page.getByTestId("elo-min").fill("");
  await page.getByTestId("sort-rating").click();
  const elo = async (i: number) => Number((await page.locator('[data-testid^="wizard-elo-"]').nth(i).innerText()).replace(/[^0-9]/g, "").slice(0, 4));
  await expect.poll(() => elo(0)).toBeGreaterThan(3000);
  expect(await elo(0)).toBeGreaterThanOrEqual(await elo(1));
  expect(await elo(1)).toBeGreaterThanOrEqual(await elo(2));
});

test("UCI options: kept in Engines → Edit, per tournament in the wizard and in the Configuration tab", async ({ page }) => {
  // Engines → Edit: a declared option and one added by name; saved options stay
  await page.goto("/#/engines");
  const row = page.getByTestId("engines-table").locator("tbody tr").filter({ hasText: "Mock Bravo" }).first();
  await row.getByLabel("Edit").click();
  await page.getByLabel("option Strength").fill("42");
  await page.getByTestId("uci-extra-add").click();
  await page.getByLabel("extra option name 1").fill("evalfile");
  await page.getByLabel("extra option value 1").fill("nets/x.nnue");
  await expect(page.getByTestId("uci-warnings")).toContainText("the engine has no option 'evalfile'");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("option Strength")).toHaveCount(0);
  await row.getByLabel("Edit").click();
  await expect(page.getByLabel("option Strength")).toHaveValue("42");
  await expect(page.getByLabel("extra option value 1")).toHaveValue("nets/x.nnue");
  await page.getByLabel("remove extra option 1").click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("option Strength")).toHaveCount(0);

  // a new tournament takes the engine's options
  await page.goto("/#/tournaments/new");
  await page.getByLabel(/seed Mock Alpha/).check();
  await page.getByLabel(/opponent Mock Bravo/).check();
  const engines = await (await page.request.post("/api/engines_list", { data: {} })).json();
  const bravo = engines.find((e: any) => e.display_name.startsWith("Mock Bravo"));
  expect(bravo.default_options.Strength).toBe("42");
  expect(bravo.default_options.evalfile).toBeUndefined();
  // changed for this tournament only
  await page.getByTestId(`wizard-options-${bravo.id}`).click();
  await expect(page.getByLabel("option Strength")).toHaveValue("42");
  await page.getByLabel("option Strength").fill("43");
  await page.getByTestId("wizard-options-apply").click();
  await expect(page.getByTestId(`wizard-options-${bravo.id}`)).toContainText("custom options");
  await page.getByTestId("create-draft").click();
  await expect(page.getByTestId("edit-tournament")).toBeVisible();
  const id = decodeURIComponent(page.url().split("/tournaments/")[1]);
  const opts = async () => (await (await page.request.post("/api/tournament_get", { data: { id } })).json()).summary.record.config.participants.find((p: any) => p.engine_id === bravo.id).options;
  expect((await opts()).Strength).toBe("43");
  expect((await opts()).Threads).toBe("${THREADS}");

  // Configuration tab of the tournament
  await page.getByRole("tab", { name: "Configuration" }).click();
  const panel = page.getByTestId("tournament-engine-options");
  await panel.getByLabel("engine whose options to change").selectOption({ label: bravo.display_name });
  await panel.getByLabel("option Strength").fill("44");
  await panel.getByLabel("option MoveTime").fill("9999");
  await expect(panel.getByTestId("uci-warnings")).toContainText("MoveTime=9999 is outside 1..5000");
  await panel.getByLabel("option MoveTime").fill("");
  await page.getByTestId("tournament-options-save").click();
  await expect.poll(async () => (await opts()).Strength).toBe("44");
  expect((await opts()).MoveTime).toBeUndefined();
  expect((await opts()).Hash).toBe("${HASH}");
  await page.request.post("/api/tournament_delete", { data: { id, delete_files: true } });
  // the engine back as it was for the other tests
  await page.request.post("/api/engine_save", { data: { engine: { ...bravo, default_options: { ...bravo.default_options, Strength: undefined } } } });
});
