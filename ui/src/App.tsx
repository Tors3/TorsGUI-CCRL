import * as Tooltip from "@radix-ui/react-tooltip";
import { Command } from "cmdk";
import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Crown,
  Rocket,
  Cpu,
  Download,
  Gamepad2,
  Gauge,
  LayoutDashboard,
  ListOrdered,
  Microscope,
  Palette as PaletteIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  Puzzle,
  ScrollText,
  Settings as SettingsIcon,
  Swords,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Toaster, toast } from "sonner";
import type { EventRecord } from "./bindings/EventRecord";
import type { Health } from "./bindings/Health";
import type { LiveLane } from "./bindings/LiveLane";
import { useT, type Key } from "./i18n";
import type { TournamentSummary } from "./bindings/TournamentSummary";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ProgressBar } from "./components/ui";
import { call, isTauri, usePoll } from "./lib/api";
import { setUserPieceSets } from "./lib/boardPrefs";
import type { UserPieceSet } from "./bindings/UserPieceSet";
import { Bench } from "./pages/Bench";
import { CcrlLists } from "./pages/CcrlLists";
import { Dashboard } from "./pages/Dashboard";
import { Engines } from "./pages/Engines";
import { ExportPage } from "./pages/Export";
import { Games } from "./pages/Games";
import { GettingStarted } from "./pages/GettingStarted";
import { Help } from "./pages/Help";
import { Live } from "./pages/Live";
import { Logs } from "./pages/Logs";
import { SettingsPage } from "./pages/Settings";
import { TournamentDetailPage } from "./pages/TournamentDetail";
import { Tournaments } from "./pages/Tournaments";
import { Wizard } from "./pages/Wizard";
import { AnalysisPage } from "./pages/Analysis";
import { SuitesPage } from "./pages/Suites";
import { PlayPage } from "./pages/Play";
import { THEMES, themeLabel, useTheme, type ThemeId } from "./lib/theme";

type NavItem = { to: string; label: Key; icon: typeof Trophy; key: string };

/** The sidebar: pages grouped by what they are for. */
const GROUPS: { id: string; label: Key | ""; items: NavItem[] }[] = [
  { id: "home", label: "", items: [{ to: "/", label: "app.nav.dashboard", icon: LayoutDashboard, key: "d" }] },
  {
    id: "testing",
    label: "app.group.testing",
    items: [
      { to: "/tournaments", label: "app.nav.tournaments", icon: Trophy, key: "t" },
      { to: "/live", label: "app.nav.live", icon: Activity, key: "l" },
      { to: "/games", label: "app.nav.games", icon: Crown, key: "a" },
      { to: "/export", label: "app.nav.export", icon: Download, key: "x" },
    ],
  },
  {
    id: "engines",
    label: "app.group.engines",
    items: [
      { to: "/engines", label: "app.nav.engines", icon: Cpu, key: "e" },
      { to: "/ccrl", label: "app.nav.ccrl", icon: ListOrdered, key: "c" },
      { to: "/bench", label: "app.nav.bench", icon: Gauge, key: "b" },
    ],
  },
  {
    id: "analysis",
    label: "app.group.analysis",
    items: [
      { to: "/analysis", label: "app.nav.analysis", icon: Microscope, key: "y" },
      { to: "/suites", label: "app.nav.suites", icon: Puzzle, key: "p" },
      { to: "/play", label: "app.nav.play", icon: Gamepad2, key: "v" },
    ],
  },
  {
    id: "app",
    label: "app.group.app",
    items: [
      { to: "/settings", label: "app.nav.settings", icon: SettingsIcon, key: "s" },
      { to: "/logs", label: "app.nav.logs", icon: ScrollText, key: "o" },
      { to: "/start", label: "app.nav.start", icon: Rocket, key: "r" },
      { to: "/help", label: "app.nav.help", icon: CircleHelp, key: "h" },
    ],
  },
];
const NAV = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
const isActive = (to: string, path: string) => (to === "/" ? path === "/" : path === to || path.startsWith(to + "/"));

/** A per-viewer preference kept in localStorage. */
function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const x = localStorage.getItem(key);
      return x == null ? initial : (JSON.parse(x) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (x: T) => {
      setV(x);
      try {
        localStorage.setItem(key, JSON.stringify(x));
      } catch {
        /* private mode */
      }
    },
    [key],
  );
  return [v, set];
}

