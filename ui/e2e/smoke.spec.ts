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
  await expect(page.getByTestId("event-name")).toHaveValue(/CCRL FRC gauntlet Mock Alpha 1\.0 1CPU/);
  await expect(page.getByText("does not support Chess960")).toHaveCount(0);
  await page.getByTestId("wizard-step-conditions").click();
  await expect(page.getByTestId("book")).toHaveValue(/chess960-all-seed1\.epd$/);
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
  await page.goto("/#/settings?tab=books");
  const table = page.getByTestId("books-table");
  await expect(table.locator("tbody tr")).toHaveCount(18);
  await page.getByTestId("books-install").first().click();
  await expect(table.locator('tr[data-book="AVT2026d.pgn"]')).toHaveAttribute("data-installed", "yes");
  await expect(table.locator('tr[data-book="Hert500.cgb"]')).toHaveAttribute("data-installed", "yes");
  await page.goto("/#/tournaments/new?tab=conditions");
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
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("games-per-pairing").fill("20");
  await expect(page.getByTestId("total-games")).toHaveText("20");
  await page.getByTestId("create-draft").click();
  // wait for the tournament page (the wizard's own URL is /tournaments/new)
  await expect(page.getByTestId("edit-tournament")).toBeVisible();
  const id = decodeURIComponent(page.url().split("/tournaments/")[1]);
  await page.getByTestId("edit-tournament").click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(page.getByLabel(/seed Mock Alpha/)).toBeChecked();
  await expect(page.getByLabel(/opponent Mock Bravo/)).toBeChecked();
  await page.getByTestId("wizard-step-conditions").click();
  await expect(page.getByTestId("games-per-pairing")).toHaveValue("20");
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
  await page.getByTestId("engines-add").click();
  await page.getByTestId("engines-github").click();
  await expect(page.getByTestId("known-repos")).toBeVisible();
  await page.getByTestId("known-filter").fill("stock");
  await expect(page.getByTestId("known-Stockfish")).toContainText("official-stockfish/Stockfish");
});

test("live broadcast: settings and the tournament's Lichess / ccrl.live switches", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByTestId("settings-tab-broadcast").click();
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
  await page.goto("/#/settings?tab=appearance");
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
  await expect(page.getByTestId("event-name")).toHaveValue(/CCRL Blitz gauntlet Mock Alpha 1\.0 1CPU/);
  await page.getByTestId("wizard-step-conditions").click();
  await page.getByTestId("games-per-pairing").fill("30");
  await expect(page.getByTestId("total-games")).toHaveText("30");
  // the steps: back to the engines, forward to NUMA
  await page.getByTestId("wizard-back").click();
  await expect(page.getByLabel(/seed Mock Alpha/)).toBeChecked();
  await page.getByTestId("wizard-step-numa").click();
  await expect(page.getByTestId("wizard-next")).toBeDisabled();
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
  await page.getByTestId("bench-tab-tc").click();
  await page.getByTestId("tc-factor").fill("0.86");
  await expect(page.getByTestId("tc-result")).toHaveText("103+1");
});

