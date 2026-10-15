import { ArrowDown, ArrowUp, CheckCircle2, Cpu, HardDrive, Play, Plus, Rocket, Server, Trophy, X } from "lucide-react";
import type { SetupStatus } from "../bindings/SetupStatus";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Health } from "../bindings/Health";
import type { TimelineItem } from "../bindings/TimelineItem";
import type { TournamentSummary } from "../bindings/TournamentSummary";
import { TournamentActions } from "../components/TournamentActions";
import { Empty, ErrorBox, Kpi, PageHeader, PageTabs, Panel, ProgressBar, StateChip, useTabParam } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { ago, duration, num, pct, shortTime } from "../lib/format";
import type { DashboardData } from "../lib/types";
import { dateLocale, useT } from "../i18n";

function RunningCard({ t, refresh }: { t: TournamentSummary; refresh: () => void }) {
  const r = t.record;
  const p = t.progress;
  const tr = useT();
  return (
    <div className="panel p-3 flex flex-col gap-2" data-testid="running-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/tournaments/${encodeURIComponent(r.id)}`} className="font-semibold hover:underline truncate block">
            {r.name}
          </Link>
          <div className="muted text-[12px] truncate">
            {tr("dashboard.card.line", { event: r.config.event, tc: r.config.tc, threads: r.config.threads, hash: r.config.hash_mb, lanes: p.lanes })}
          </div>
        </div>
        <StateChip state={r.state} alive={t.runner_alive} />
      </div>
      <ProgressBar value={p.done} max={p.expected} tone="win" />
      <div className="grid grid-cols-5 gap-2 text-[12px] tnum">
        <div>
          <div className="kpi-label">{tr("dashboard.card.games")}</div>
          <div className="font-semibold">
            {p.done}
            <span className="muted">/{p.expected}</span>
          </div>
        </div>
        <div>
          <div className="kpi-label">{tr("dashboard.card.seed")}</div>
          <div className="font-semibold truncate">{t.score_line ?? "—"}</div>
        </div>
        <div>
          <div className="kpi-label">{tr("dashboard.card.rate")}</div>
          <div className="font-semibold">{num(p.rate_per_hour, 1)}</div>
        </div>
        <div>
          <div className="kpi-label">{tr("dashboard.card.avg")}</div>
          <div className="font-semibold">{duration(p.avg_game_s)}</div>
        </div>
        <div>
          <div className="kpi-label">{tr("dashboard.card.eta")}</div>
          <div className="font-semibold">{duration(p.eta_s)}</div>
          <div className="muted text-[11px]">{p.eta_at ?? ""}</div>
        </div>
      </div>
      <div className="flex justify-end">
        <TournamentActions t={t} onDone={refresh} compact />
      </div>
    </div>
  );
}

