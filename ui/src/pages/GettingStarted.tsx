import { Activity, CheckCircle2, ChevronRight, Circle, Crown, Download, FileCode2, Gauge, ListOrdered, PackagePlus, Play, Rocket, Save, Settings as SettingsIcon, Trophy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Settings } from "../bindings/Settings";
import type { SetupStatus } from "../bindings/SetupStatus";
import { HelpLink } from "../components/HelpLink";
import { InstallBooksButton } from "../components/OpeningBooks";
import { ErrorBox, Field, PageHeader, Panel, ProgressBar, Spinner } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { t, useT, type Key } from "../i18n";

type StepDef = { id: string; help: string; body: (ctx: Ctx) => ReactNode };
type Ctx = { settings?: Settings; refresh: () => void; nav: (to: string) => void; bundled: string[]; books: number };

function BundledButton({ refresh, bundled, kind }: Ctx & { kind: "engines" | "bench" }) {
  const [busy, setBusy] = useState(false);
  const engines = bundled.filter((b) => kind === "engines" || b.startsWith("Stockfish"));
  if (!engines.length) return null;
  return (
    <button
      className="btn btn-primary"
      disabled={busy}
      data-testid={`bundled-${kind}`}
      onClick={async () => {
        setBusy(true);
        try {
          if (kind === "bench") {
            await call("bench_prepare");
            toast.success(t("start.sfReady"));
          } else {
            const r = await call<{ added: string[] }>("bundled_install");
            toast.success(r.added.length ? t("start.added", { names: r.added.join(", ") }) : t("start.already"));
          }
          refresh();
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner /> : <PackagePlus size={13} />} {kind === "bench" ? t("start.useSf") : t("start.addBundled", { names: engines.join(", ") })}
    </button>
  );
}

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
    toast.success(t("start.saved"));
    refresh();
  };
  return (
    <div className="flex items-end gap-2">
      <Field label={t("start.tester")}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Francesco Torsello" data-testid="start-tester" />
      </Field>
      <Field label={t("start.site")}>
        <input className="input" value={site} onChange={(e) => setSite(e.target.value)} placeholder="Milan" data-testid="start-site" />
      </Field>
      <button className="btn btn-primary" onClick={save} disabled={!name.trim() || !site.trim()} data-testid="start-save-tester">
        <Save size={13} /> {t("start.save")}
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
              toast.success(t("start.fcInstalled"));
              refresh();
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : <Download size={13} />} {t("start.fcDownload")}
        </button>
        <Link className="btn" to="/settings">
          <SettingsIcon size={13} /> {t("start.fcOwn")}
        </Link>
      </div>
      <ErrorBox error={err} />
    </div>
  );
}

const go = (to: string, label: Key, icon: ReactNode) => (ctx: Ctx) => (
  <button className="btn" onClick={() => ctx.nav(to)}>
    {icon} {t(label)}
  </button>
);

const STEPS: StepDef[] = [
  { id: "tester", help: "new-machine", body: (c) => <TesterForm {...c} /> },
  { id: "fastchess", help: "new-machine", body: (c) => <FastchessStep {...c} /> },
  {
    id: "folders",
    help: "new-machine",
    body: (c) => (
      <div className="flex gap-2">
        {c.books > 0 && <InstallBooksButton onDone={c.refresh} label={t("start.installBooks", { count: c.books })} />}
        {go("/settings", "start.openPaths", <SettingsIcon size={13} />)(c)}
      </div>
    ),
  },
  {
    id: "bench",
    help: "bench-and-time-control",
    body: (c) => (
      <div className="flex gap-2">
        <BundledButton {...c} kind="bench" />
        {go("/bench", "start.openBench", <Gauge size={13} />)(c)}
      </div>
    ),
  },
  {
    id: "engines",
    help: "engines",
    body: (c) => (
      <div className="flex gap-2">
        <BundledButton {...c} kind="engines" />
        {go("/engines", "start.openEngines", <PackagePlus size={13} />)(c)}
      </div>
    ),
  },
  { id: "ccrl", help: "ccrl-lists", body: go("/ccrl", "start.openCcrl", <ListOrdered size={13} />) },
  {
    id: "tournament",
    help: "create-a-gauntlet",
    body: (c) => (
      <div className="flex gap-2">
        <button className="btn btn-primary" onClick={() => c.nav("/tournaments/new")}>
          <Trophy size={13} /> {t("start.newTournament")}
        </button>
        <button className="btn" onClick={() => c.nav("/tournaments")}>
          <FileCode2 size={13} /> {t("start.importFile")}
        </button>
      </div>
    ),
  },
];

