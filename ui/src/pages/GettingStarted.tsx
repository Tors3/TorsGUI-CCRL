import { Activity, CheckCircle2, ChevronRight, Circle, Crown, Download, FileCode2, Gauge, ListOrdered, PackagePlus, Play, Rocket, Save, Settings as SettingsIcon, Trophy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Settings } from "../bindings/Settings";
import type { SetupStatus } from "../bindings/SetupStatus";
import { HelpLink } from "../components/HelpLink";
import { ErrorBox, Field, PageHeader, Panel, ProgressBar, Spinner } from "../components/ui";
import { call, usePoll } from "../lib/api";

type StepDef = { id: string; title: string; why: string; help: string; body: (ctx: Ctx) => ReactNode };
type Ctx = { settings?: Settings; refresh: () => void; nav: (to: string) => void };

function TesterForm({ settings, refresh }: Ctx) {
  const [name, setName] = useState(settings?.tester_name ?? "");
  const [site, setSite] = useState(settings?.site ?? "");
  useEffect(() => {
    setName(settings?.tester_name ?? "");
    setSite(settings?.site ?? "");
  }, [settings?.tester_name, settings?.site]);
  const save = async () => {
    if (!settings) return;
    await call("settings_save", { settings: { ...settings, tester_name: name.trim(), site: site.trim() } });
    toast.success("Saved");
    refresh();
  };
  return (
    <div className="flex items-end gap-2">
      <Field label="Tester name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Francesco Torsello" data-testid="start-tester" />
      </Field>
      <Field label="Site (your location)">
        <input className="input" value={site} onChange={(e) => setSite(e.target.value)} placeholder="Milan" data-testid="start-site" />
      </Field>
      <button className="btn btn-primary" onClick={save} disabled={!name.trim() || !site.trim()} data-testid="start-save-tester">
        <Save size={13} /> Save
      </button>
    </div>
  );
}

function FastchessStep({ refresh }: Ctx) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(undefined);
            try {
              await call("fastchess_install");
              toast.success("fastchess installed");
              refresh();
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : <Download size={13} />} Download the pinned fastchess
        </button>
        <Link className="btn" to="/settings">
          <SettingsIcon size={13} /> or point to your own binary
        </Link>
      </div>
      <ErrorBox error={err} />
    </div>
  );
}

const go = (to: string, label: string, icon: ReactNode) => (ctx: Ctx) => (
  <button className="btn" onClick={() => ctx.nav(to)}>
    {icon} {label}
  </button>
);

const STEPS: StepDef[] = [
  { id: "tester", title: "Who you are", why: "Your name and location go into the CCRL file name and the PGN Site tag.", help: "new-machine", body: (c) => <TesterForm {...c} /> },
  { id: "fastchess", title: "Install fastchess", why: "fastchess plays the games: TorsGUI starts one fastchess process per game and places it on a NUMA node.", help: "new-machine", body: (c) => <FastchessStep {...c} /> },
  { id: "folders", title: "Folders and opening book", why: "Where engines are downloaded, where books and tablebases are, and the default book every tournament starts from.", help: "new-machine", body: go("/settings", "Open Settings → Paths", <SettingsIcon size={13} />) },
  { id: "bench", title: "Bench the machine", why: "The Stockfish 10 bench measures this machine against the CCRL reference and turns CCRL time controls into local ones (e.g. Blitz 2'+1\" → 103+1).", help: "bench-and-time-control", body: go("/bench", "Open Bench", <Gauge size={13} />) },
  { id: "engines", title: "Add engines", why: "Paste a GitHub repository: TorsGUI picks the CCRL build (AVX2), downloads, checks and verifies it. Two engines are enough to start.", help: "engines", body: go("/engines", "Open Engines → Add from GitHub", <PackagePlus size={13} />) },
  { id: "ccrl", title: "Import the CCRL list", why: "Ratings, the names CCRL uses, and opponent suggestions around your engine's level.", help: "ccrl-lists", body: go("/ccrl", "Open CCRL Lists", <ListOrdered size={13} />) },
  {
    id: "tournament",
    title: "Your first tournament",
    why: "The wizard computes games, openings, ETA and resources; or import a tournament file written by you or by Claude. Then follow it live and export it.",
    help: "create-a-gauntlet",
    body: (c) => (
      <div className="flex gap-2">
        <button className="btn btn-primary" onClick={() => c.nav("/tournaments/new")}>
          <Trophy size={13} /> New tournament
        </button>
        <button className="btn" onClick={() => c.nav("/tournaments")}>
          <FileCode2 size={13} /> Import a tournament file
        </button>
      </div>
    ),
  },
];

