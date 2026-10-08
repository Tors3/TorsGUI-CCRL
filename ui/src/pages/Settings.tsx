import { CheckCircle2, Download, GitBranch, HardDrive, RotateCcw, Save, Server, XCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Housekeeping } from "../bindings/Housekeeping";
import type { Settings } from "../bindings/Settings";
import type { Topology } from "../bindings/Topology";
import { BoardAppearance } from "../components/BoardSettings";
import { OpeningBooksPanel } from "../components/OpeningBooks";
import { BroadcastSettings } from "../components/Broadcast";
import { BOOK_FILTERS, PathInput } from "../components/PathInput";
import { ErrorBox, Field, PageHeader, PageTabs, Panel, Spinner, useTabParam } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { bytes } from "../lib/format";
import type { AppInfo } from "../lib/types";
import { THEMES, useTheme } from "../lib/theme";

const SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "paths", label: "Paths & fastchess" },
  { id: "books", label: "Opening books" },
  { id: "broadcast", label: "Live broadcast" },
  { id: "hardware", label: "CPU topology" },
  { id: "maintenance", label: "Maintenance" },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

function TopologyView({ t }: { t: Topology }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px]">
        <b>{t.cpu_model}</b> · {t.sockets} socket(s) · {t.physical_cores} cores / {t.logical_cpus} threads · {t.groups} processor group(s) · AVX2 {t.has_avx2 ? "yes" : "no"} · AVX-512 {t.has_avx512 ? "yes (never for CCRL)" : "no"}
        <span className="muted"> · source: {t.source}</span>
      </div>
      <div className="flex gap-3 flex-wrap">
        {t.nodes.map((n) => {
          const cpus = t.cpus.filter((c) => c.node === n.id);
          const cores = Array.from(new Set(cpus.map((c) => c.core)));
          return (
            <div key={n.id} className="panel p-2" style={{ background: "var(--bg-2)" }} data-testid="numa-node">
              <div className="text-[12px] mb-1.5 flex justify-between gap-4">
                <b>NUMA node {n.id}</b>
                <span className="muted">
                  group {n.group} · {n.physical_cores}c/{n.logical_cpus}t{n.memory_mb ? ` · ${(n.memory_mb / 1024).toFixed(0)} GB` : ""}
                </span>
              </div>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(10, cores.length)}, 26px)` }}>
                {cores.map((c) => {
                  const threads = cpus.filter((x) => x.core === c).sort((a, b) => a.smt - b.smt);
                  return (
                    <div key={c} className="rounded flex flex-col overflow-hidden" style={{ border: "1px solid var(--border-strong)" }} title={`core ${c}: ${threads.map((x) => `cpu ${x.id} (bit ${x.number})`).join(", ")}`}>
                      {threads.map((x) => (
                        <div key={x.id} className="h-[11px] text-[8px] leading-[11px] text-center tnum" style={{ background: x.smt === 0 ? "var(--accent-bg)" : "transparent", color: x.smt === 0 ? "var(--accent-2)" : "var(--muted)" }}>
                          {x.number}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="muted text-[11.5px]">Highlighted: the first hardware thread of each physical core (the "one logical CPU per physical core" set used for games). Caches: {t.caches.map((c) => `L${c.level} ${c.kind} ${c.size_kb} KB`).join(" · ") || "—"}</div>
    </div>
  );
}

export function SettingsPage() {
  const { data, refresh } = usePoll<Settings>("settings_get", {}, 0);
  const { data: info, refresh: refreshInfo } = usePoll<AppInfo>("app_info", {}, 0);
  const { data: topo } = usePoll<Topology>("topology", {}, 0);
  const { data: hk, refresh: refreshHk } = usePoll<Housekeeping>("housekeeping", {}, 0);
  const [s, setS] = useState<Settings>();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  const [gitMsg, setGitMsg] = useState("");
  const [tab, setTab] = useTabParam(SETTINGS_TABS.map((t) => t.id), "general");
  useEffect(() => {
    if (data) setS(data);
  }, [data]);
  if (!s) return <Spinner />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const save = async () => {
    try {
      await call("settings_save", { settings: s });
      toast.success("Settings saved");
      refresh();
      refreshInfo();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const act = async (name: string, cmd: string, args: Record<string, unknown> = {}, msg?: (r: any) => string) => {
    setBusy(name);
    setErr(undefined);
    try {
      const r = await call(cmd, args);
      toast.success(msg ? msg(r) : "Done");
      refreshInfo();
      refreshHk();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const txt = (k: keyof Settings, label: string, hint?: string, mono = true) => (
    <Field label={label} hint={hint}>
      <input className={`input ${mono ? "mono" : ""}`} value={String(s[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} />
    </Field>
  );
  const path = (k: keyof Settings, label: string, kind: "file" | "folder", hint?: string) => (
    <Field label={label} hint={hint}>
      <PathInput kind={kind} value={String(s[k] ?? "")} onChange={(v) => set(k, v as never)} filters={k === "default_book" ? BOOK_FILTERS : undefined} testid={`settings-${k}`} />
    </Field>
  );
  const panes: Record<SettingsTab, ReactNode> = {
    general: (
      <div className="grid gap-3 cols-fit">
        <Panel title="Tester">
          <div className="grid grid-cols-2 gap-3">
            {txt("tester_name", "Tester name", "used in the export file name", false)}
            {txt("site", "Site", "your location (PGN Site tag)", false)}
            <Field label="Hash per thread (MB)" hint="CCRL rule: 512">
              <input className="input tnum" type="number" value={s.hash_per_thread_mb} onChange={(e) => set("hash_per_thread_mb", +e.target.value)} />
            </Field>
            <Field label="Default machine factor">
              <input className="input tnum" type="number" step={0.001} value={s.default_factor} onChange={(e) => set("default_factor", +e.target.value)} />
            </Field>
            <Field label="Default 8CPU − 1CPU gap" hint="when neither the engine nor the list give one">
              <input className="input tnum" type="number" value={s.default_cpu_gap} onChange={(e) => set("default_cpu_gap", +e.target.value)} />
            </Field>
          </div>
        </Panel>
        <Panel title="Default adjudication">
          <div className="grid grid-cols-3 gap-2 text-[12.5px]">
            <label className="col-span-3 flex items-center gap-2">
              <input type="checkbox" checked={s.adjudication.draw_enabled} onChange={(e) => set("adjudication", { ...s.adjudication, draw_enabled: e.target.checked })} /> Draw: from move / moves / |score| cp
            </label>
            {(["draw_movenumber", "draw_movecount", "draw_score"] as const).map((k) => (
              <input key={k} className="input tnum" type="number" value={s.adjudication[k]} onChange={(e) => set("adjudication", { ...s.adjudication, [k]: +e.target.value })} aria-label={k} />
            ))}
            <label className="col-span-3 flex items-center gap-2">
              <input type="checkbox" checked={s.adjudication.resign_enabled} onChange={(e) => set("adjudication", { ...s.adjudication, resign_enabled: e.target.checked })} /> Resign: moves / score cp / two-sided
            </label>
            {(["resign_movecount", "resign_score"] as const).map((k) => (
              <input key={k} className="input tnum" type="number" value={s.adjudication[k]} onChange={(e) => set("adjudication", { ...s.adjudication, [k]: +e.target.value })} aria-label={k} />
            ))}
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={s.adjudication.resign_twosided} onChange={(e) => set("adjudication", { ...s.adjudication, resign_twosided: e.target.checked })} /> two-sided
            </label>
          </div>
        </Panel>
        <Panel title="Notifications and updates">
          <div className="flex flex-col gap-2 text-[12.5px]">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.desktop_notifications} onChange={(e) => set("desktop_notifications", e.target.checked)} data-testid="desktop-notifications" /> Desktop notifications
            </label>
            <div className="muted text-[11.5px] -mt-1 ml-6">Tournament finished or ended with games missing, next tournament of the queue started, engine crashes (at most one a minute), bench, test suite and game analysis finished. Shown also while TorsGUI is in the tray.</div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.check_updates} onChange={(e) => set("check_updates", e.target.checked)} data-testid="check-updates" /> Tell me when a new TorsGUI version is out
            </label>
            <div className="muted text-[11.5px] -mt-1 ml-6">At start, TorsGUI asks GitHub for the latest release (nothing is sent about you or your machine). <b>Update now</b> downloads it (size and SHA-256 checked) and installs it like this copy was installed; running tournaments keep running.</div>
            <div>
              <button className="btn btn-sm" onClick={() => window.dispatchEvent(new Event("torsgui-check-update"))} data-testid="check-update-now">
                Check for updates now
              </button>
            </div>
            {info?.os === "windows" && (
              <div className="flex flex-col gap-1">
                <div>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      call<{ path: string }>("desktop_shortcut_create")
                        .then((r) => toast.success(`Shortcut created: ${r.path}`))
                        .catch((e) => toast.error(e.message))
                    }
                    data-testid="desktop-shortcut"
                  >
                    Create desktop shortcut
                  </button>
                </div>
                <div className="muted text-[11.5px]">A "TorsGUI" shortcut on the desktop that opens this copy. At every start TorsGUI also points the TorsGUI shortcuts of the desktop to itself when they open an older or missing copy (an earlier portable folder).</div>
              </div>
            )}
          </div>
        </Panel>
        <Panel title="Engine builds">
          <div className="flex flex-col gap-2.5 text-[12.5px]">
            <p className="muted">
              CCRL tests <b>AVX2 or AVX-512</b> builds. Downloads take the AVX-512 build (VNNI first) when this CPU runs it, else the AVX2 one; an AVX-512 build is never taken on a CPU without AVX-512 (it would crash). In a tournament, engines that are neither AVX2 nor AVX-512 are pointed out.
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.avx2_only} onChange={(e) => set("avx2_only", e.target.checked)} data-testid="avx2-only" /> AVX2 only (never the AVX-512 build)
            </label>
            <div className="muted text-[11.5px]">
              This CPU: AVX-512 {topo ? (topo.has_avx512 ? "yes" : "no") : "…"}. Default for new downloads; the <i>Add from GitHub</i> dialog can switch it per engine.
            </div>
          </div>
        </Panel>
      </div>
    ),
    appearance: (
      <div className="flex flex-col gap-3">
        <Panel title="Colour theme" actions={<span className="muted text-[11.5px]">saved on this computer, applied immediately · shortcut t</span>}>
          <ThemePicker />
        </Panel>
        <Panel title="Board appearance" actions={<span className="muted text-[11.5px]">saved on this computer, applied immediately</span>}>
          <BoardAppearance />
        </Panel>
      </div>
    ),
    paths: (
      <div className="grid gap-3 cols-fit">
        <Panel title="Paths">
          <div className="grid grid-cols-1 gap-2.5">
            {path("engines_dir", "Engines folder", "folder", "downloads go to <folder>/<Repo>_<tag>")}
            {path("books_dir", "Books folder", "folder")}
            {path("default_book", "Default opening book", "file")}
            {path("syzygy_path", "Syzygy path passed to engines", "folder", "default of new tournaments: TorsGUI passes it to every engine with a SyzygyPath option (nothing to set per engine); fastchess adjudicates with it too")}
            {path("gaviota_path", "Gaviota path passed to engines", "folder", "engines with a Gaviota path option (GaviotaTbPath…)")}
            {path("nalimov_path", "Nalimov path passed to engines", "folder", "engines with a Nalimov path option (NalimovPath…)")}
            {path("output_dir", "Export output folder", "folder")}
          </div>
        </Panel>
        <Panel title="fastchess &amp; runners">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-[12.5px]">
              {info?.fastchess_found ? <CheckCircle2 size={15} className="w" /> : <XCircle size={15} className="l" />}
              <span className="mono break-all">{info?.fastchess_version ?? "fastchess not found"}</span>
            </div>
            <div className="mono muted text-[11.5px] break-all">{info?.fastchess}</div>
            <div className="grid grid-cols-2 gap-2">
              {txt("fastchess_version", "Pinned version")}
              <div className="flex items-end">
                <button className="btn w-full justify-center" onClick={() => act("fc", "fastchess_install", {}, (r) => `fastchess installed (${r.sha256.slice(0, 12)}…)`)} disabled={!!busy}>
                  {busy === "fc" ? <Spinner /> : <Download size={13} />} Download
                </button>
              </div>
            </div>
            {txt("fastchess_path", "Custom fastchess binary", "empty = the managed download")}
            {txt("github_token", "GitHub token (optional)", "raises the API rate limit")}
            <div className="flex items-center gap-2 text-[12.5px]">
              {info?.runner_found ? <CheckCircle2 size={15} className="w" /> : <XCircle size={15} className="l" />} runner: <span className="mono muted break-all">{info?.runner}</span>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.use_task_scheduler} onChange={(e) => set("use_task_scheduler", e.target.checked)} /> Launch runners through the Windows Task Scheduler
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.auto_resume} onChange={(e) => set("auto_resume", e.target.checked)} /> Resume interrupted tournaments when TorsGUI starts
            </label>
            <div className="flex gap-2">
              <button className="btn btn-sm" onClick={() => act("resume", "resume_interrupted", {}, (r) => `${r.length} resumed`)}>
                <RotateCcw size={12} /> Resume interrupted now
              </button>
              <button className="btn btn-sm" onClick={() => act("logon", "register_logon_resume", {}, (r) => String(r))}>
                <Server size={12} /> Resume at logon / reboot
              </button>
            </div>
          </div>
        </Panel>
      </div>
    ),
    books: (
      <Panel title="Opening books">
        <OpeningBooksPanel settings={s} onSettings={refresh} />
      </Panel>
    ),
    broadcast: (
      <Panel title="Live broadcast" actions={<span className="muted text-[11.5px]">Lichess and ccrl.live · choose per tournament (tournament → Live broadcast)</span>}>
        <BroadcastSettings s={s} set={set} />
      </Panel>
    ),
    hardware: <Panel title="CPU topology">{topo ? <TopologyView t={topo} /> : <Spinner />}</Panel>,
    maintenance: (
      <div className="grid gap-3 cols-fit">
        <Panel title="Housekeeping" actions={<HardDrive size={14} className="muted" />}>
          {hk ? (
            <div className="flex flex-col gap-2 text-[12px]">
              <div className="max-h-[120px] overflow-auto">
                {hk.disk.slice(0, 8).map((d) => (
                  <div key={d.path} className="flex justify-between">
                    <span className="mono truncate">{d.path}</span>
                    <span className="tnum">{bytes(d.bytes)}</span>
                  </div>
                ))}
              </div>
              <div>
                <b>Logs:</b> {hk.log_files} files, {bytes(hk.log_bytes)}
              </div>
              <div>
                <b>Unused engines:</b> {hk.unused_engines.join(", ") || "none"}
              </div>
              <div>
                <b>Superseded:</b> {hk.superseded_engines.map(([a, b]) => `${a} → ${b}`).join(", ") || "none"}
              </div>
              <div className="flex gap-2 items-end">
                <Field label="Keep game logs (days)">
                  <input className="input tnum" type="number" value={s.log_retention_days} onChange={(e) => set("log_retention_days", +e.target.value)} />
                </Field>
                <button className="btn" onClick={() => act("rot", "rotate_logs", { days: s.log_retention_days }, (r) => `${r.files} log files removed (${bytes(r.bytes)})`)}>
                  Rotate logs
                </button>
              </div>
            </div>
          ) : (
            <Spinner />
          )}
        </Panel>
        <Panel title="Git sync (optional)" actions={<GitBranch size={14} className="muted" />}>
          <div className="flex flex-col gap-2">
            {txt("git_sync_dir", "Repository folder", "results and configurations are copied there (like sync_repo.py)")}
            <Field label="Commit message (optional)">
              <input className="input" value={gitMsg} onChange={(e) => setGitMsg(e.target.value)} placeholder="Results 2026-09-28" />
            </Field>
            <button className="btn" onClick={() => act("git", "git_sync", { dest: s.git_sync_dir, message: gitMsg || null }, (r) => `${r.length} files synced`)} disabled={!s.git_sync_dir}>
              Sync now
            </button>
          </div>
        </Panel>
      </div>
    ),
  };
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader
        help="new-machine"
        title="Settings"
        sub={info ? `TorsGUI ${info.version}${info.install ? ` (${info.install})` : ""}${info.exe ? ` · running from ${info.exe}` : ""} · workspace ${info.workspace} · ${info.os}` : ""}
        actions={
          <button className="btn btn-primary" onClick={save}>
            <Save size={14} /> Save settings
          </button>
        }
      />
      <ErrorBox error={err} />
      <PageTabs tabs={[...SETTINGS_TABS]} value={tab} onChange={setTab} testid="settings-tab" />
      {panes[tab]}
    </div>
  );
}

/** The app's colour themes, with a preview of each palette. */
function ThemePicker() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }} data-testid="theme-picker">
      {THEMES.map((t) => {
        const pal = t.id === "system" ? ["dark", "light"] : [t.id];
        return (
          <button key={t.id} className="theme-swatch" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)} data-testid={`app-theme-${t.id}`}>
            <div className="theme-preview">
              {pal.map((p) => (
                <ThemeColors key={p} id={p} />
              ))}
            </div>
            <div className="text-[12.5px] font-medium">{t.label}</div>
            <div className="muted text-[11px] leading-snug">{t.about}</div>
          </button>
        );
      })}
    </div>
  );
}

/** Background, panel, text and accent of a palette (read from its CSS block). */
function ThemeColors({ id }: { id: string }) {
  const [c, setC] = useState<string[]>([]);
  useEffect(() => {
    // the tokens live on :root[data-theme=…]: switch for one synchronous style read
    const root = document.documentElement;
    const prev = root.dataset.theme;
    root.dataset.theme = id;
    const cs = getComputedStyle(root);
    const v = ["--bg", "--panel-2", "--text-2", "--accent", "--win", "--loss"].map((k) => cs.getPropertyValue(k).trim());
    root.dataset.theme = prev;
    setC(v);
  }, [id]);
  return (
    <span className="flex" style={{ flex: 1 }}>
      {c.map((x, i) => (
        <span key={i} style={{ flex: i < 2 ? 2 : 1, background: x }} />
      ))}
    </span>
  );
}
