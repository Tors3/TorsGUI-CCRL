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
import { THEMES, useTheme, type ThemeId } from "./lib/theme";

type NavItem = { to: string; label: string; icon: typeof Trophy; key: string };

/** The sidebar: pages grouped by what they are for. */
const GROUPS: { id: string; label: string; items: NavItem[] }[] = [
  { id: "home", label: "", items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard, key: "d" }] },
  {
    id: "testing",
    label: "Testing",
    items: [
      { to: "/tournaments", label: "Tournaments", icon: Trophy, key: "t" },
      { to: "/live", label: "Live", icon: Activity, key: "l" },
      { to: "/games", label: "Games", icon: Crown, key: "a" },
      { to: "/export", label: "Export", icon: Download, key: "x" },
    ],
  },
  {
    id: "engines",
    label: "Engines",
    items: [
      { to: "/engines", label: "Engines", icon: Cpu, key: "e" },
      { to: "/ccrl", label: "CCRL Lists", icon: ListOrdered, key: "c" },
      { to: "/bench", label: "Bench", icon: Gauge, key: "b" },
    ],
  },
  {
    id: "analysis",
    label: "Analysis",
    items: [
      { to: "/analysis", label: "Game analysis", icon: Microscope, key: "y" },
      { to: "/suites", label: "Test suites", icon: Puzzle, key: "p" },
      { to: "/play", label: "Play vs engine", icon: Gamepad2, key: "v" },
    ],
  },
  {
    id: "app",
    label: "App",
    items: [
      { to: "/settings", label: "Settings", icon: SettingsIcon, key: "s" },
      { to: "/logs", label: "Logs", icon: ScrollText, key: "o" },
      { to: "/start", label: "Getting started", icon: Rocket, key: "r" },
      { to: "/help", label: "Help", icon: CircleHelp, key: "h" },
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
            <div className="text-[10.5px] muted">for CCRL testers</div>
          </div>
        )}
      </div>
      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {GROUPS.map((g) => {
          const open = !g.label || narrow || !closed.includes(g.id) || g.items.some((i) => isActive(i.to, loc.pathname));
          return (
            <div key={g.id} className="flex flex-col gap-0.5" role="group" aria-label={g.label || "Home"}>
              {g.label &&
                (narrow ? (
                  <div className="nav-sep" />
                ) : (
                  <button className="nav-group" onClick={() => toggle(g.id)} aria-expanded={open} data-testid={`nav-group-${g.id}`}>
                    {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    {g.label}
                  </button>
                ))}
              {open &&
                g.items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.to === "/"}
                    title={narrow ? n.label : undefined}
                    aria-label={narrow ? n.label : undefined}
                    className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                  >
                    <n.icon size={16} />
                    {!narrow && <span className="flex-1 truncate">{n.label}</span>}
                  </NavLink>
                ))}
            </div>
          );
        })}
      </nav>
      <div className={`mt-auto flex flex-col gap-1.5 pt-3 ${narrow ? "items-center" : "px-1"}`}>
        {narrow ? (
          <button className="btn btn-sm btn-icon" onClick={cycle} title="Next theme (t)" aria-label="Next theme">
            <PaletteIcon size={13} />
          </button>
        ) : (
          <label className="flex items-center gap-2" title="Colour theme (more in Settings → Appearance)">
            <PaletteIcon size={13} className="muted shrink-0" />
            <select className="select" style={{ height: 24, fontSize: 12 }} value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)} aria-label="Theme" data-testid="theme-select">
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className={`btn btn-sm ${narrow ? "btn-icon" : ""}`}
          onClick={() => setNarrow(!narrow)}
          title={narrow ? "Expand the sidebar" : "Icons only"}
          aria-label={narrow ? "Expand the sidebar" : "Collapse the sidebar"}
          data-testid="sidebar-toggle"
        >
          {narrow ? (
            <PanelLeftOpen size={13} />
          ) : (
            <span className="muted inline-flex items-center gap-1.5">
              <PanelLeftClose size={13} /> Icons only
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
  const { data } = usePoll<Health>("health", {}, 5000);
  if (!data) return null;
  const errors = data.anomalies.filter((a) => a.level === "error").length;
  const warns = data.anomalies.length - errors;
  const tone = errors ? "chip-loss" : warns ? "chip-warn" : data.runners_alive ? "chip-win" : "";
  return (
    <NavLink to="/" className={`chip ${tone}`} title={data.anomalies.map((a) => a.message).join("\n") || "healthy"} data-testid="status-pill">
      <span className={`dot ${data.runners_alive ? "dot-pulse" : ""}`} />
      {data.runners_alive}/{data.runners_expected} runners · {data.fastchess_processes} fastchess · {(data.free_ram_mb / 1024).toFixed(0)} GB free
      {errors + warns > 0 && ` · ${errors + warns} alert${errors + warns > 1 ? "s" : ""}`}
    </NavLink>
  );
}

function Palette({ open, setOpen, toggleTheme }: { open: boolean; setOpen: (o: boolean) => void; toggleTheme: () => void }) {
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
        <Command label="Command palette" loop>
          <Command.Input autoFocus placeholder="Type a command or search…" />
          <Command.List>
            <Command.Empty>No results.</Command.Empty>
            <Command.Group heading="Go to">
              {NAV.map((n) => (
                <Command.Item key={n.to} onSelect={() => run(() => nav(n.to))}>
                  <n.icon size={15} /> {n.label}
                  {n.group && <span className="muted text-[11px]">· {n.group}</span>}
                  <span className="ml-auto kbd">g {n.key}</span>
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Actions">
              <Command.Item onSelect={() => run(() => nav("/tournaments/new"))}>
                <Plus size={15} /> New tournament <span className="ml-auto kbd">n</span>
              </Command.Item>
              <Command.Item onSelect={() => run(() => call("queue_start").then(() => toast.success("Queue started")).catch((e) => toast.error(String(e.message))))}>
                <Play size={15} /> Start the queue
              </Command.Item>
              <Command.Item onSelect={() => run(toggleTheme)}>
                <PaletteIcon size={15} /> Next colour theme <span className="ml-auto kbd">t</span>
              </Command.Item>
              <Command.Item onSelect={() => run(() => nav("/analysis"))}>
                <Microscope size={15} /> Analyse a game or a position
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Tournaments">
              {ts.map((t) => (
                <Command.Item key={t.record.id} value={`${t.record.name} ${t.record.state}`} onSelect={() => run(() => nav(`/tournaments/${encodeURIComponent(t.record.id)}`))}>
                  <Swords size={15} /> {t.record.name}
                  <span className="ml-auto muted text-[11px]">{t.record.state}</span>
                </Command.Item>
              ))}
              {ts
                .filter((t) => t.record.state === "running")
                .map((t) => (
                  <Command.Item key={`p-${t.record.id}`} value={`pause ${t.record.name}`} onSelect={() => run(() => call("tournament_pause", { id: t.record.id }).then(() => toast("Pausing " + t.record.name)))}>
                    <Pause size={15} /> Pause {t.record.name}
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
  const [u, setU] = useState<UpdateInfo>();
  const [hidden, setHidden] = useState(false);
  const [job, setJob] = useState<UpdateJob>();
  const check = useCallback((manual: boolean) => {
    call<UpdateInfo>("update_check")
      .then((x) => {
        if (!x.newer) {
          if (manual) toast.success(`TorsGUI ${x.current} is the latest version`);
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
        <b>TorsGUI {u.latest}</b> is available <span className="muted">(you have {u.current})</span>
      </span>
      {job ? (
        job.phase === "download" ? (
          <span className="flex items-center gap-2 tnum" data-testid="update-progress">
            downloading {mb(job.done)} / {mb(job.total)} MB
            <span className="inline-block w-40">
              <ProgressBar value={job.done ?? 0} max={Math.max(1, job.total ?? 1)} />
            </span>
          </span>
        ) : job.phase === "install" ? (
          <span>installing… tournaments keep running</span>
        ) : job.phase === "failed" ? (
          <span className="l">
            {job.error}{" "}
            <a className="link" href={u.url} target="_blank" rel="noreferrer">
              release page
            </a>
          </span>
        ) : (
          <span className="w">{job.message}</span>
        )
      ) : (
        <>
          {u.asset ? (
            <button className="btn btn-sm btn-primary" onClick={install} title={`${u.asset.name} (${mb(u.asset.size)} MB) for this ${u.kind}`} data-testid="update-install">
              Update now
            </button>
          ) : null}
          <a className={`btn btn-sm ${u.asset ? "" : "btn-primary"}`} href={u.url} target="_blank" rel="noreferrer">
            {u.asset ? "What's new" : "Download"}
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
            Not now
          </button>
        </>
      )}
    </div>
  );
}

function Layout() {
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
                <span className="muted">{cur.group}</span>
              </>
            )}
            <span className="muted">/</span>
            <span className="font-medium truncate">{cur?.label ?? ""}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <button className="btn btn-sm shrink-0" onClick={() => setPalette(true)} title="Commands and search">
              <span className="muted">Commands</span>
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
