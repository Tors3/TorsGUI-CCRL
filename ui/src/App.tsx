import * as Tooltip from "@radix-ui/react-tooltip";
import { Command } from "cmdk";
import {
  Activity,
  BarChart3,
  CircleHelp,
  Crown,
  Rocket,
  Cpu,
  Download,
  Gauge,
  LayoutDashboard,
  ListOrdered,
  Moon,
  Pause,
  Play,
  Plus,
  ScrollText,
  Settings as SettingsIcon,
  Sun,
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
import { call, usePoll } from "./lib/api";
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

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, key: "d" },
  { to: "/tournaments", label: "Tournaments", icon: Trophy, key: "t" },
  { to: "/live", label: "Live", icon: Activity, key: "l" },
  { to: "/games", label: "Games", icon: Crown, key: "a" },
  { to: "/engines", label: "Engines", icon: Cpu, key: "e" },
  { to: "/ccrl", label: "CCRL Lists", icon: ListOrdered, key: "c" },
  { to: "/bench", label: "Bench", icon: Gauge, key: "b" },
  { to: "/export", label: "Export", icon: Download, key: "x" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, key: "s" },
  { to: "/logs", label: "Logs", icon: ScrollText, key: "o" },
  { to: "/start", label: "Getting started", icon: Rocket, key: "r" },
  { to: "/help", label: "Help", icon: CircleHelp, key: "h" },
];

function useTheme() {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem("torsgui-theme") || "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("torsgui-theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
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
                <Sun size={15} /> Toggle light / dark theme <span className="ml-auto kbd">t</span>
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

function Layout() {
  const { theme, toggle } = useTheme();
  const [palette, setPalette] = useState(false);
  const loc = useLocation();
  useEventToasts();
  const title = useMemo(() => NAV.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to)))?.label ?? "", [loc.pathname]);
  return (
    <div className="flex h-full">
      <aside className="w-[196px] shrink-0 flex flex-col gap-0.5 p-2.5" style={{ background: "var(--bg-2)", borderRight: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 px-2 pt-1 pb-3">
          <img src="icon.svg" alt="" width={22} height={22} />
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">TorsGUI</div>
            <div className="text-[10.5px] muted">for CCRL testers</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
              <n.icon size={16} />
              <span className="flex-1">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1.5 px-1 pt-3">
          <button className="btn btn-sm justify-between" onClick={() => setPalette(true)}>
            <span className="muted">Commands</span>
            <span className="kbd">Ctrl K</span>
          </button>
          <button className="btn btn-sm" onClick={toggle} aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />} {theme === "dark" ? "Light" : "Dark"} theme
          </button>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-[42px] shrink-0 flex items-center justify-between px-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 text-[12.5px]">
            <BarChart3 size={14} className="muted" />
            <span className="muted">TorsGUI</span>
            <span className="muted">/</span>
            <span className="font-medium">{title}</span>
          </div>
          <StatusPill />
        </header>
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
      <Palette open={palette} setOpen={setPalette} toggleTheme={toggle} />
      <Shortcuts setPalette={setPalette} toggleTheme={toggle} />
      <Toaster theme={theme as "dark" | "light"} position="bottom-right" richColors closeButton />
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