function HealthPanel({ h }: { h: Health }) {
  const row = (icon: React.ReactNode, label: string, value: React.ReactNode, bad = false) => (
    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
      <span className="flex items-center gap-2 text-2">
        {icon}
        {label}
      </span>
      <span className="tnum font-medium" style={{ color: bad ? "var(--loss)" : undefined }}>
        {value}
      </span>
    </div>
  );
  const ramPct = h.total_ram_mb ? (100 * h.free_ram_mb) / h.total_ram_mb : 0;
  const tr = useT();
  return (
    <Panel title={tr("dashboard.health.title")} actions={h.anomalies.length === 0 ? <span className="chip chip-win">{tr("dashboard.health.allGood")}</span> : <span className="chip chip-loss">{tr("dashboard.health.alerts", { count: h.anomalies.length })}</span>}>
      {row(<Server size={14} />, tr("dashboard.health.runners"), `${h.runners_alive} / ${h.runners_expected}`, h.runners_alive < h.runners_expected)}
      {row(<Cpu size={14} />, tr("dashboard.health.fastchess"), h.fastchess_processes)}
      {row(<Trophy size={14} />, tr("dashboard.health.engines"), h.engine_processes)}
      {row(<HardDrive size={14} />, tr("dashboard.health.ram"), `${(h.free_ram_mb / 1024).toFixed(1)} / ${(h.total_ram_mb / 1024).toFixed(0)} GB (${pct(ramPct, 0)})`, ramPct < 10)}
      {row(<Cpu size={14} />, tr("dashboard.health.cpu"), pct(h.cpu_load_pct, 0))}
      {row(<X size={14} />, tr("dashboard.health.crashes"), h.engine_crashes_24h, h.engine_crashes_24h > 0)}
      {row(<X size={14} />, tr("dashboard.health.forfeits"), h.time_forfeits_24h, h.time_forfeits_24h > 0)}
      <div className="flex flex-col gap-1.5 mt-2">
        {h.anomalies.map((a, i) => (
          <div key={i} className={`rounded-md px-2 py-1.5 text-[12px]`} style={{ background: a.level === "error" ? "var(--loss-bg)" : "var(--warn-bg)", color: a.level === "error" ? "var(--loss)" : "var(--warn)" }} data-testid="anomaly">
            {a.message}
          </div>
        ))}
        {h.anomalies.length === 0 && (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--win)" }}>
            <CheckCircle2 size={14} /> {tr("dashboard.health.none")}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Timeline({ items }: { items: TimelineItem[] }) {
  const tr = useT();
  if (!items.length) return <Empty>{tr("dashboard.timeline.empty")}</Empty>;
  const parse = (s: string) => Date.parse(s.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  const now = Date.now();
  const starts = items.map((i) => Math.min(parse(i.start) || now, now));
  const ends = items.map((i) => parse(i.end) || now);
  const t0 = Math.min(...starts);
  const t1 = Math.max(...ends, now + 3600e3);
  const x = (t: number) => `${(100 * (t - t0)) / (t1 - t0)}%`;
  const ticks = 6;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-4 text-[10.5px] muted">
        {Array.from({ length: ticks + 1 }, (_, k) => {
          const t = t0 + ((t1 - t0) * k) / ticks;
          return (
            <span key={k} className="absolute tnum whitespace-nowrap" style={{ left: x(t), transform: `translateX(${k === 0 ? "0" : k === ticks ? "-100%" : "-50%"})` }}>
              {new Date(t).toLocaleString(dateLocale(), { weekday: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          );
        })}
      </div>
      {items.map((it, i) => (
        <div key={it.id} className="relative h-6 rounded" style={{ background: "var(--bg-2)" }}>
          <div
            className="absolute top-0 h-6 rounded flex items-center px-2 text-[11.5px] font-medium truncate"
            style={{ left: x(starts[i]), width: `max(4px, calc(${x(ends[i])} - ${x(starts[i])}))`, background: it.state === "running" ? "var(--win-bg)" : "var(--accent-bg)", border: `1px solid ${it.state === "running" ? "var(--win)" : "var(--accent)"}`, color: "var(--text)" }}
            title={tr("dashboard.timeline.tip", { name: it.name, start: shortTime(it.start), end: shortTime(it.end) })}
          >
            {it.name}
          </div>
        </div>
      ))}
      <div className="absolute" />
    </div>
  );
}

export function Dashboard() {
  const { data, error, refresh } = usePoll<DashboardData>("dashboard", {}, 3000);
  const nav = useNavigate();
  const tr = useT();
  const [tab, setTab] = useTabParam(["now", "queue", "history"] as const, "now");
  const ts = data?.tournaments ?? [];
  const running = ts.filter((t) => t.record.state === "running");
  const queued = ts.filter((t) => t.record.state === "queued").sort((a, b) => (a.record.queue_pos ?? 0) - (b.record.queue_pos ?? 0));
  const recent = ts.filter((t) => ["completed", "incomplete", "paused", "stopped"].includes(t.record.state)).slice(0, 15);
  const rate = running.reduce((s, t) => s + (t.progress.rate_per_hour ?? 0), 0);
  const move = async (id: string, delta: number) => {
    await call("queue_move", { id, delta });
    refresh();
  };
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader help="run-it"
        title={tr("dashboard.title")}
        sub={data ? tr("dashboard.sub", { running: running.length, queued: queued.length, total: ts.length }) : tr("app.common.loading")}
        actions={
          <>
            <button className="btn" onClick={() => call("queue_start").then(() => { toast.success(tr("app.palette.queueStarted")); refresh(); }).catch((e) => toast.error(e.message))} disabled={!queued.length || running.length > 0}>
              <Play size={13} /> {tr("dashboard.startQueue")}
            </button>
            <button className="btn btn-primary" onClick={() => nav("/tournaments/new")}>
              <Plus size={14} /> {tr("dashboard.newTournament")}
            </button>
          </>
        }
      />
      <SetupBanner />
      <ErrorBox error={error} />
      <div className="grid gap-3 kpi-grid">
        <Kpi label={tr("dashboard.kpi.running")} value={running.length} sub={tr("dashboard.kpi.lanes", { count: running.reduce((s, t) => s + t.progress.lanes, 0) })} tone={running.length ? "win" : undefined} />
        <Kpi label={tr("dashboard.kpi.queued")} value={queued.length} sub={queued[0] ? tr("dashboard.kpi.next", { name: queued[0].record.name }) : tr("dashboard.kpi.queueEmpty")} />
        <Kpi label={tr("dashboard.kpi.rate")} value={num(rate, 1)} sub={tr("dashboard.kpi.rateSub")} />
        <Kpi label={tr("dashboard.kpi.eta")} value={duration(running[0]?.progress.eta_s)} sub={running[0]?.progress.eta_at ?? "—"} />
        <Kpi label={tr("dashboard.kpi.queueEta")} value={data?.queue_eta ? data.queue_eta.slice(5) : "—"} sub={tr("dashboard.kpi.queueEtaSub")} tone="accent" />
        <Kpi label={tr("dashboard.kpi.alerts")} value={data?.health.anomalies.length ?? 0} tone={(data?.health.anomalies.length ?? 0) > 0 ? "loss" : "win"} sub={data ? tr("dashboard.kpi.alive", { alive: data.health.runners_alive, expected: data.health.runners_expected }) : ""} />
      </div>
      <PageTabs
        tabs={[
          { id: "now", label: tr("dashboard.tabs.now"), badge: running.length || undefined },
          { id: "queue", label: tr("dashboard.tabs.queue"), badge: queued.length || undefined },
          { id: "history", label: tr("dashboard.tabs.history") },
        ]}
        value={tab}
        onChange={setTab}
        testid="dash-tab"
      />
      {tab === "now" && (
        <div className="grid gap-3 cols-main-wide-side">
          <div className="flex flex-col gap-3 min-w-0">
          <Panel title={tr("dashboard.running")} noPad bodyClass="p-3 flex flex-col gap-3">
            {running.length ? running.map((t) => <RunningCard key={t.record.id} t={t} refresh={refresh} />) : <Empty>{tr("dashboard.noneRunning")}</Empty>}
          </Panel>
          </div>
          <div className="flex flex-col gap-3 min-w-0">
          {data && <HealthPanel h={data.health} />}
          </div>
        </div>
      )}
      {tab === "queue" && (
        <div className="flex flex-col gap-3">
            <Panel title={tr("dashboard.queue")} noPad>
              {queued.length === 0 ? (
                <Empty>{tr("dashboard.queueEmpty")}</Empty>
              ) : (
                <table className="tbl">
                  <tbody>
                    {queued.map((t, i) => (
                      <tr key={t.record.id}>
                        <td className="muted w-6 tnum">{i + 1}</td>
                        <td className="truncate max-w-[220px]">
                          <Link to={`/tournaments/${encodeURIComponent(t.record.id)}`} className="hover:underline">
                            {t.record.name}
                          </Link>
                        </td>
                        <td className="r tnum muted">{tr("dashboard.gamesShort", { count: t.record.expected_games })}</td>
                        <td className="r tnum muted">{duration(t.progress.eta_s)}</td>
                        <td className="r">
                          <button className="btn btn-ghost btn-icon btn-sm" aria-label={tr("dashboard.up")} onClick={() => move(t.record.id, -1)} disabled={i === 0}>
                            <ArrowUp size={13} />
                          </button>
                          <button className="btn btn-ghost btn-icon btn-sm" aria-label={tr("dashboard.down")} onClick={() => move(t.record.id, 1)} disabled={i === queued.length - 1}>
                            <ArrowDown size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          <Panel title={tr("dashboard.timelineTitle")}>
            <Timeline items={data?.timeline ?? []} />
          </Panel>
        </div>
      )}
      {tab === "history" && (
        <div className="grid gap-3 cols-fit">
            <Panel title={tr("dashboard.recent")} noPad>
              <table className="tbl">
                <tbody>
                  {recent.map((t) => (
                    <tr key={t.record.id} className="clickable" onClick={() => nav(`/tournaments/${encodeURIComponent(t.record.id)}`)}>
                      <td className="truncate max-w-[200px]">{t.record.name}</td>
                      <td>
                        <StateChip state={t.record.state} />
                      </td>
                      <td className="r tnum">
                        {t.record.done_games}/{t.record.expected_games}
                      </td>
                    </tr>
                  ))}
                  {recent.length === 0 && (
                    <tr>
                      <td className="muted">{tr("dashboard.noRecent")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Panel>
          <Panel title={tr("dashboard.events")} actions={<Link to="/logs" className="text-[12px] muted hover:underline">{tr("dashboard.all")}</Link>} noPad>
            <div className="flex flex-col">
              {(data?.events ?? []).map((e) => (
                <div key={e.seq} className="px-3 py-1.5 text-[12px] flex gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
                  <span className="dot mt-1.5 shrink-0" style={{ color: e.level === "error" ? "var(--loss)" : e.level === "warn" ? "var(--warn)" : e.level === "success" ? "var(--win)" : "var(--muted)" }} />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate" title={e.message}>
                      {e.message}
                    </span>
                    <span className="muted text-[11px]">{ago(e.ts)}</span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

/** Shown until the setup is complete: a way into Getting started and the demo. */
function SetupBanner() {
  const { data } = usePoll<SetupStatus>("setup_status", {}, 15000);
  const tr = useT();
  if (!data || data.done === data.total) return null;
  return (
    <div className="panel px-4 py-3 flex items-center gap-4" style={{ borderColor: "var(--accent)", background: "var(--accent-bg)" }} data-testid="setup-banner">
      <Rocket size={20} style={{ color: "var(--accent-2)" }} />
      <div className="flex-1 min-w-0">
        <div className="font-medium">{tr("dashboard.setup.title")}</div>
        <div className="muted text-[12.5px]">
          {tr("dashboard.setup.text", { done: data.done, total: data.total })}
        </div>
      </div>
      <Link className="btn btn-primary" to="/start">
        {tr("dashboard.setup.go")}
      </Link>
    </div>
  );
}
