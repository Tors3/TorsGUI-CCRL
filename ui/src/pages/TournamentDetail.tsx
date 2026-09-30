import * as Tabs from "@radix-ui/react-tabs";
import { ArrowDownUp, Download, MessageSquareText } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { GameRow } from "../bindings/GameRow";
import type { RenameReport } from "../bindings/RenameReport";
import type { RowOrder } from "../bindings/RowOrder";
import type { TournamentDetail } from "../bindings/TournamentDetail";
import { GameViewer, type GameRef } from "../components/GameViewer";
import { GamesTable } from "../components/GamesTable";
import { ExportTournamentFile } from "../components/TournamentFileDialog";
import { TournamentActions } from "../components/TournamentActions";
import { Empty, ErrorBox, Field, Kpi, PageHeader, Panel, ProgressBar, Result, Seg, StateChip, Tip, Warn, Wdl, WdlBar } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { duration, num, pct, shortTime, signed } from "../lib/format";

function Standings({ d, order, setOrder }: { d: TournamentDetail; order: RowOrder; setOrder: (o: RowOrder) => void }) {
  const st = d.standings;
  const perGame = d.summary.record.config.games_per_pairing;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 300px" }}>
      <Panel
        title={`Per opponent — ${st.seed}`}
        noPad
        actions={<Seg value={order} onChange={setOrder} options={[{ value: "rating", label: "List rating" }, { value: "score", label: "Score" }, { value: "config", label: "Config" }]} />}
      >
        <div className="overflow-auto">
          <table className="tbl" data-testid="standings">
            <thead>
              <tr>
                <th className="r">#</th>
                <th>Opponent</th>
                <th className="r">Rating</th>
                <th className="r">Games</th>
                <th className="r">W/B</th>
                <th>Result</th>
                <th className="r">Score</th>
                <th className="r">%</th>
                <th className="r">Elo ±95%</th>
                <th className="r">Perf</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {st.rows.map((r, i) => {
                const unbalanced = r.white_games !== r.black_games;
                return (
                  <tr key={r.name}>
                    <td className="r muted">{i + 1}</td>
                    <td className="font-medium">{r.name}</td>
                    <td className="r">
                      {r.rating != null ? (
                        <span title={r.rating_estimated ? "estimated from the 1CPU rating + gap" : "list rating"}>
                          {num(r.rating)}
                          {r.rating_estimated && <span className="chip chip-warn ml-1">est.</span>}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="r">
                      {r.games}
                      {r.games < perGame && d.summary.record.state !== "completed" && <span className="muted">/{perGame}</span>}
                    </td>
                    <td className="r" style={{ color: unbalanced ? "var(--warn)" : undefined }} title={unbalanced ? "colour pair incomplete" : "seed games with White / Black"}>
                      {r.white_games}/{r.black_games}
                    </td>
                    <td>
                      <Wdl w={r.wins} d={r.draws} l={r.losses} />
                    </td>
                    <td className="r">
                      {r.score.toFixed(1)}/{r.games}
                    </td>
                    <td className="r">{pct(r.pct)}</td>
                    <td className="r">{r.elo != null ? `${signed(r.elo)} ± ${r.elo_err != null ? r.elo_err.toFixed(0) : "∞"}` : "—"}</td>
                    <td className="r">{r.performance != null ? num(r.performance) : "—"}</td>
                    <td>
                      <WdlBar w={r.wins} d={r.draws} l={r.losses} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>TOTAL</td>
                <td className="r">{st.avg_opponent_rating != null ? num(st.avg_opponent_rating) : ""}</td>
                <td className="r">{st.total.games}</td>
                <td className="r">
                  {st.total.white_games}/{st.total.black_games}
                </td>
                <td>
                  <Wdl w={st.total.wins} d={st.total.draws} l={st.total.losses} />
                </td>
                <td className="r">
                  {st.total.score.toFixed(1)}/{st.total.games}
                </td>
                <td className="r">{pct(st.total.pct)}</td>
                <td className="r">{st.total.elo != null ? `${signed(st.total.elo)} ± ${st.total.elo_err?.toFixed(0) ?? "∞"}` : "—"}</td>
                <td className="r">{st.performance != null ? num(st.performance) : "—"}</td>
                <td>
                  <WdlBar w={st.total.wins} d={st.total.draws} l={st.total.losses} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>
      <div className="flex flex-col gap-3">
        <Panel title="By colour of the seed">
          {[st.white, st.black].map((r) => (
            <div key={r.name} className="flex items-center justify-between py-1 tnum">
              <span className="capitalize w-14">{r.name}</span>
              <Wdl w={r.wins} d={r.draws} l={r.losses} />
              <span>{pct(r.pct)}</span>
            </div>
          ))}
        </Panel>
        <Panel
          title="Rating (logistic MLE)"
          actions={
            <Tip content={`Ratings of the participants from the imported CCRL ${d.summary.record.config.ccrl_list || "Blitz"} list (${d.summary.record.config.threads}CPU; 1CPU + gap when missing)`}>
              <button
                className="btn btn-sm"
                onClick={() =>
                  call<{ found: number; total: number }>("tournament_refresh_ratings", { id: d.summary.record.id })
                    .then((r) => toast.success(`${r.found}/${r.total} ratings found`))
                    .catch((e) => toast.error(e.message))
                }
              >
                Update ratings
              </button>
            </Tip>
          }
        >
          {st.elo.length ? (
            st.elo.map((e) => (
              <div key={e.name} className="py-1">
                <div className="flex justify-between">
                  <span className="font-medium">{e.name}</span>
                  <span className="tnum font-semibold">{num(e.elo)}</span>
                </div>
                <div className="muted text-[11.5px] tnum">
                  95% CI {num(e.lo)} – {num(e.hi)} · {e.games} games · {e.method}
                </div>
              </div>
            ))
          ) : (
            <div className="muted text-[12px]">Anchor ratings are missing: import a CCRL list (CCRL Lists) and set the opponents' ratings to get a performance and an MLE rating.</div>
          )}
        </Panel>
        <Panel title="Terminations">
          {Object.entries(st.termination_totals).map(([k, v]) => (
            <div key={k} className="flex justify-between py-0.5 tnum">
              <span className={k === "normal" || k === "adjudication" ? "" : "l"}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
          <div className="flex justify-between py-0.5 tnum muted">
            <span>duplicates dropped</span>
            <span>{st.duplicates}</span>
          </div>
        </Panel>
        <Panel title="Colour pairs">
          {st.incomplete_pairs.length === 0 && d.open_pairs.length === 0 ? (
            <div style={{ color: "var(--win)" }}>Every opening played with both colours.</div>
          ) : (
            <div className="flex flex-col gap-1 text-[12px]">
              <Warn>{d.open_pairs.length} opening(s) played with only one colour so far</Warn>
              {d.open_pairs.slice(0, 8).map((p, i) => (
                <div key={i} className="mono muted">
                  n{p.node} p{p.pass} r{p.round}: {p.white} – {p.black}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Lanes({ d }: { d: TournamentDetail }) {
  if (!d.lanes.length) return <Empty>No runner session yet: lanes appear when the tournament runs.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      {d.warnings.map((w, i) => (
        <Warn key={i}>{w}</Warn>
      ))}
      <Panel noPad>
        <table className="tbl">
          <thead>
            <tr>
              <th>Node</th>
              <th>Lane</th>
              <th>State</th>
              <th>Game</th>
              <th className="r">Opening</th>
              <th className="r">Elapsed</th>
              <th>Planned CPUs</th>
              <th>Placement check</th>
              <th className="r">Played</th>
              <th className="r">Failures</th>
            </tr>
          </thead>
          <tbody>
            {d.lanes.map((l) => (
              <tr key={`${l.partition}-${l.lane}`}>
                <td>{l.node}</td>
                <td>{l.lane}</td>
                <td>{l.busy ? <span className="chip chip-win"><span className="dot dot-pulse" />playing</span> : <span className="chip">idle</span>}</td>
                <td>{l.job ? `${l.job.white} – ${l.job.black} (p${l.job.pass} r${l.job.round})` : "—"}</td>
                <td className="r">{l.job?.opening ?? "—"}</td>
                <td className="r">{l.started_at && l.busy ? duration(Date.now() / 1000 - l.started_at) : "—"}</td>
                <td className="mono">{l.cpuset ?? "no placement"}</td>
                <td className="mono">{l.placement ? <span style={{ color: l.placement.ok ? "var(--win)" : "var(--loss)" }}>{l.placement.detail}</span> : "—"}</td>
                <td className="r">{l.games_played}</td>
                <td className="r" style={{ color: l.failures ? "var(--loss)" : undefined }}>
                  {l.failures}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Games({ id, onOpen }: { id: string; onOpen: (g: GameRef) => void }) {
  const { data, error } = usePoll<GameRow[]>("games_list", { id }, 10000);
  return <GamesTable rows={data} error={error} onOpen={onOpen} />;
}

function Decisive({ d, onOpen }: { d: TournamentDetail; onOpen: (g: GameRef) => void }) {
  const rows = d.standings.decisive;
  if (!rows.length) return <Empty>No decisive game yet.</Empty>;
  return (
    <Panel noPad title={`${rows.length} decisive games`}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Finished</th>
            <th>Result</th>
            <th>For the seed</th>
            <th>Opponent</th>
            <th>Seed colour</th>
            <th className="r">Moves</th>
            <th>Termination</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g, i) => {
            const seedWon = (g.result === "1-0" && g.seed_color === "white") || (g.result === "0-1" && g.seed_color === "black");
            return (
              <tr key={i} className="clickable" onClick={() => onOpen({ source: g.source, index: g.index })}>
                <td className="mono">{shortTime(g.end_time)}</td>
                <td>
                  <Result r={g.result} />
                </td>
                <td>{seedWon ? <span className="chip chip-win">win</span> : <span className="chip chip-loss">loss</span>}</td>
                <td>{g.opponent}</td>
                <td className="capitalize">{g.seed_color}</td>
                <td className="r tnum">{g.moves}</td>
                <td>{g.termination}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function Terminations({ d }: { d: TournamentDetail }) {
  const kinds = Array.from(new Set(d.standings.terminations.map((t) => t.kind))).sort();
  const opps = Array.from(new Set(d.standings.terminations.map((t) => t.opponent)));
  const get = (o: string, k: string) => d.standings.terminations.find((t) => t.opponent === o && t.kind === k)?.count ?? 0;
  return (
    <Panel noPad>
      <table className="tbl">
        <thead>
          <tr>
            <th>Opponent</th>
            {kinds.map((k) => (
              <th key={k} className="r">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {opps.map((o) => (
            <tr key={o}>
              <td>{o}</td>
              {kinds.map((k) => (
                <td key={k} className={`r ${get(o, k) && !["normal", "adjudication"].includes(k) ? "l" : ""}`}>
                  {get(o, k) || ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function Config({ d, refresh }: { d: TournamentDetail; refresh: () => void }) {
  const r = d.summary.record;
  const [old, setOld] = useState(r.config.participants[0]?.name ?? "");
  const [nw, setNw] = useState("");
  const [rep, setRep] = useState<RenameReport>();
  const rename = async (dry: boolean) => {
    try {
      const x = await call<RenameReport>("rename_player", { id: r.id, old, new: nw, dry_run: dry });
      setRep(x);
      if (!dry) {
        toast.success(`Renamed in ${x.pgn_tags} PGN tags`);
        refresh();
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Panel title="Configuration">
        <pre className="mono text-[11.5px] overflow-auto max-h-[60vh]">{JSON.stringify(r.config, null, 2)}</pre>
      </Panel>
      <div className="flex flex-col gap-3">
        <Panel title="Pairings">
          <div className="max-h-[260px] overflow-auto">
            {d.pairings.map(([a, b, n, t], i) => (
              <div key={i} className="flex items-center gap-2 py-0.5 text-[12px]">
                <span className="flex-1 truncate">
                  {a} – {b}
                </span>
                <span className="w-24">
                  <ProgressBar value={n} max={t} />
                </span>
                <span className="tnum muted w-12 text-right">
                  {n}/{t}
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Rename an engine">
          <p className="muted text-[12px] mb-2">Rewrites the White/Black tags of every PGN and the configuration consistently (EngineWhiteName/EngineBlackName keep the engine's own id). The tournament must not be running.</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Current name">
              <select className="select" value={old} onChange={(e) => setOld(e.target.value)}>
                {r.config.participants.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="New name">
              <input className="input" value={nw} onChange={(e) => setNw(e.target.value)} placeholder="e.g. Triumviratus 7.0 64-bit" />
            </Field>
          </div>
          <div className="flex gap-2 mt-2">
            <button className="btn" onClick={() => rename(true)} disabled={!nw}>
              Dry run
            </button>
            <button className="btn btn-primary" onClick={() => rename(false)} disabled={!nw}>
              <ArrowDownUp size={13} /> Rename
            </button>
          </div>
          {rep && <div className="mt-2 text-[12px] muted">{rep.dry_run ? "Would change" : "Changed"} {rep.pgn_tags} tags in {rep.files.length} files{rep.config_changed ? " and the configuration" : ""}.</div>}
        </Panel>
      </div>
    </div>
  );
}

export function TournamentDetailPage() {
  const { id = "" } = useParams();
  const [order, setOrder] = useState<RowOrder>("rating");
  const { data: d, error, refresh } = usePoll<TournamentDetail>("tournament_get", { id, order }, 4000);
  const [game, setGame] = useState<GameRef | null>(null);
  if (!d) return <div className="p-4">{error ? <ErrorBox error={error} /> : <span className="muted">Loading…</span>}</div>;
  const r = d.summary.record;
  const p = d.summary.progress;
  const st = d.standings;
  const mle = st.elo.find((e) => e.name === st.seed);
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {r.name} <StateChip state={r.state} alive={d.summary.runner_alive} />
            {r.imported && <span className="chip">imported</span>}
          </span>
        }
        sub={`${r.config.event} · ${r.config.kind.replace("_", " ")}${r.config.variant === "chess960" ? " · Chess960" : ""} · TC ${r.config.tc} · ${r.config.threads} threads · hash ${r.config.hash_mb} MB · ${r.config.book.split(/[\\/]/).pop()} · ${r.config.nodes.length} node(s) × ${r.config.lanes_per_node} lanes`}
        actions={
          <>
            <Tip content="CCRL export and forum post">
              <Link className="btn" to={`/export?id=${encodeURIComponent(r.id)}`}>
                <Download size={13} /> Export
              </Link>
            </Tip>
            <Link className="btn" to={`/export?id=${encodeURIComponent(r.id)}&post=1`}>
              <MessageSquareText size={13} /> Post
            </Link>
            <ExportTournamentFile id={r.id} />
            <TournamentActions t={d.summary} onDone={refresh} />
          </>
        }
      />
      {r.last_error && <ErrorBox error={r.last_error} />}
      <div className="grid grid-cols-8 gap-3">
        <Kpi label="Games" value={`${p.done}/${p.expected}`} sub={<ProgressBar value={p.done} max={p.expected} tone={r.state === "running" ? "win" : "accent"} />} />
        <Kpi label="Result" value={<Wdl w={st.total.wins} d={st.total.draws} l={st.total.losses} />} sub={`${st.total.score.toFixed(1)} / ${st.total.games}`} />
        <Kpi label="Score" value={pct(st.total.pct)} sub={st.total.elo != null ? `${signed(st.total.elo)} ± ${st.total.elo_err?.toFixed(0) ?? "∞"} Elo` : "—"} tone={st.total.pct > 50 ? "win" : st.total.pct < 50 ? "loss" : undefined} />
        <Kpi label="Performance" value={st.performance != null ? num(st.performance) : "—"} sub={st.avg_opponent_rating != null ? `avg opp ${num(st.avg_opponent_rating)}` : "no ratings"} />
        <Kpi label="MLE rating" value={mle ? num(mle.elo) : "—"} sub={mle ? `${num(mle.lo)} – ${num(mle.hi)}` : "anchored on CCRL"} tone="accent" />
        <Kpi label="Games / hour" value={num(p.rate_per_hour, 1)} sub={`${p.lanes} lanes`} />
        <Kpi label="Avg game" value={duration(p.avg_game_s)} sub={st.min_duration_s != null ? `${duration(st.min_duration_s)} – ${duration(st.max_duration_s)}` : "—"} />
        <Kpi label="ETA" value={r.state === "running" ? duration(p.eta_s) : r.state === "completed" ? "done" : "—"} sub={r.state === "running" ? p.eta_at : r.finished_at ? shortTime(r.finished_at) : ""} />
      </div>
      <Tabs.Root defaultValue="standings">
        <Tabs.List className="tabs mb-3" aria-label="Tournament views">
          <Tabs.Trigger className="tab" value="standings">Standings</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="lanes">Lanes &amp; placement</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="games">Games</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="decisive">Decisive ({st.decisive.length})</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="terms">Terminations</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="config">Configuration</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="standings">
          <Standings d={d} order={order} setOrder={setOrder} />
        </Tabs.Content>
        <Tabs.Content value="lanes">
          <Lanes d={d} />
        </Tabs.Content>
        <Tabs.Content value="games">
          <Games id={id} onOpen={setGame} />
        </Tabs.Content>
        <Tabs.Content value="decisive">
          <Decisive d={d} onOpen={setGame} />
        </Tabs.Content>
        <Tabs.Content value="terms">
          <Terminations d={d} />
        </Tabs.Content>
        <Tabs.Content value="config">
          <Config d={d} refresh={refresh} />
        </Tabs.Content>
      </Tabs.Root>
      <GameViewer game={game} onClose={() => setGame(null)} />
    </div>
  );
}