test("every screen renders without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const p of ["/", "/tournaments", "/live", "/games", "/engines", "/ccrl", "/bench", "/export", "/settings", "/settings?tab=hardware", "/settings?tab=maintenance", "/logs", "/help", "/start", "/analysis", "/suites", "/play"]) {
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

test("engines are imported from a Cute Chess engines.json", async ({ page }) => {
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const mock = resolve(__dirname, "../../target/debug", process.platform === "win32" ? "mock-uci.exe" : "mock-uci");
  test.skip(!existsSync(mock), "mock engine not built");
  const dir = mkdtempSync(join(tmpdir(), "cute-"));
  const file = join(dir, "engines.json");
  writeFileSync(file, JSON.stringify([
    { name: "Cute Mock 3.0", command: mock, workingDirectory: dir, protocol: "uci", options: [{ name: "Strength", type: "spin", value: 77, default: 50 }] },
    { name: "Old Crafty 25", command: "crafty", protocol: "xboard" },
  ]));
  await page.goto("/#/engines");
  await page.getByTestId("engines-add").click();
  await page.getByTestId("engines-cutechess").click();
  await page.getByTestId("cute-path").fill(file);
  await page.getByTestId("cute-read").click();
  await expect(page.getByTestId("cute-list")).toContainText("Strength=77");
  await expect(page.getByTestId("cute-list")).toContainText("xboard");
  await expect(page.getByLabel("import Old Crafty 25")).toBeDisabled();
  await page.getByTestId("cute-import").click();
  await expect(page.getByTestId("engines-table")).toContainText("Cute Mock 3.0");
  const engines = await (await page.request.post("/api/engines_list", { data: {} })).json();
  const e = engines.find((x: any) => x.display_name === "Cute Mock 3.0");
  expect(e.default_options.Strength).toBe("77");
  expect(e.verify_status).toBe("ok");
  await page.request.post("/api/engine_delete", { data: { id: e.id } });
});

test("Swiss and knockout tournaments from the wizard", async ({ page }) => {
  await page.goto("/#/tournaments/new");
  await page.getByRole("button", { name: "Swiss", exact: true }).click();
  for (const n of ["Mock Alpha", "Mock Bravo", "Stockfish 19", "Caissa 2.0", "Berserk 14"]) await page.getByLabel(new RegExp(`opponent ${n}`)).first().check();
  await expect(page.getByTestId("event-name")).toHaveValue(/swiss/);
  await page.getByTestId("wizard-step-conditions").click();
  await expect(page.getByTestId("passes")).toHaveValue("5");
  await page.getByTestId("games-per-pairing").fill("2");
  await page.getByTestId("passes").fill("3");
  // 5 engines, 3 rounds, 2 games per match: 2 matches per round
  await expect(page.getByTestId("total-games")).toHaveText("12");
  await page.getByTestId("create-draft").click();
  await expect(page.getByTestId("tab-rounds")).toBeVisible();
  const id = decodeURIComponent(page.url().split("/tournaments/")[1]);
  await expect(page.getByTestId("rounds")).toContainText("Round 1 of 3");
  await expect(page.getByTestId("rounds")).toContainText("bye");
  await expect(page.getByTestId("swiss-table").locator("tbody tr")).toHaveCount(5);
  const d = await (await page.request.post("/api/tournament_get", { data: { id } })).json();
  expect(d.summary.record.config.kind).toBe("swiss");
  expect(d.summary.record.expected_games).toBe(12);
  // seeding by rating: Stockfish 19 first
  expect(d.summary.record.config.participants[0].name).toBe("Stockfish 19");
  expect(d.stages.stages[0].matches[0].a).toBe("Stockfish 19");
  await page.request.post("/api/tournament_delete", { data: { id, delete_files: true } });

  // knockout: the bracket of the first round
  await page.goto("/#/tournaments/new");
  await page.getByRole("button", { name: "Cup (knockout)", exact: true }).first().click();
  for (const n of ["Mock Alpha", "Mock Bravo", "Stockfish 19", "Caissa 2.0", "Berserk 14"]) await page.getByLabel(new RegExp(`opponent ${n}`)).first().check();
  await page.getByTestId("wizard-step-conditions").click();
  await page.getByTestId("games-per-pairing").fill("2");
  await expect(page.getByTestId("total-games")).toHaveText("8");
  // seeding by hand: Stockfish 19 (seed 1 by rating) moved down to seed 2
  await page.getByTestId("wizard-step-seeding").click();
  await expect(page.getByTestId("seed-order").locator("tbody tr").first()).toContainText("Stockfish 19");
  await page.getByRole("button", { name: "seed Stockfish 19 down" }).click();
  await expect(page.getByTestId("seed-order").locator("tbody tr").nth(1)).toContainText("Stockfish 19");
  await expect(page.getByTestId("seed-preview")).toContainText("bye");
  await page.getByTestId("create-draft").click();
  await expect(page.getByTestId("tab-rounds")).toHaveText("Bracket");
  const id2 = decodeURIComponent(page.url().split("/tournaments/")[1]);
  await expect(page.getByTestId("rounds")).toContainText("Round 1 of 3");
  await expect(page.getByTestId("rounds")).toContainText("goes through");
  const d2 = await (await page.request.post("/api/tournament_get", { data: { id: id2 } })).json();
  expect(d2.summary.record.config.participants[1].name).toBe("Stockfish 19");
  // the order is kept when the draft is edited
  await page.goto(`/#/tournaments/${encodeURIComponent(id2)}/edit?tab=seeding`);
  await expect(page.getByTestId("seed-order").locator("tbody tr").nth(1)).toContainText("Stockfish 19");
  await page.request.post("/api/tournament_delete", { data: { id: id2, delete_files: true } });
});

test("sidebar sections, compact sidebar and colour themes", async ({ page }) => {
  await page.goto("/#/");
  // Paper is the default, also over the "dark" stored automatically by older versions
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await page.evaluate(() => localStorage.setItem("torsgui-theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  const side = page.getByTestId("sidebar");
  await expect(side.getByRole("group", { name: "Analysis" }).getByRole("link", { name: "Test suites" })).toBeVisible();
  // a section folds, and stays open while one of its pages is shown
  await page.getByTestId("nav-group-engines").click();
  await expect(side.getByRole("link", { name: "CCRL Lists" })).toHaveCount(0);
  await page.goto("/#/bench");
  await expect(side.getByRole("link", { name: "CCRL Lists" })).toBeVisible();
  await page.goto("/#/");
  await page.getByTestId("nav-group-engines").click();
  await expect(side.getByRole("link", { name: "CCRL Lists" })).toBeVisible();
  // themes: from the sidebar and from Settings → Appearance, remembered
  await page.getByTestId("theme-select").selectOption("graphite");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await page.goto("/#/settings?tab=appearance");
  await page.getByTestId("app-theme-paper").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await expect(page.getByTestId("app-theme-paper")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("app-theme-dark").click();
  // icons only
  await page.getByTestId("sidebar-toggle").click();
  await expect(side.getByRole("link", { name: "Game analysis" })).toBeVisible();
  await expect(side.getByText("Game analysis")).toHaveCount(0);
  await page.getByTestId("sidebar-toggle").click();
  await expect(side.getByText("Game analysis")).toBeVisible();
});

test("test suites: mate finding with a library engine", async ({ page }) => {
  await page.goto("/#/suites");
  await expect(page.getByTestId("suite-mates")).toContainText("19 positions");
  await page.getByTestId("suite-engines").getByLabel(/Mock Alpha/).check();
  await page.getByTestId("suite-time").selectOption("100");
  await expect(page.getByTestId("suite-preview")).toContainText("19 positions");
  await page.getByTestId("suite-start").click();
  await expect(page.getByTestId("suite-results").locator("tbody tr")).toHaveCount(19);
  await expect(page.getByTestId("suite-solved")).toContainText("/19", { timeout: 60_000 });
  await expect(page.getByTestId("suite-start")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("suite-results").locator("tbody td", { hasText: "…" })).toHaveCount(0);
  // pasted positions: a bad line is reported, the good one counted
  await page.getByRole("button", { name: "Paste" }).click();
  await page.getByTestId("suite-text").fill('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - bm Rd8#; id "x";\nnot a position');
  await expect(page.getByTestId("suite-preview")).toContainText("1 positions");
  await expect(page.getByTestId("suite-preview")).toContainText("1 lines skipped");
  const hist = await (await page.request.post("/api/suite_history", { data: {} })).json();
  for (const h of hist) await page.request.post("/api/suite_delete", { data: { id: h.id } });
});

test("game analysis: pasted game, review and live engine", async ({ page }) => {
  await page.goto("/#/analysis");
  await page.getByTestId("analysis-text").fill("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0");
  await page.getByTestId("analysis-load").click();
  await expect(page.getByTestId("analysis-moves")).toContainText("Qxf7#");
  await page.getByTestId("analysis-engine").selectOption({ label: "Mock Alpha 1.0" });
  await page.getByRole("combobox", { name: "Time per move" }).selectOption("100");
  await page.getByTestId("review-start").click();
  await expect(page.getByTestId("review-summary")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("review-start")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("analysis-moves").locator("button .ev").last()).toHaveText(/M1/);
  await page.getByTestId("analysis-live").check();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("analysis-lines")).toContainText(/[a-h1-8]/);
  await expect(page.getByTestId("analysis-lines").locator(".mono").first()).not.toBeEmpty();
  await page.getByTestId("analysis-live").uncheck();
  // a game of the archive opens here from the viewer
  const sources = await (await page.request.post("/api/archive_sources", { data: {} })).json();
  const src = sources.find((x: any) => x.games > 0);
  await page.goto("/#/games");
  await page.getByTestId("archive-source").filter({ hasText: src.label }).first().click();
  await page.getByTestId("games-table").locator("tbody tr").first().click();
  await page.getByTestId("viewer-analyse").click();
  await expect(page).toHaveURL(/#\/analysis\?source=/);
  await expect(page.getByTestId("analysis-moves").locator("button").first()).toBeVisible();
});

test("CCRL lists: the source of each list, and a warning for two identical lists", async ({ page }) => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  await page.goto("/#/ccrl");
  await expect(page.getByTestId("ccrl-source")).toContainText("from ");
  // an old wrong download: 40/15 "all" with the rows of the Blitz "all" list
  const text = readFileSync(join(__dirname, "sample-ccrl-blitz.txt"), "utf8");
  await page.request.post("/api/ccrl_import_text", { data: { list: "40/15", variant: "all", text } });
  await page.reload();
  await expect(page.getByText(/exactly the same rows \(.*Blitz all.*40\/15 all|exactly the same rows \(.*40\/15 all.*Blitz all/)).toBeVisible();
  const lists = await (await page.request.post("/api/ccrl_lists", { data: {} })).json();
  const bad = lists.find((l: any) => l.list === "40/15" && l.variant === "all");
  await page.request.post("/api/ccrl_delete_list", { data: { id: bad.id } });
  await page.reload();
  await expect(page.getByText(/exactly the same rows/)).toHaveCount(0);
});

/** Clicks a square of the board (White at the bottom). */
async function clickSquare(page: import("@playwright/test").Page, sq: string, flipped = false) {
  const box = (await page.getByTestId("board").first().boundingBox())!;
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  const x = flipped ? 7 - f : f;
  const y = flipped ? r : 7 - r;
  await page.mouse.click(box.x + ((x + 0.5) * box.width) / 8, box.y + ((y + 0.5) * box.height) / 8);
}

test("play against an engine: moves on the board, take back, resign, analyse", async ({ page }) => {
  await page.goto("/#/play");
  await page.getByTestId("play-engine").selectOption({ label: "Mock Alpha 1.0" });
  await page.getByTestId("play-tc").selectOption("move1");
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("play-moves")).toContainText("Your move");
  await clickSquare(page, "e2");
  await clickSquare(page, "e4");
  await expect(page.getByTestId("play-moves")).toContainText("e4");
  // the engine answers
  await expect(page.getByTestId("play-moves").locator("button")).toHaveCount(2, { timeout: 20_000 });
  await page.getByTestId("play-undo").click();
  await expect(page.getByTestId("play-moves")).toContainText("Your move");
  await clickSquare(page, "d2");
  await clickSquare(page, "d4");
  await expect(page.getByTestId("play-moves").locator("button")).toHaveCount(2, { timeout: 20_000 });
  await page.getByTestId("play-resign").click();
  await expect(page.getByTestId("play-result")).toContainText("0-1");
  await expect(page.getByTestId("play-result")).toContainText("White resigns");
  await page.getByTestId("play-analyse").click();
  await expect(page).toHaveURL(/#\/analysis\?from=play/);
  await expect(page.getByTestId("analysis-moves")).toContainText("d4");
  // a promotion asks for the piece
  await page.goto("/#/play");
  await page.getByTestId("play-engine").selectOption({ label: "Mock Alpha 1.0" });
  await page.getByTestId("play-fen").fill("8/4P1k1/8/8/8/8/8/4K3 w - - 0 1");
  await page.getByTestId("play-start").click();
  // the new game is on the board before the move
  await expect(page.getByTestId("play-moves")).toContainText("Your move");
  await clickSquare(page, "e7");
  await clickSquare(page, "e8");
  await page.getByTestId("play-promotion").getByRole("button", { name: "promote to n" }).click();
  await expect(page.getByTestId("play-moves")).toContainText("e8=N");
  // king and knight against king: drawn at once
  await expect(page.getByTestId("play-result")).toContainText("insufficient material");
});

test("tournament insights: Elo graph and openings", async ({ page }) => {
  const list = await (await page.request.post("/api/tournaments_list", { data: {} })).json();
  const t = list.find((x: any) => x.record.done_games >= 4) ?? list[0];
  await page.goto(`/#/tournaments/${encodeURIComponent(t.record.id)}`);
  await page.getByTestId("tab-elo").click();
  await expect(page.getByTestId("elo-player")).toBeVisible();
  if (t.record.done_games >= 4) await expect(page.getByTestId("elo-graph")).toBeVisible();
  await page.getByTestId("tab-openings").click();
  if (t.record.done_games >= 1) await expect(page.getByTestId("openings-table").locator("tbody tr").first()).toBeVisible();
  // where the seed lands in its CCRL list
  await page.getByTestId("tab-placement").click();
  await expect(page.getByTestId("placement-chart")).toBeVisible();
  const pl = await (await page.request.post("/api/tournament_placement", { data: { id: t.record.id } })).json();
  expect(pl.neighbours.length).toBeGreaterThan(5);
  if (pl.rating != null) {
    expect(pl.would_rank).toBeGreaterThan(0);
    await expect(page.getByTestId("placement-chart").locator("[data-kind=seed]")).toHaveCount(1);
  }
  const o = await (await page.request.post("/api/tournament_openings", { data: { id: t.record.id } })).json();
  expect(o.games).toBe(o.openings.reduce((n: number, x: any) => n + x.games, 0));
});

test("game analysis is saved as PGN with evaluations", async ({ page }) => {
  await page.goto("/#/analysis");
  await page.getByTestId("analysis-text").fill("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0");
  await page.getByTestId("analysis-load").click();
  await page.getByTestId("analysis-engine").selectOption({ label: "Mock Alpha 1.0" });
  await page.getByRole("combobox", { name: "Time per move" }).selectOption("100");
  await page.getByTestId("review-start").click();
  await expect(page.getByTestId("pgn-save")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("review-start")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("pgn-save").click();
  await expect(page.getByText(/Saved: .*analysis/)).toBeVisible();
  const sources = await (await page.request.post("/api/archive_sources", { data: {} })).json();
  const saved = sources.find((s: any) => s.kind === "file" && /analysis/.test(s.path));
  expect(saved).toBeTruthy();
  const games = await (await page.request.post("/api/archive_games", { data: { source: saved.id } })).json();
  expect(games.length).toBe(1);
});

test("settings: notifications, update check, more test suites", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(page.getByTestId("desktop-notifications")).toBeChecked();
  await expect(page.getByTestId("check-updates")).toBeChecked();
  const suites = await (await page.request.post("/api/suites_builtin", { data: {} })).json();
  expect(suites.find((s: any) => s.id === "wac300").positions).toBe(300);
  expect(suites.length).toBeGreaterThanOrEqual(9);
});

test("CCRL list row: download the engine from GitHub", async ({ page }) => {
  await page.goto("/#/ccrl");
  await page.getByTestId("ccrl-table").getByRole("row", { name: /Stockfish 19 64-bit/ }).first().click();
  await expect(page).toHaveURL(/#\/engines/);
  await expect(page.getByTestId("github-target")).toContainText("official-stockfish/Stockfish");
  await expect(page.getByTestId("github-target")).toContainText("version 19");
  await expect(page.getByTestId("github-url")).toHaveValue("official-stockfish/Stockfish");
  // an engine whose repository is not known yet
  await page.goto("/#/engines?github=" + encodeURIComponent("Unknownfish 1.0 64-bit"));
  await expect(page.getByTestId("github-target")).toContainText("no repository known for Unknownfish");
  await expect(page.getByTestId("known-filter")).toHaveValue("Unknownfish");
  // a repository given by hand is remembered
  await page.request.post("/api/engine_link_set", { data: { family: "Unknownfish", repo: "https://github.com/someone/unknownfish" } });
  await page.goto("/#/");
  await page.goto("/#/engines?github=" + encodeURIComponent("Unknownfish 1.1 64-bit"));
  await expect(page.getByTestId("github-target")).toContainText("someone/unknownfish");
  await expect(page.getByTestId("github-target")).toContainText("added by hand");
  // an engine that is not on GitHub: its site
  await page.goto("/#/");
  await page.goto("/#/engines?github=" + encodeURIComponent("Dragon by Komodo 3.2 64-bit 8CPU"));
  await expect(page.getByTestId("github-homepage")).toHaveAttribute("href", "https://komodochess.com/");
});

test("an 8CPU seed against 1CPU opponents: preset, names, lanes and export", async ({ page }) => {
  await page.goto("/#/tournaments/new");
  await page.getByLabel(/seed Mock Alpha/).check();
  await page.getByLabel(/opponent Mock Bravo/).check();
  await page.getByTestId("wizard-step-conditions").click();
  // the CPU category of the tournament, then the custom preset
  await page.getByTestId("wizard-cpu-4").click();
  await expect(page.getByTestId("event-name")).toHaveCount(0);
  await page.getByTestId("wizard-preset-8v1").click();
  await expect(page.getByTestId("wizard-custom-threads")).toBeChecked();
  await expect(page.getByTestId("wizard-cpu-label")).toHaveText("8CPU vs 1CPU");
  // the seed's own threads are shown in the engine table (with the event name), and can be changed there
  await page.getByTestId("wizard-back").click();
  await expect(page.getByTestId("event-name")).toHaveValue(/8CPU vs 1CPU$/);
  const alpha = await page.getByLabel(/seed Mock Alpha/).evaluate((el) => (el.closest("tr")!.querySelector("[data-testid^=wizard-threads-]") as HTMLInputElement).dataset.testid!);
  await expect(page.getByTestId(alpha)).toHaveValue("8");
  await page.getByTestId(alpha).fill("2");
  await expect(page.getByTestId("event-name")).toHaveValue(/2CPU vs 1CPU$/);
  await page.getByTestId("wizard-step-conditions").click();
  await expect(page.getByTestId("wizard-cpu-label")).toHaveText("2CPU vs 1CPU");
  await page.getByTestId("games-per-pairing").fill("2");
  await page.getByTestId("create-draft").click();
  await expect(page.getByTestId("edit-tournament")).toBeVisible();
  const id = decodeURIComponent(page.url().split("/tournaments/")[1]);
  const d = await (await page.request.post("/api/tournament_get", { data: { id } })).json();
  const c = d.summary.record.config;
  expect(c.threads).toBe(1);
  expect(c.participants.find((p: any) => p.role === "seed").threads).toBe(2);
  expect(c.participants.find((p: any) => p.role === "seed").hash_mb).toBe(2 * 512);
  expect(c.participants.find((p: any) => p.role === "opponent").threads ?? null).toBeNull();
  // the busy threads count the heaviest engine of a lane; the export writes 2CPU / no suffix (2 threads fit even a 2-core CI machine)
  const pv = await (await page.request.post("/api/wizard_preview", { data: { config: c } })).json();
  expect(pv.busy_threads).toBe(c.lanes_per_node * c.nodes.length * 2);
  const ex = await (await page.request.post("/api/export_defaults", { data: { id } })).json();
  expect(ex.threads_of).toEqual({ "Mock Alpha 1.0": 2 });
  await expect(page.getByText("2CPU vs 1CPU").first()).toBeVisible();
  // the tournament file keeps the engines' own threads
  const toml = await (await page.request.post("/api/tfile_export", { data: { id } })).json();
  expect(String(toml)).toContain('"Mock Alpha 1.0" = 2');
  await page.request.post("/api/tournament_delete", { data: { id, delete_files: true } });
});

test("Gaviota and Nalimov paths in the settings, passed to the engines that have the option", async ({ page }) => {
  const before = await (await page.request.post("/api/settings_get", { data: {} })).json();
  await page.goto("/#/settings?tab=paths");
  await page.getByTestId("settings-gaviota_path").fill("/tb/gaviota");
  await page.getByTestId("settings-nalimov_path").fill("/tb/nalimov");
  await page.getByRole("button", { name: /^Save/ }).first().click();
  await expect.poll(async () => (await (await page.request.post("/api/settings_get", { data: {} })).json()).gaviota_path).toBe("/tb/gaviota");
  // in a browser there is no file picker: the fields stay plain
  await expect(page.getByTestId("settings-gaviota_path-browse")).toHaveCount(0);
  // a tournament file: the mock engines declare no Gaviota / Nalimov option, so nothing is added
  const r = await (await page.request.post("/api/tfile_parse", { data: { text: 'seed = "Mock Alpha 1.0"\nopponents = ["Mock Bravo 2.1"]\n' } })).json();
  const opts = r.import.config.participants[0].options;
  expect(Object.keys(opts).some((k) => /gaviota|nalimov/i.test(k))).toBe(false);
  await page.request.post("/api/settings_save", { data: { settings: before } });
});