/** Guided setup: each step with its live status, why it matters and a button to do it. */
export function GettingStarted() {
  const nav = useNavigate();
  const tr = useT();
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
      toast.success(r.started ? tr("start.demoStarted") : tr("start.demoQueued"));
      refresh();
    } catch (e) {
      setDemoErr((e as Error).message);
    } finally {
      setDemoBusy(false);
    }
  };
  const lastDemo = demoId ?? st?.demos[st.demos.length - 1]?.[0] ?? null;
  const ctx: Ctx = { settings, refresh: refreshAll, nav, bundled: st?.bundled ?? [], books: st?.bundled_books ?? 0 };
  return (
    <div className="flex flex-col gap-3 fade-in max-w-[1100px]">
      <PageHeader title={tr("start.title")} sub={tr("start.sub")} help="getting-started" />
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Rocket size={14} /> {tr("start.tryDemo")}
          </span>
        }
      >
        <div className="flex flex-col gap-3 text-[12.5px]">
          <p className="text-[13px]">
            {tr("start.demoAbout1")}<b>{tr("start.demoAbout2")}</b>{tr("start.demoAbout3")}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn btn-primary" disabled={demoBusy || !st?.fastchess || !st?.demo_engine} onClick={() => demo("standard")} data-testid="demo-standard">
              {demoBusy ? <Spinner /> : <Play size={13} />} {tr("start.startDemo")}
            </button>
            <button className="btn" disabled={demoBusy || !st?.fastchess || !st?.demo_engine} onClick={() => demo("chess960")} data-testid="demo-960">
              <Play size={13} /> {tr("start.demo960")}
            </button>
            {st && !st.fastchess && <span className="chip chip-warn">{tr("start.needFc")}</span>}
            {st && !st.demo_engine && <span className="chip chip-loss">{tr("start.noDemo")}</span>}
          </div>
          <ErrorBox error={demoErr} />
          {lastDemo && (
            <div className="panel p-3 flex flex-col gap-2" style={{ background: "var(--bg-2)" }} data-testid="demo-tour">
              <div className="font-medium">{tr("start.lookAt")}</div>
              <ol className="flex flex-col gap-1.5">
                {[
                  { to: "/live", icon: <Activity size={13} />, t: tr("start.tour.live.t"), d: tr("start.tour.live.d") },
                  { to: `/tournaments/${encodeURIComponent(lastDemo)}`, icon: <Trophy size={13} />, t: tr("start.tour.tournament.t"), d: tr("start.tour.tournament.d") },
                  { to: "/games", icon: <Crown size={13} />, t: tr("start.tour.games.t"), d: tr("start.tour.games.d") },
                  { to: `/export?id=${encodeURIComponent(lastDemo)}`, icon: <Download size={13} />, t: tr("start.tour.export.t"), d: tr("start.tour.export.d") },
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
              <div className="muted text-[11.5px]">{tr("start.closeAbout")}</div>
            </div>
          )}
        </div>
      </Panel>
      <Panel
        title={
          <span className="flex items-center gap-3">
            {tr("start.setup")}
            {st && (
              <span className="flex items-center gap-2 text-[12px] muted font-normal" data-testid="setup-progress">
                {tr("start.done", { done: st.done, total: st.total })}
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
                      {i + 1}. {tr(`start.steps.${s.id}.title` as Key)}
                    </span>
                    <span className="muted text-[12.5px] flex-1 truncate">{state?.detail}</span>
                    <ChevronRight size={15} className="muted transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : undefined }} />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pl-[46px] flex flex-col gap-2.5 fade-in">
                      <p className="text-[12.5px] text-[var(--text-2)] max-w-[760px]">{tr(`start.steps.${s.id}.why` as Key)}</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        {s.body(ctx)}
                        <HelpLink section={s.help} label={tr("start.readMore")} />
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
