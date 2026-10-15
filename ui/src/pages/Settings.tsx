import { CheckCircle2, Download, GitBranch, HardDrive, RotateCcw, Save, Server, XCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Gpu } from "../bindings/Gpu";
import type { Housekeeping } from "../bindings/Housekeeping";
import type { Settings } from "../bindings/Settings";
import type { Topology } from "../bindings/Topology";
import { BoardAppearance } from "../components/BoardSettings";
import { LanguagePicker } from "../components/LanguagePicker";
import { useT, type Key } from "../i18n";
import { OpeningBooksPanel } from "../components/OpeningBooks";
import { BroadcastSettings } from "../components/Broadcast";
import { BOOK_FILTERS, PathInput } from "../components/PathInput";
import { ErrorBox, Field, PageHeader, PageTabs, Panel, Spinner, useTabParam } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { bytes } from "../lib/format";
import type { AppInfo } from "../lib/types";
import { FONTS, setStrongText, useFont, useStrongText } from "../lib/font";
import { THEMES, themeAbout, themeLabel, useTheme } from "../lib/theme";

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

/** The graphics cards (for GPU engines), looked up again on request. */
function GpuList() {
  const t = useT();
  const [cards, setCards] = useState<Gpu[]>();
  const load = (refresh: boolean) => {
    setCards(undefined);
    call<Gpu[]>("gpus", { refresh }).then(setCards).catch(() => setCards([]));
  };
  useEffect(() => load(false), []);
  return (
    <Panel
      title={t("engines.gpu.cards")}
      actions={
        <button className="btn btn-sm" onClick={() => load(true)} data-testid="gpus-refresh">
          {t("settings.gpuRefresh")}
        </button>
      }
    >
      <div className="flex flex-col gap-1.5 text-[12.5px]" data-testid="settings-gpus">
        {!cards ? (
          <Spinner size={12} />
        ) : cards.length === 0 ? (
          <span className="muted">{t("engines.gpu.noCards")}</span>
        ) : (
          cards.map((c) => (
            <div key={c.index} className="flex items-center gap-2">
              <span className="chip">{t("engines.gpu.card", { n: c.index })}</span>
              <span className="font-medium">{c.name}</span>
              {c.memory_mb > 0 && <span className="muted tnum">{(c.memory_mb / 1024).toFixed(c.memory_mb >= 10240 ? 0 : 1)} GB</span>}
              <span className="muted text-[11px]">{c.source}</span>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function TopologyView({ t }: { t: Topology }) {
  const tr = useT();
  const yn = (v: boolean) => tr(v ? "app.common.yes" : "app.common.no");
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px]">
        <b>{t.cpu_model}</b> · {tr("settings.topo.line", { sockets: t.sockets, cores: t.physical_cores, threads: t.logical_cpus, groups: t.groups, avx2: yn(t.has_avx2), avx512: yn(t.has_avx512) })}
        <span className="muted">{tr("settings.topo.source", { source: t.source })}</span>
      </div>
      <div className="flex gap-3 flex-wrap">
        {t.nodes.map((n) => {
          const cpus = t.cpus.filter((c) => c.node === n.id);
          const cores = Array.from(new Set(cpus.map((c) => c.core)));
          return (
            <div key={n.id} className="panel p-2" style={{ background: "var(--bg-2)" }} data-testid="numa-node">
              <div className="text-[12px] mb-1.5 flex justify-between gap-4">
                <b>{tr("settings.topo.node", { id: n.id })}</b>
                <span className="muted">
                  {tr("settings.topo.group", { group: n.group, cores: n.physical_cores, threads: n.logical_cpus })}{n.memory_mb ? ` · ${(n.memory_mb / 1024).toFixed(0)} GB` : ""}
                </span>
              </div>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(10, cores.length)}, 26px)` }}>
                {cores.map((c) => {
                  const threads = cpus.filter((x) => x.core === c).sort((a, b) => a.smt - b.smt);
                  return (
                    <div key={c} className="rounded flex flex-col overflow-hidden" style={{ border: "1px solid var(--border-strong)" }} title={tr("settings.topo.core", { core: c, list: threads.map((x) => `cpu ${x.id} (bit ${x.number})`).join(", ") })}>
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
      <div className="muted text-[11.5px]">{tr("settings.topo.about", { caches: t.caches.map((c) => `L${c.level} ${c.kind} ${c.size_kb} KB`).join(" · ") || "—" })}</div>
    </div>
  );
}

export function SettingsPage() {
  const t = useT();
  const { data, refresh } = usePoll<Settings>("settings_get", {}, 0);
  const { data: info, refresh: refreshInfo } = usePoll<AppInfo>("app_info", {}, 0);
  const { data: topo } = usePoll<Topology>("topology", {}, 0);
  const { data: hk, refresh: refreshHk } = usePoll<Housekeeping>("housekeeping", {}, 0);
  const [s, setS] = useState<Settings>();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  const [gitMsg, setGitMsg] = useState("");
  const [tab, setTab] = useTabParam(SETTINGS_TABS.map((x) => x.id), "general");
  useEffect(() => {
    if (data) setS(data);
  }, [data]);
  if (!s) return <Spinner />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const save = async () => {
    try {
      await call("settings_save", { settings: s });
      toast.success(t("settings.saved"));
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
      toast.success(msg ? msg(r) : t("settings.done"));
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
        <Panel title={t("settings.tester")}>
          <div className="grid grid-cols-2 gap-3">
            {txt("tester_name", t("settings.testerName"), t("settings.testerHint"), false)}
            {txt("site", t("settings.site"), t("settings.siteHint"), false)}
            <Field label={t("settings.hashBlitz")} hint={t("settings.hashBlitzHint")}>
              <input className="input tnum" type="number" value={s.hash_per_thread_blitz_mb} onChange={(e) => set("hash_per_thread_blitz_mb", +e.target.value)} data-testid="hash-blitz" />
            </Field>
            <Field label={t("settings.hashOther")} hint={t("settings.hashOtherHint")}>
              <input className="input tnum" type="number" value={s.hash_per_thread_mb} onChange={(e) => set("hash_per_thread_mb", +e.target.value)} />
            </Field>
            <Field label={t("settings.factor")}>
              <input className="input tnum" type="number" step={0.001} value={s.default_factor} onChange={(e) => set("default_factor", +e.target.value)} />
            </Field>
            <Field label={t("settings.gap")} hint={t("settings.gapHint")}>
              <input className="input tnum" type="number" value={s.default_cpu_gap} onChange={(e) => set("default_cpu_gap", +e.target.value)} />
            </Field>
          </div>
        </Panel>
        <Panel title={t("settings.adjudication")}>
          <div className="grid grid-cols-3 gap-2 text-[12.5px]">
            <label className="col-span-3 flex items-center gap-2">
              <input type="checkbox" checked={s.adjudication.draw_enabled} onChange={(e) => set("adjudication", { ...s.adjudication, draw_enabled: e.target.checked })} /> {t("settings.draw")}
            </label>
            {(["draw_movenumber", "draw_movecount", "draw_score"] as const).map((k) => (
              <input key={k} className="input tnum" type="number" value={s.adjudication[k]} onChange={(e) => set("adjudication", { ...s.adjudication, [k]: +e.target.value })} aria-label={k} />
            ))}
            <label className="col-span-3 flex items-center gap-2">
              <input type="checkbox" checked={s.adjudication.resign_enabled} onChange={(e) => set("adjudication", { ...s.adjudication, resign_enabled: e.target.checked })} /> {t("settings.resign")}
            </label>
            {(["resign_movecount", "resign_score"] as const).map((k) => (
              <input key={k} className="input tnum" type="number" value={s.adjudication[k]} onChange={(e) => set("adjudication", { ...s.adjudication, [k]: +e.target.value })} aria-label={k} />
            ))}
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={s.adjudication.resign_twosided} onChange={(e) => set("adjudication", { ...s.adjudication, resign_twosided: e.target.checked })} /> {t("settings.twoSided")}
            </label>
          </div>
        </Panel>
        <Panel title={t("settings.notifications")}>
          <div className="flex flex-col gap-2 text-[12.5px]">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.desktop_notifications} onChange={(e) => set("desktop_notifications", e.target.checked)} data-testid="desktop-notifications" /> {t("settings.desktop")}
            </label>
            <div className="muted text-[11.5px] -mt-1 ml-6">{t("settings.desktopAbout")}</div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.check_updates} onChange={(e) => set("check_updates", e.target.checked)} data-testid="check-updates" /> {t("settings.updates")}
            </label>
            <div className="muted text-[11.5px] -mt-1 ml-6">{t("settings.updatesAbout1")}<b>{t("settings.updatesAbout2")}</b>{t("settings.updatesAbout3")}</div>
            <div>
              <button className="btn btn-sm" onClick={() => window.dispatchEvent(new Event("torsgui-check-update"))} data-testid="check-update-now">
                {t("settings.checkNow")}
              </button>
            </div>
            {info?.os === "windows" && (
              <div className="flex flex-col gap-1">
                <div>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      call<{ path: string }>("desktop_shortcut_create")
                        .then((r) => toast.success(t("settings.shortcutCreated", { path: r.path })))
                        .catch((e) => toast.error(e.message))
                    }
                    data-testid="desktop-shortcut"
                  >
                    {t("settings.shortcut")}
                  </button>
                </div>
                <div className="muted text-[11.5px]">{t("settings.shortcutAbout")}</div>
              </div>
            )}
          </div>
        </Panel>
        <Panel title={t("settings.builds")}>
          <div className="flex flex-col gap-2.5 text-[12.5px]">
            <p className="muted">
              {t("settings.buildsAbout1")}<b>{t("settings.buildsAbout2")}</b>{t("settings.buildsAbout3")}
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.avx2_only} onChange={(e) => set("avx2_only", e.target.checked)} data-testid="avx2-only" /> {t("settings.avx2Only")}
            </label>
            <div className="muted text-[11.5px]">
              {t("settings.thisCpu1", { avx512: topo ? t(topo.has_avx512 ? "app.common.yes" : "app.common.no") : "…" })}<i>{t("settings.thisCpu2")}</i>{t("settings.thisCpu3")}
            </div>
          </div>
        </Panel>
      </div>
    ),
    appearance: (
      <div className="flex flex-col gap-3">
        <Panel title={t("app.language")} actions={<span className="muted text-[11.5px]">{t("settings.savedHere")}</span>}>
          <LanguagePicker />
        </Panel>
        <Panel title={t("settings.colourTheme")} actions={<span className="muted text-[11.5px]">{t("settings.savedHereT")}</span>}>
          <ThemePicker />
        </Panel>
        <Panel title={t("settings.font")} actions={<span className="muted text-[11.5px]">{t("settings.savedHere")}</span>}>
          <FontPicker />
        </Panel>
        <Panel title={t("settings.board")} actions={<span className="muted text-[11.5px]">{t("settings.savedHere")}</span>}>
          <BoardAppearance />
        </Panel>
      </div>
    ),
    paths: (
      <div className="grid gap-3 cols-fit">
        <Panel title={t("settings.paths")}>
          <div className="grid grid-cols-1 gap-2.5">
            {path("engines_dir", t("settings.enginesDir"), "folder", t("settings.enginesDirHint"))}
            {path("books_dir", t("settings.booksDir"), "folder")}
            {path("default_book", t("settings.defaultBook"), "file")}
            {path("syzygy_path", t("settings.syzygy"), "folder", t("settings.syzygyHint"))}
            {path("gaviota_path", t("settings.gaviota"), "folder", t("settings.gaviotaHint"))}
            {path("nalimov_path", t("settings.nalimov"), "folder", t("settings.nalimovHint"))}
            {path("egbb_path", t("settings.egbb"), "folder", t("settings.egbbHint"))}
            {path("output_dir", t("settings.output"), "folder")}
          </div>
        </Panel>
        <Panel title={t("settings.fastchess")}>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-[12.5px]">
              {info?.fastchess_found ? <CheckCircle2 size={15} className="w" /> : <XCircle size={15} className="l" />}
              <span className="mono break-all">{info?.fastchess_version ?? t("settings.notFound")}</span>
            </div>
            <div className="mono muted text-[11.5px] break-all">{info?.fastchess}</div>
            <div className="grid grid-cols-2 gap-2">
              {txt("fastchess_version", t("settings.pinned"))}
              <div className="flex items-end">
                <button className="btn w-full justify-center" onClick={() => act("fc", "fastchess_install", {}, (r) => t("settings.installed", { sha: r.sha256.slice(0, 12) }))} disabled={!!busy}>
                  {busy === "fc" ? <Spinner /> : <Download size={13} />} {t("settings.download")}
                </button>
              </div>
            </div>
            {txt("fastchess_path", t("settings.custom"), t("settings.customHint"))}
            {txt("github_token", t("settings.token"), t("settings.tokenHint"))}
            <div className="flex items-center gap-2 text-[12.5px]">
              {info?.runner_found ? <CheckCircle2 size={15} className="w" /> : <XCircle size={15} className="l" />} {t("settings.runner")} <span className="mono muted break-all">{info?.runner}</span>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.use_task_scheduler} onChange={(e) => set("use_task_scheduler", e.target.checked)} /> {t("settings.scheduler")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.auto_resume} onChange={(e) => set("auto_resume", e.target.checked)} /> {t("settings.autoResume")}
            </label>
            <div className="flex gap-2">
              <button className="btn btn-sm" onClick={() => act("resume", "resume_interrupted", {}, (r) => t("settings.resumed", { count: r.length }))}>
                <RotateCcw size={12} /> {t("settings.resumeNow")}
              </button>
              <button className="btn btn-sm" onClick={() => act("logon", "register_logon_resume", {}, (r) => String(r))}>
                <Server size={12} /> {t("settings.logon")}
              </button>
            </div>
          </div>
        </Panel>
      </div>
    ),
    books: (
      <Panel title={t("settings.books")}>
        <OpeningBooksPanel settings={s} onSettings={refresh} />
      </Panel>
    ),
    broadcast: (
      <Panel title={t("settings.broadcast")} actions={<span className="muted text-[11.5px]">{t("settings.broadcastAbout")}</span>}>
        <BroadcastSettings s={s} set={set} />
      </Panel>
    ),
    hardware: (
      <div className="flex flex-col gap-3">
        <Panel title={t("settings.topology")}>{topo ? <TopologyView t={topo} /> : <Spinner />}</Panel>
        <GpuList />
      </div>
    ),
    maintenance: (
      <div className="grid gap-3 cols-fit">
        <Panel title={t("settings.housekeeping")} actions={<HardDrive size={14} className="muted" />}>
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
                <b>{t("settings.logs")}</b>{t("settings.logFiles", { count: hk.log_files, size: bytes(hk.log_bytes) })}
              </div>
              <div>
                <b>{t("settings.unused")}</b> {hk.unused_engines.join(", ") || t("settings.none")}
              </div>
              <div>
                <b>{t("settings.superseded")}</b> {hk.superseded_engines.map(([a, b]) => `${a} → ${b}`).join(", ") || t("settings.none")}
              </div>
              <div className="flex gap-2 items-end">
                <Field label={t("settings.keepLogs")}>
                  <input className="input tnum" type="number" value={s.log_retention_days} onChange={(e) => set("log_retention_days", +e.target.value)} />
                </Field>
                <button className="btn" onClick={() => act("rot", "rotate_logs", { days: s.log_retention_days }, (r) => t("settings.rotated", { count: r.files, size: bytes(r.bytes) }))}>
                  {t("settings.rotate")}
                </button>
              </div>
            </div>
          ) : (
            <Spinner />
          )}
        </Panel>
        <Panel title={t("settings.git")} actions={<GitBranch size={14} className="muted" />}>
          <div className="flex flex-col gap-2">
            {txt("git_sync_dir", t("settings.repo"), t("settings.repoHint"))}
            <Field label={t("settings.commit")}>
              <input className="input" value={gitMsg} onChange={(e) => setGitMsg(e.target.value)} placeholder="Results 2026-09-28" />
            </Field>
            <button className="btn" onClick={() => act("git", "git_sync", { dest: s.git_sync_dir, message: gitMsg || null }, (r) => t("settings.synced", { count: r.length }))} disabled={!s.git_sync_dir}>
              {t("settings.sync")}
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
        title={t("settings.title")}
        sub={info ? t("settings.sub", { version: info.version, install: info.install ? ` (${info.install})` : "", exe: info.exe ? t("settings.runningFrom", { exe: info.exe }) : "", workspace: info.workspace, os: info.os }) : ""}
        actions={
          <button className="btn btn-primary" onClick={save}>
            <Save size={14} /> {t("settings.save")}
          </button>
        }
      />
      <ErrorBox error={err} />
      <PageTabs tabs={SETTINGS_TABS.map((x) => ({ id: x.id, label: t(`settings.tabs.${x.id}` as Key) }))} value={tab} onChange={setTab} testid="settings-tab" />
      {panes[tab]}
    </div>
  );
}

/** The app's colour themes, with a preview of each palette. */
function FontPicker() {
  const { font, setFont } = useFont();
  const strong = useStrongText();
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
    <label className="flex items-start gap-2 text-[12.5px]" data-testid="strong-text">
      <input type="checkbox" className="mt-0.5" checked={strong} onChange={(e) => setStrongText(e.target.checked)} />
      <span>
        <span className="font-medium">{t("settings.strongText")}</span>
        <span className="block muted">{t("settings.strongTextAbout")}</span>
      </span>
    </label>
    <div className="flex flex-wrap gap-2" data-testid="font-picker">
      {FONTS.map((f) => (
        <button
          key={f.id}
          className={`btn ${font === f.id ? "btn-primary" : ""}`}
          style={{ fontFamily: f.id === "retro" ? '"DotGothic16", Tahoma, sans-serif' : undefined }}
          onClick={() => setFont(f.id)}
          title={t(`settings.fonts.${f.id}` as Key)}
          data-testid={`font-${f.id}`}
        >
          {f.label}
        </button>
      ))}
      <span className="muted text-[12px] self-center">{t(`settings.fonts.${font}` as Key)}</span>
    </div>
    </div>
  );
}

function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const tr = useT();
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
            <div className="text-[12.5px] font-medium">{themeLabel(t.id, tr)}</div>
            <div className="muted text-[11px] leading-snug">{themeAbout(t.id, tr)}</div>
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