function Sidebar() {
  const loc = useLocation();
  const { theme, setTheme, cycle } = useTheme();
  const [narrow, setNarrow] = useLocal("torsgui-sidebar-narrow", false);
  const t = useT();
  const liveN = useLiveCount();
  const [closed, setClosed] = useLocal<string[]>("torsgui-nav-closed", []);
  const toggle = (id: string) => setClosed(closed.includes(id) ? closed.filter((x) => x !== id) : [...closed, id]);
  return (
    <aside
      className={`${narrow ? "w-[54px] sidebar-narrow" : "w-[204px]"} shrink-0 flex flex-col gap-0.5 p-2 overflow-y-auto`}
      style={{ background: "var(--bg-2)", borderRight: "1px solid var(--border)" }}
      data-testid="sidebar"
    >
      <div className={`flex items-center gap-2 pt-1 pb-2 ${narrow ? "justify-center" : "px-2"}`}>
        <img src="icon.svg" alt="" width={22} height={22} />
        {!narrow && (
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">TorsGUI</div>
            <div className="text-[10.5px] muted">{t("app.sidebar.tagline")}</div>
          </div>
        )}
      </div>
      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {GROUPS.map((g) => {
          const open = !g.label || narrow || !closed.includes(g.id) || g.items.some((i) => isActive(i.to, loc.pathname));
          return (
            <div key={g.id} className="flex flex-col gap-0.5" role="group" aria-label={g.label ? t(g.label) : "Home"}>
              {g.label &&
                (narrow ? (
                  <div className="nav-sep" />
                ) : (
                  <button className="nav-group" onClick={() => toggle(g.id)} aria-expanded={open} data-testid={`nav-group-${g.id}`}>
                    {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    {g.label && t(g.label)}
                  </button>
                ))}
              {open &&
                g.items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.to === "/"}
                    title={narrow ? t(n.label) : undefined}
                    aria-label={narrow ? t(n.label) : undefined}
                    className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                  >
                    <span className="relative inline-flex">
                      <n.icon size={16} />
                      {narrow && n.to === "/live" && liveN > 0 && <span className="nav-dot-count tnum">{liveN}</span>}
                    </span>
                    {!narrow && <span className="flex-1 truncate">{t(n.label)}</span>}
                    {!narrow && n.to === "/live" && liveN > 0 && (
                      <span className="chip chip-win tnum" title={t("app.liveGames", { count: liveN })} data-testid="nav-live-count">
                        {liveN}
                      </span>
                    )}
                  </NavLink>
                ))}
            </div>
          );
        })}
      </nav>
      <div className={`mt-auto flex flex-col gap-1.5 pt-3 ${narrow ? "items-center" : "px-1"}`}>
        {narrow ? (
          <button className="btn btn-sm btn-icon" onClick={cycle} title={t("app.sidebar.nextTheme")} aria-label={t("app.sidebar.nextTheme")}>
            <PaletteIcon size={13} />
          </button>
        ) : (
          <label className="flex items-center gap-2" title={t("app.sidebar.themeTip")}>
            <PaletteIcon size={13} className="muted shrink-0" />
            <select className="select" style={{ height: 24, fontSize: 12 }} value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)} aria-label={t("app.sidebar.theme")} data-testid="theme-select">
              {THEMES.map((th) => (
                <option key={th.id} value={th.id}>
                  {themeLabel(th.id, t)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className={`btn btn-sm ${narrow ? "btn-icon" : ""}`}
          onClick={() => setNarrow(!narrow)}
          title={narrow ? t("app.sidebar.expand") : t("app.sidebar.iconsOnly")}
          aria-label={narrow ? t("app.sidebar.expand") : t("app.sidebar.collapse")}
          data-testid="sidebar-toggle"
        >
          {narrow ? (
            <PanelLeftOpen size={13} />
          ) : (
            <span className="muted inline-flex items-center gap-1.5">
              <PanelLeftClose size={13} /> {t("app.sidebar.iconsOnly")}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}

const TOAST_KINDS = new Set([
  "tournament_finished",
  "tournament_incomplete",
  "tournament_retry",
  "queue_advanced",
  "engine_problem",
  "time_forfeit",
  "runner_failed",
  "tournament_paused",
  "tournament_stopped",
  "bench_finished",
  "exported",
  "tournament_resumed",
]);

/** Toasts for important backend events (tournament finished, engine crash, queue advanced...). */
function useEventToasts() {
  const seq = useRef<number | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        if (seq.current == null) {
          seq.current = await call<number>("last_event_seq");
          return;
        }
        const evs = await call<EventRecord[]>("events_since", { seq: seq.current, limit: 50 });
        for (const e of evs) {
          seq.current = Math.max(seq.current ?? 0, e.seq);
          if (!TOAST_KINDS.has(e.kind)) continue;
          const f = e.level === "error" ? toast.error : e.level === "warn" ? toast.warning : e.level === "success" ? toast.success : toast.info;
          f(e.message, { duration: e.level === "error" ? 12000 : 6000 });
        }
      } catch {
        /* backend restarting */
      }
    };
    tick();
    const t = setInterval(() => !stop && tick(), 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
}

function StatusPill() {
  const t = useT();
  const { data } = usePoll<Health>("health", {}, 5000);
  if (!data) return null;
  const errors = data.anomalies.filter((a) => a.level === "error").length;
  const warns = data.anomalies.length - errors;
  const tone = errors ? "chip-loss" : warns ? "chip-warn" : data.runners_alive ? "chip-win" : "";
  return (
    <NavLink to="/" className={`chip ${tone}`} title={data.anomalies.map((a) => a.message).join("\n") || t("app.status.healthy")} data-testid="status-pill">
      <span className={`dot ${data.runners_alive ? "dot-pulse" : ""}`} />
      {t("app.status.line", { alive: data.runners_alive, expected: data.runners_expected, fastchess: data.fastchess_processes, free: (data.free_ram_mb / 1024).toFixed(0) })}
      {errors + warns > 0 && t("app.status.alerts", { count: errors + warns })}
    </NavLink>
  );
}

function Palette({ open, setOpen, toggleTheme }: { open: boolean; setOpen: (o: boolean) => void; toggleTheme: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const [ts, setTs] = useState<TournamentSummary[]>([]);
  useEffect(() => {
    if (open) call<TournamentSummary[]>("tournaments_list").then(setTs).catch(() => {});
  }, [open]);
  const run = (f: () => void) => {
    setOpen(false);
    f();
  };
  if (!open) return null;
  return (
    <div
      className="overlay flex items-start justify-center pt-[14vh]"
      onClick={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <div className="w-[560px] max-w-[94vw]" onClick={(e) => e.stopPropagation()}>
        <Command label={t("app.palette.label")} loop>
          <Command.Input autoFocus placeholder={t("app.palette.placeholder")} />
          <Command.List>
            <Command.Empty>{t("app.palette.empty")}</Command.Empty>
            <Command.Group heading={t("app.palette.goTo")}>
              {NAV.map((n) => (
                <Command.Item key={n.to} onSelect={() => run(() => nav(n.to))}>
                  <n.icon size={15} /> {t(n.label)}
                  {n.group && <span className="muted text-[11px]">· {t(n.group)}</span>}
                  <span className="ml-auto kbd">g {n.key}</span>
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading={t("app.palette.actions")}>
              <Command.Item onSelect={() => run(() => nav("/tournaments/new"))}>
                <Plus size={15} /> {t("app.palette.newTournament")} <span className="ml-auto kbd">n</span>
              </Command.Item>
              <Command.Item onSelect={() => run(() => call("queue_start").then(() => toast.success(t("app.palette.queueStarted"))).catch((e) => toast.error(String(e.message))))}>
                <Play size={15} /> {t("app.palette.startQueue")}
              </Command.Item>
              <Command.Item onSelect={() => run(toggleTheme)}>
                <PaletteIcon size={15} /> {t("app.palette.nextTheme")} <span className="ml-auto kbd">t</span>
              </Command.Item>
              <Command.Item onSelect={() => run(() => nav("/analysis"))}>
                <Microscope size={15} /> {t("app.palette.analyse")}
              </Command.Item>
            </Command.Group>
            <Command.Group heading={t("app.palette.tournaments")}>
              {ts.map((x) => (
                <Command.Item key={x.record.id} value={`${x.record.name} ${x.record.state}`} onSelect={() => run(() => nav(`/tournaments/${encodeURIComponent(x.record.id)}`))}>
                  <Swords size={15} /> {x.record.name}
                  <span className="ml-auto muted text-[11px]">{x.record.state}</span>
                </Command.Item>
              ))}
              {ts
                .filter((x) => x.record.state === "running")
                .map((x) => (
                  <Command.Item key={`p-${x.record.id}`} value={`pause ${x.record.name}`} onSelect={() => run(() => call("tournament_pause", { id: x.record.id }).then(() => toast(t("app.palette.pausing", { name: x.record.name }))))}>
                    <Pause size={15} /> {t("app.palette.pause", { name: x.record.name })}
                  </Command.Item>
                ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function Shortcuts({ setPalette, toggleTheme }: { setPalette: (o: boolean) => void; toggleTheme: () => void }) {
  const nav = useNavigate();
  useEffect(() => {
    call<UserPieceSet[]>("piece_sets_user").then(setUserPieceSets).catch(() => {});
  }, []);
  const pending = useRef<number>(0);
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // an open dialog (game viewer, live board…) owns the single-key shortcuts
      if (document.querySelector('[role="dialog"]')) return;
      if (Date.now() - pending.current < 1200) {
        pending.current = 0;
        const item = NAV.find((n) => n.key === e.key);
        if (item) nav(item.to);
        return;
      }
      if (e.key === "g") pending.current = Date.now();
      else if (e.key === "n") nav("/tournaments/new");
      else if (e.key === "t") toggleTheme();
      else if (e.key === "/") {
        e.preventDefault();
        setPalette(true);
      }
    },
    [nav, setPalette, toggleTheme],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);
  return null;
}

/** In the desktop app, links that open a new window go to the system browser. */
function useExternalLinks() {
  useEffect(() => {
    if (!isTauri()) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      const href = a?.getAttribute("href") ?? "";
      if (a && /^https?:\/\//.test(href) && (a.target === "_blank" || !href.startsWith(location.origin))) {
        e.preventDefault();
        call("open_url", { url: href }).catch((err) => toast.error(String(err.message ?? err)));
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}

type UpdateInfo = { current: string; latest: string; newer: boolean; url: string; kind: string; asset: { name: string; size: number } | null };
type UpdateJob = { running: boolean; phase: string; done?: number; total?: number; message?: string; error?: string; restart?: boolean };

/** A newer TorsGUI on GitHub (checked at start, or from Settings), installed from here. */
function UpdateBanner() {
  const t = useT();
  const [u, setU] = useState<UpdateInfo>();
  const [hidden, setHidden] = useState(false);
  const [job, setJob] = useState<UpdateJob>();
  const check = useCallback((manual: boolean) => {
    call<UpdateInfo>("update_check")
      .then((x) => {
        if (!x.newer) {
          if (manual) toast.success(t("app.update.latest", { version: x.current }));
          return;
        }
        if (!manual) {
          try {
            if (localStorage.getItem("torsgui-update-dismissed") === x.latest) return;
          } catch {
            /* private mode */
          }
        }
        setHidden(false);
        setU(x);
      })
      .catch((e) => manual && toast.error(String(e.message ?? e)));
  }, []);
  useEffect(() => {
    call<{ check_updates: boolean }>("settings_get")
      .then((s) => s.check_updates && check(false))
      .catch(() => {});
    const onAsk = () => check(true);
    window.addEventListener("torsgui-check-update", onAsk);
    return () => window.removeEventListener("torsgui-check-update", onAsk);
  }, [check]);
  useEffect(() => {
    if (!job?.running) return;
    const t = setInterval(() => call<UpdateJob | null>("job_status", { id: "update" }).then((j) => j && setJob(j)).catch(() => {}), 400);
    return () => clearInterval(t);
  }, [job?.running]);
  const install = async () => {
    try {
      await call("update_install");
      setJob({ running: true, phase: "download", done: 0, total: u?.asset?.size ?? 0 });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  if (!u || hidden) return null;
  const mb = (b?: number) => ((b ?? 0) / 1048576).toFixed(1);
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-[12.5px]" style={{ background: "var(--accent-bg)", borderBottom: "1px solid var(--border)" }} data-testid="update-banner">
      <Download size={13} style={{ color: "var(--accent)" }} />
      <span>
        <b>{t("app.update.available", { latest: u.latest })}</b> {t("app.update.isAvailable")} <span className="muted">{t("app.update.youHave", { current: u.current })}</span>
      </span>
      {job ? (
        job.phase === "download" ? (
          <span className="flex items-center gap-2 tnum" data-testid="update-progress">
            {t("app.update.downloading", { done: mb(job.done), total: mb(job.total) })}
            <span className="inline-block w-40">
              <ProgressBar value={job.done ?? 0} max={Math.max(1, job.total ?? 1)} />
            </span>
          </span>
        ) : job.phase === "install" ? (
          <span>{t("app.update.installing")}</span>
        ) : job.phase === "failed" ? (
          <span className="l">
            {job.error}{" "}
            <a className="link" href={u.url} target="_blank" rel="noreferrer">
              {t("app.update.releasePage")}
            </a>
          </span>
        ) : (
          <span className="w">{job.message}</span>
        )
      ) : (
        <>
          {u.asset ? (
            <button className="btn btn-sm btn-primary" onClick={install} title={t("app.update.assetTip", { name: u.asset.name, size: mb(u.asset.size), kind: u.kind })} data-testid="update-install">
              {t("app.update.now")}
            </button>
          ) : null}
          <a className={`btn btn-sm ${u.asset ? "" : "btn-primary"}`} href={u.url} target="_blank" rel="noreferrer">
            {u.asset ? t("app.update.whatsNew") : t("app.update.download")}
          </a>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              try {
                localStorage.setItem("torsgui-update-dismissed", u.latest);
              } catch {
                /* private mode */
              }
              setHidden(true);
            }}
          >
            {t("app.update.notNow")}
          </button>
        </>
      )}
    </div>
  );
}

function Layout() {
  const t = useT();
  const { scheme, cycle } = useTheme();
  useExternalLinks();
  const [palette, setPalette] = useState(false);
  const loc = useLocation();
  useEventToasts();
  const cur = useMemo(() => NAV.find((n) => isActive(n.to, loc.pathname)), [loc.pathname]);
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-[42px] shrink-0 flex items-center justify-between gap-3 px-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 text-[12.5px] min-w-0">
            <BarChart3 size={14} className="muted shrink-0" />
            <span className="muted">TorsGUI</span>
            {cur?.group && (
              <>
                <span className="muted">/</span>
                <span className="muted">{t(cur.group)}</span>
              </>
            )}
            <span className="muted">/</span>
            <span className="font-medium truncate">{cur ? t(cur.label) : ""}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <button className="btn btn-sm shrink-0" onClick={() => setPalette(true)} title={t("app.header.commandsTip")}>
              <span className="muted">{t("app.header.commands")}</span>
              <span className="kbd">Ctrl K</span>
            </button>
            <StatusPill />
          </div>
        </header>
        <UpdateBanner />
        <main className="flex-1 min-h-0 overflow-auto p-4" key={loc.pathname.split("/")[1]}>
          <ErrorBoundary resetKey={loc.pathname}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/tournaments" element={<Tournaments />} />
              <Route path="/tournaments/new" element={<Wizard />} />
              <Route path="/tournaments/:id/edit" element={<Wizard key="edit" />} />
              <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
              <Route path="/live" element={<Live />} />
              <Route path="/games" element={<Games />} />
              <Route path="/analysis" element={<AnalysisPage />} />
              <Route path="/suites" element={<SuitesPage />} />
              <Route path="/play" element={<PlayPage />} />
              <Route path="/help" element={<Help />} />
              <Route path="/start" element={<GettingStarted />} />
              <Route path="/engines" element={<Engines />} />
              <Route path="/ccrl" element={<CcrlLists />} />
              <Route path="/bench" element={<Bench />} />
              <Route path="/export" element={<ExportPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/logs" element={<Logs />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
      <Palette open={palette} setOpen={setPalette} toggleTheme={cycle} />
      <Shortcuts setPalette={setPalette} toggleTheme={cycle} />
      <Toaster theme={scheme} position="bottom-right" richColors closeButton />
    </div>
  );
}

export default function App() {
  return (
    <Tooltip.Provider>
      <HashRouter>
        <Layout />
      </HashRouter>
    </Tooltip.Provider>
  );
}

/** Games being played right now (lanes with a game), for the badge next to Live. */
function useLiveCount(): number {
  const { data } = usePoll<LiveLane[]>("live_lanes", {}, 5000);
  return (data ?? []).filter((l) => l.game != null).length;
}