/** Guided setup: each step with its live status, why it matters and a button to do it. */
export function GettingStarted() {
  const nav = useNavigate();
  const { data: st, refresh } = usePoll<SetupStatus>("setup_status", {}, 5000);
  const { data: settings, refresh: refreshSettings } = usePoll<Settings>("settings_get", {}, 0);
  const [open, setOpen] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoErr, setDemoErr] = useState<string>();
  const [demoId, setDemoId] = useState<string | null>(null);
  const refreshAll = () => {
    refresh();
    refreshSettings();
  };
  const step = (id: string) => st?.steps.find((s) => s.id === id);
  // open the first step not done yet
  useEffect(() => {
    if (st && open === null) setOpen(st.steps.find((s) => !s.done)?.id ?? "tournament");
  }, [st, open]);
  const demo = async (variant: "standard" | "chess960") => {
    setDemoBusy(true);
    setDemoErr(undefined);
    try {
      const r = await call<{ id: string; started: boolean }>("demo_create", { variant });
      setDemoId(r.id);
      toast.success(r.started ? "Demo started: watch it in Live" : "Demo queued: it starts after the running tournament");
      refresh();
    } catch (e) {
      setDemoErr((e as Error).message);
    } finally {
      setDemoBusy(false);
    }
  };
  const lastDemo = demoId ?? st?.demos[st.demos.length - 1]?.[0] ?? null;
  const ctx: Ctx = { settings, refresh: refreshAll, nav };
  return (
    <div className="flex flex-col gap-3 fade-in max-w-[1100px]">
      <PageHeader title="Getting started" sub="Set up TorsGUI step by step, or watch a demo tournament first" help="getting-started" />
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Rocket size={14} /> Try the demo
          </span>
        }
      >
        <div className="flex flex-col gap-3 text-[12.5px]">
          <p className="text-[13px]">
            A small gauntlet played for real by the runner and fastchess with three <b>TorsGUI demo engines</b> (tiny built-in engines: legal but weak chess, a quarter of a second per move). In about three minutes you see how everything works: games on the live boards, the standings filling up, the game viewer and the CCRL export with its checklist. Nothing to download except fastchess.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn btn-primary" disabled={demoBusy || !st?.fastchess || !st?.demo_engine} onClick={() => demo("standard")} data-testid="demo-standard">
              {demoBusy ? <Spinner /> : <Play size={13} />} Start the demo
            </button>
            <button className="btn" disabled={demoBusy || !st?.fastchess || !st?.demo_engine} onClick={() => demo("chess960")} data-testid="demo-960">
              <Play size={13} /> Chess960 demo
            </button>
            {st && !st.fastchess && <span className="chip chip-warn">install fastchess first (step 2)</span>}
            {st && !st.demo_engine && <span className="chip chip-loss">the demo engine is not part of this build</span>}
          </div>
          <ErrorBox error={demoErr} />
          {lastDemo && (
            <div className="panel p-3 flex flex-col gap-2" style={{ background: "var(--bg-2)" }} data-testid="demo-tour">
              <div className="font-medium">What to look at while it plays</div>
              <ol className="flex flex-col gap-1.5">
                {[
                  { to: "/live", icon: <Activity size={13} />, t: "Live", d: "a board per lane, ticking clocks, the engines' evaluations and best moves" },
                  { to: `/tournaments/${encodeURIComponent(lastDemo)}`, icon: <Trophy size={13} />, t: "The tournament", d: "standings, lanes and NUMA placement, games, terminations; pause and resume" },
                  { to: "/games", icon: <Crown size={13} />, t: "Games", d: "replay any game: evaluation bar, material, clocks, autoplay" },
                  { to: `/export?id=${encodeURIComponent(lastDemo)}`, icon: <Download size={13} />, t: "Export", d: "the CCRL checklist (the demo breaks a few rules on purpose), the CCRL file and the forum post" },
                ].map((x, i) => (
                  <li key={x.to} className="flex items-center gap-2">
                    <span className="chip">{i + 1}</span>
                    <Link className="btn btn-sm" to={x.to}>
                      {x.icon} {x.t}
                    </Link>
                    <span className="muted">{x.d}</span>
                  </li>
                ))}
              </ol>
              <div className="muted text-[11.5px]">Close TorsGUI while the demo plays and open it again: the tournament keeps running in its own process. Delete the demo from Tournaments when you are done.</div>
            </div>
          )}
        </div>
      </Panel>
      <Panel
        title={
          <span className="flex items-center gap-3">
            Set up this machine
            {st && (
              <span className="flex items-center gap-2 text-[12px] muted font-normal" data-testid="setup-progress">
                {st.done}/{st.total} done
                <span className="inline-block w-[120px]">
                  <ProgressBar value={st.done} max={st.total} tone={st.done === st.total ? "win" : "accent"} />
                </span>
              </span>
            )}
          </span>
        }
        noPad
      >
        {!st ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : (
          <ol>
            {STEPS.map((s, i) => {
              const state = step(s.id);
              const isOpen = open === s.id;
              return (
                <li key={s.id} style={{ borderTop: i ? "1px solid var(--border)" : undefined }} data-testid={`step-${s.id}`} data-done={state?.done ? "yes" : "no"}>
                  <button className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--hover)]" onClick={() => setOpen(isOpen ? "" : s.id)}>
                    {state?.done ? <CheckCircle2 size={17} style={{ color: "var(--win)" }} /> : <Circle size={17} className="muted" />}
                    <span className="font-medium w-[190px]">
                      {i + 1}. {s.title}
                    </span>
                    <span className="muted text-[12.5px] flex-1 truncate">{state?.detail}</span>
                    <ChevronRight size={15} className="muted transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : undefined }} />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pl-[46px] flex flex-col gap-2.5 fade-in">
                      <p className="text-[12.5px] text-[var(--text-2)] max-w-[760px]">{s.why}</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        {s.body(ctx)}
                        <HelpLink section={s.help} label="Read more" />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </div>
  );
}
