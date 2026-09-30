import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath as __f2p } from "node:url";
const __dirname = __f2p(new URL(".", import.meta.url));
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const BIN = (n: string) => join(ROOT, "target", "debug", process.platform === "win32" ? `${n}.exe` : n);
const API = "http://127.0.0.1:7880/api";

async function call<T = any>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${API}/${cmd}`, { method: "POST", body: JSON.stringify(args) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${cmd}: ${j.error}`);
  return j;
}

function findRef(): string | null {
  const cands = [process.env.CCRL_REF, join(ROOT, "..", "CCRL_ScirptsTests"), join(ROOT, "ccrl-ref")].filter(Boolean) as string[];
  return cands.find((c) => existsSync(join(c, "tournaments"))) ?? null;
}

function book(dir: string): string {
  const w = ["e4", "d4", "c4", "Nf3", "g3", "b3", "e3", "d3", "c3", "f4"];
  const b = ["e5", "c5", "e6", "c6", "d5", "Nf6", "g6", "d6", "b6", "f5"];
  let s = "";
  for (const x of w) for (const y of b) s += `[Event "?"]\n\n1. ${x} ${y} *\n\n`;
  const p = join(dir, "demo-book.pgn");
  writeFileSync(p, s);
  return p;
}

export default async function globalSetup() {
  const ws = mkdtempSync(join(tmpdir(), "torsgui-e2e-"));
  const env = { ...process.env, TORSGUI_RUNNER: BIN("torsgui-runner") };
  const server: ChildProcess = spawn(BIN("torsgui-server"), ["--workspace", ws, "--listen", "127.0.0.1:7880", "--static", join(__dirname, "..", "dist")], { env, stdio: "inherit" });
  (globalThis as any).__server = server;
  process.env.TORSGUI_E2E_PID = String(server.pid);
  process.env.TORSGUI_E2E_WS = ws;
  for (let i = 0; i < 50; i++) {
    try {
      await call("app_info");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const settings = await call("settings_get");
  const fastchess = process.env.TORSGUI_E2E_NO_LIVE ? "" : process.env.FASTCHESS ?? ["/home/user/disservin/fastchess/fastchess"].find(existsSync) ?? "";
  mkdirSync(join(ws, "books"), { recursive: true });
  const bk = book(join(ws, "books"));
  await call("settings_save", { settings: { ...settings, tester_name: "Francesco Torsello", site: "Milan", fastchess_path: fastchess, default_book: bk, default_factor: 0.86 } });

  const ref = findRef();
  if (ref) {
    for (const t of ["2026-09-22_Caissa_2.0_4CPU", "2026-09-27_Triumviratus_7.0_8CPU", "2026-09-28_Stockfish_19_8CPU"]) {
      await call("import_legacy", { dir: join(ref, "tournaments", t), results: join(ref, "results", "gauntlets", t) });
    }
    await call("engines_import_report", { report: join(ref, "engines", "REPORT.md"), uci_dir: join(ref, "engines", "uci_options") });
    // exported CCRL files of the reference repository as an external archive source
    const cur = await call("settings_get");
    await call("settings_save", { settings: { ...cur, archive_paths: [join(ref, "results", "gauntlets", "2026-09-22_Caissa_2.0_4CPU")] } });
    const bench = join(ref, "benchmark", "results");
    await call("bench_import", { files: readdirSync(bench).filter((f) => f.endsWith(".json")).map((f) => join(bench, f)) });
  }
  const { readFileSync } = await import("node:fs");
  await call("ccrl_import_text", { list: "Blitz", variant: "all", text: readFileSync(join(__dirname, "sample-ccrl-blitz.txt"), "utf8") });
  // mock engines in the library (for the wizard) and a live demo tournament
  const mock = BIN("mock-uci");
  if (existsSync(mock)) {
    for (const [name, ver] of [["Mock Alpha", "1.0"], ["Mock Bravo", "2.1"]]) {
      await call("engine_add_local", { path: mock, engine: name, version: ver });
    }
  }
  if (fastchess && existsSync(mock)) {
    const part = (name: string, role: string, args: string) => ({ name, cmd: mock, dir: join(mock, ".."), args, options: { Threads: "${THREADS}", Hash: "${HASH}" }, role, engine_id: null, has_syzygy: true, uci_id: null, rating: null, rating_estimated: false });
    const cfg = (name: string, opps: string[], tc: string, frc = false) => ({
      name,
      kind: "gauntlet",
      participants: [part("Demo Seed 1.0", "seed", "--strength 75 --seed 1 --movetime 60"), ...opps.map((o, i) => part(o, "opponent", `--strength 45 --seed ${i + 2} --movetime 60`))],
      games_per_pairing: 10,
      passes: 1,
      play_passes: null,
      nodes: [0],
      rounds_per_pass: [5],
      lanes_per_node: 4,
      concurrency: 1,
      threads: 1,
      hash_mb: 16,
      tc,
      book: frc ? frcBook : bk,
      book_format: frc ? "epd" : "pgn",
      book_start: 1,
      event: `CCRL ${frc ? "FRC" : "Blitz"} gauntlet ${name}`,
      site: "Milan",
      syzygy_path: "",
      adjudication: { ...settings.adjudication },
      extra_args: ["-maxmoves", "120"],
      placement: "node",
      log_level: "info",
      ccrl_list: frc ? "FRC" : "Blitz",
      variant: frc ? "chess960" : "standard",
      max_retries: 2,
      max_slot_attempts: 3,
      fastchess,
      startup_ms: 10000,
    });
    // the running demo is a Chess960 gauntlet (start positions generated by TorsGUI)
    const frcBook = (await call("chess960_book", { spec: { kind: "all", count: 960, seed: 1, include_standard: false } })).path;
    const live = await call("tournament_create", { config: cfg("Demo Seed 1.0 1CPU", ["Mock Opp A 1.0", "Mock Opp B 1.0", "Mock Opp C 1.0", "Mock Opp D 1.0"], "30+0.3", true) });
    await call("tournament_create", { config: cfg("Demo Next 1.0 1CPU", ["Mock Opp E 1.0", "Mock Opp F 1.0"], "30+0.3"), enqueue: true });
    await call("tournament_start", { id: live.id });
    // let a few games finish so every screen has data
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      const d = await call("tournament_get", { id: live.id });
      if (d.summary.progress.done >= 4) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
