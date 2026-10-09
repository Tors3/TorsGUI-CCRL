import * as Tabs from "@radix-ui/react-tabs";
import { ArrowDownUp, Download, FolderOpen, MessageSquareText, Pencil, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { EngineEntry } from "../bindings/EngineEntry";
import type { GameRow } from "../bindings/GameRow";
import type { RenameReport } from "../bindings/RenameReport";
import type { RowOrder } from "../bindings/RowOrder";
import type { Stage } from "../bindings/Stage";
import type { StagesView } from "../bindings/StagesView";
import type { TournamentDetail } from "../bindings/TournamentDetail";
import { GameViewer, type GameRef } from "../components/GameViewer";
import { GamesTable } from "../components/GamesTable";
import { EloGraph, OpeningsStats, PlacementChart } from "../components/Insights";
import { ExportTournamentFile } from "../components/TournamentFileDialog";
import { TournamentBroadcast } from "../components/Broadcast";
import { TournamentActions } from "../components/TournamentActions";
import { UciOptionsEditor } from "../components/UciOptions";
import { Empty, ErrorBox, Field, Kpi, PageHeader, Panel, ProgressBar, Result, Seg, StateChip, Tip, Warn, Wdl, WdlBar } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { cpuLabel } from "../lib/cpu";
import { duration, num, pct, shortTime, signed } from "../lib/format";

function Standings({ d, order, setOrder }: { d: TournamentDetail; order: RowOrder; setOrder: (o: RowOrder) => void }) {
  const st = d.standings;
  const perGame = d.summary.record.config.games_per_pairing;
  return (
    <div className="grid gap-3 cols-main-side">
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
            <Tip content={`Ratings of the participants from the imported CCRL ${d.summary.record.config.ccrl_list || "Blitz"} list (${cpuLabel(d.summary.record.config.participants, d.summary.record.config.threads)}; 1CPU + gap when missing)`}>
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

const PLACEMENT = /^lane (\d+): placement differs from the plan/;

/** The placement warnings of the lanes, as one line (details on demand). */
function PlacementWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  const lanes = warnings.map((w) => Number(PLACEMENT.exec(w)?.[1])).sort((a, b) => a - b);
  return (
    <Warn>
      <details data-testid="placement-warnings">
        <summary className="cursor-pointer">
          CPU placement differs from the plan on {lanes.length} lane{lanes.length > 1 ? "s" : ""} ({lanes.join(", ")}): those games are not held to their CPU set and may share cores with other lanes. TorsGUI already tried to set it again.
        </summary>
        <ul className="mt-1 list-disc pl-5">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </details>
    </Warn>
  );
}

function Lanes({ d }: { d: TournamentDetail }) {
  if (!d.lanes.length) return <Empty>No runner session yet: lanes appear when the tournament runs.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      {d.warnings.filter((w) => !PLACEMENT.test(w)).map((w, i) => (
        <Warn key={i}>{w}</Warn>
      ))}
      <PlacementWarnings warnings={d.warnings.filter((w) => PLACEMENT.test(w))} />
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
  return (
    <div className="flex flex-col gap-3">
      <TournamentFiles id={id} />
      <GamesTable rows={data} error={error} onOpen={onOpen} />
    </div>
  );
}

type Folders = { folder: string; pgn: string; logs: string; game_logs: string };

/** Where the tournament's PGNs and logs are, with buttons that open the folders. */
function TournamentFiles({ id }: { id: string }) {
  const [f, setF] = useState<Folders>();
  useEffect(() => {
    call<Folders>("tournament_folders", { id }).then(setF).catch(() => {});
  }, [id]);
  if (!f) return null;
  const open = (path: string) => call("open_folder", { path }).catch((e) => toast.error((e as Error).message));
  const rows: [string, string, string][] = [
    ["PGN files", f.pgn, "one file per lane (node0_lane3.pgn…); every finished game is appended"],
    ["Game logs", f.game_logs, "one fastchess log per game, engine output included: why a game was abandoned"],
    ["Tournament folder", f.folder, "config, runner log, console output of the lanes"],
  ];
  return (
    <Panel title="Files">
      <div className="flex flex-col gap-1.5" data-testid="tournament-files">
        {rows.map(([label, path, hint]) => (
          <div key={label} className="flex items-center gap-2 text-[12.5px]">
            <button className="btn btn-sm" onClick={() => open(path)} title={hint}>
              <FolderOpen size={13} /> {label}
            </button>
            <span className="mono muted break-all text-[11.5px]">{path}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
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

const pts = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** One match: score, games played, winner (knockout) or bye. */
function MatchRow({ m, ko }: { m: Stage["matches"][number]; ko: boolean }) {
  if (!m.b)
    return (
      <tr>
        <td className="font-medium">{m.a}</td>
        <td className="muted" colSpan={3}>
          bye{ko ? " (goes through)" : ` (+${pts(m.score_a)})`}
        </td>
      </tr>
    );
  const done = m.played === m.total;
  const bold = (x: string) => (m.winner === x ? "font-semibold" : m.winner ? "muted" : "");
  return (
    <tr>
      <td className={bold(m.a)}>{m.a}</td>
      <td className="r tnum font-medium whitespace-nowrap">
        {pts(m.score_a)} – {pts(m.score_b)}
      </td>
      <td className={bold(m.b)}>{m.b}</td>
      <td className="r tnum muted text-[12px] whitespace-nowrap">
        {m.played}/{m.total} games
        {m.tiebreaks > 0 && <span className="chip chip-warn ml-1.5">{m.tiebreaks} tiebreak{m.tiebreaks > 1 ? "s" : ""}</span>}
        {!done && <span className="chip chip-accent ml-1.5">playing</span>}
      </td>
    </tr>
  );
}

/** Swiss table and rounds, or the knockout bracket. */
function Rounds({ v, ko }: { v: StagesView; ko: boolean }) {
  return (
    <div className="grid gap-3 cols-main-wide-side" data-testid="rounds">
      <div className="flex flex-col gap-3 min-w-0">
        {v.champion && (
          <div className="panel px-3 py-2.5 text-[14px]">
            🏆 <b>{v.champion}</b> wins the {ko ? "cup" : "Swiss"}
          </div>
        )}
        {[...v.stages].reverse().map((s) => (
          <Panel key={s.number} title={`${ko ? (s.number === v.rounds_total ? "Final" : s.number === v.rounds_total - 1 ? "Semi-finals" : `Round ${s.number}`) : `Round ${s.number}`} of ${v.rounds_total}${s.complete ? "" : " — in progress"}`} noPad>
            <table className="tbl">
              <tbody>
                {s.matches.map((m, i) => (
                  <MatchRow key={i} m={m} ko={ko} />
                ))}
              </tbody>
            </table>
          </Panel>
        ))}
        {v.stages.length < v.rounds_total && (
          <div className="muted text-[12px]">
            {v.rounds_total - v.stages.length} more round{v.rounds_total - v.stages.length > 1 ? "s" : ""}: each one is paired when the previous round is finished.
          </div>
        )}
      </div>
      <Panel title={ko ? "Engines" : "Swiss table"} noPad>
        <table className="tbl" data-testid="swiss-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Engine</th>
              <th className="r">Points</th>
              {!ko && <th className="r" title="Buchholz: sum of the opponents' points">Buch.</th>}
              <th className="r">Games</th>
            </tr>
          </thead>
          <tbody>
            {v.table.map((r, i) => (
              <tr key={r.name} className={ko && !r.alive ? "muted" : ""}>
                <td className="tnum">{i + 1}</td>
                <td className="font-medium">
                  {r.name}
                  {ko && !r.alive && <span className="text-[11px] ml-1">out</span>}
                  {r.byes > 0 && <span className="chip ml-1.5">{r.byes} bye{r.byes > 1 ? "s" : ""}</span>}
                </td>
                <td className="r tnum">{pts(r.points)}</td>
                {!ko && <td className="r tnum muted">{pts(r.buchholz)}</td>}
                <td className="r tnum muted">{r.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

/** Withdraw an engine (its games still to play are dropped) or bring it back. */
function Withdraw({ d, refresh }: { d: TournamentDetail; refresh: () => void }) {
  const r = d.summary.record;
  if (r.imported) return null;
  const dynamic = r.config.kind === "swiss" || r.config.kind === "knockout";
  const running = d.summary.runner_alive;
  const toggle = async (name: string, withdrawn: boolean) => {
    if (withdrawn && !confirm(`Withdraw ${name}? Its games still to play are dropped; the games already played stay in the PGNs and are left out of the export by default.`)) return;
    try {
      const x = await call<{ expected_games: number }>("tournament_withdraw", { id: r.id, name, withdrawn });
      toast.success(`${name} ${withdrawn ? "withdrawn" : "back in the tournament"}: ${x.expected_games} games`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Panel title="Engines" actions={<span className="muted text-[11.5px]">{dynamic ? "Swiss / knockout: no withdrawals" : running ? "pause the tournament to withdraw an engine" : "withdraw a crashing engine: its remaining games are dropped"}</span>}>
      <div className="flex flex-col gap-1" data-testid="withdraw-panel">
        {r.config.participants.map((p) => (
          <div key={p.name} className="flex items-center gap-2 text-[12.5px]">
            <span className={`flex-1 truncate ${p.withdrawn ? "line-through muted" : ""}`}>{p.name}</span>
            {p.role === "seed" && <span className="chip">seed</span>}
            {p.withdrawn && <span className="chip chip-warn">withdrawn</span>}
            {p.role !== "seed" && !dynamic && (
              <button className="btn btn-sm" disabled={running} onClick={() => toggle(p.name, !p.withdrawn)} data-testid={`withdraw-${p.name}`}>
                {p.withdrawn ? "Bring back" : "Withdraw"}
              </button>
            )}
          </div>
        ))}
      </div>
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
    <div className="grid gap-3 cols-fit-wide">
      <Panel title="Configuration">
        <pre className="mono text-[11.5px] overflow-auto max-h-[60vh]">{JSON.stringify(r.config, null, 2)}</pre>
      </Panel>
      <div className="flex flex-col gap-3">
        <Withdraw d={d} refresh={refresh} />
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
        <EngineOptions d={d} refresh={refresh} />
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

/** UCI options of one engine in this tournament, used from the next game on. */
function EngineOptions({ d, refresh }: { d: TournamentDetail; refresh: () => void }) {
  const r = d.summary.record;
  const { data: engines } = usePoll<EngineEntry[]>("engines_list", {}, 0);
  const [name, setName] = useState(r.config.participants[0]?.name ?? "");
  const p = r.config.participants.find((x) => x.name === name);
  const [vals, setVals] = useState<Record<string, string> | null>(null);
  const [rev, setRev] = useState(0);
  const [warn, setWarn] = useState<string[]>([]);
  const eng = engines?.find((e) => e.id === p?.engine_id);
  const running = r.state === "running";
  const values = vals ?? p?.options ?? {};
  const save = async () => {
    try {
      const x = await call<{ warnings: string[] }>("tournament_set_options", { id: r.id, name, options: values });
      setWarn(x.warnings);
      toast.success(r.done_games > 0 ? `${name}: options saved, used from game ${r.done_games + 1} on` : `${name}: options saved`);
      setVals(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  if (!p) return null;
  return (
    <Panel title="Engine options in this tournament">
      <div className="flex flex-col gap-2" data-testid="tournament-engine-options">
        <div className="flex items-end gap-2">
          <Field label="Engine">
            <select
              className="select"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setVals(null);
                setWarn([]);
                setRev((x) => x + 1);
              }}
              aria-label="engine whose options to change"
            >
              {r.config.participants.map((x) => (
                <option key={x.name}>{x.name}</option>
              ))}
            </select>
          </Field>
          <button className="btn btn-primary" onClick={save} disabled={running || r.imported || vals == null} data-testid="tournament-options-save">
            <SlidersHorizontal size={13} /> Save options
          </button>
        </div>
        <p className="muted text-[12px]">
          {r.imported ? "Imported tournaments are read-only." : running ? "Pause the tournament to change the options; they are used from the next game." : r.done_games > 0 ? `${r.done_games} games were already played with the old options: the new ones are used from the next game. For CCRL every game of a tournament must use the same settings.` : "Used from the first game."}
        </p>
        <UciOptionsEditor key={`${name}-${rev}`} options={eng?.options ?? []} values={values} onChange={setVals} engineId={p.engine_id} dir={p.dir} />
        {warn.length > 0 && <Warn>{warn.join(" · ")}</Warn>}
      </div>
    </Panel>
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
      <PageHeader help="run-it"
        title={
          <span className="flex items-center gap-2">
            {r.name} <StateChip state={r.state} alive={d.summary.runner_alive} />
            {r.imported && <span className="chip">imported</span>}
          </span>
        }
        sub={`${r.config.event} · ${r.config.kind.replace("_", " ")}${r.config.variant === "chess960" ? " · Chess960" : ""} · TC ${r.config.tc} · ${cpuLabel(r.config.participants, r.config.threads)} · hash ${r.config.hash_mb} MB · ${r.config.book.split(/[\\/]/).pop()} · ${r.config.nodes.length} node(s) × ${r.config.lanes_per_node} lanes`}
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
            {!r.imported && p.done === 0 && r.state !== "running" && (
              <Tip content="Change engines, time control, book, nodes… in the tournament wizard">
                <Link className="btn" to={`/tournaments/${encodeURIComponent(r.id)}/edit`} data-testid="edit-tournament">
                  <Pencil size={13} /> Edit
                </Link>
              </Tip>
            )}
            <ExportTournamentFile id={r.id} />
            <TournamentActions t={d.summary} onDone={refresh} />
          </>
        }
      />
      {r.last_error && <ErrorBox error={r.last_error} />}
      {d.ccrl_disclaimer && (
        <Warn>
          <span data-testid="ccrl-disclaimer">{d.ccrl_disclaimer}</span>
        </Warn>
      )}
      <div className="grid gap-3 kpi-grid">
        <Kpi label="Games" value={`${p.done}/${p.expected}`} sub={<ProgressBar value={p.done} max={p.expected} tone={r.state === "running" ? "win" : "accent"} />} />
        <Kpi label="Result" value={<Wdl w={st.total.wins} d={st.total.draws} l={st.total.losses} />} sub={`${st.total.score.toFixed(1)} / ${st.total.games}`} />
        <Kpi label="Score" value={pct(st.total.pct)} sub={st.total.elo != null ? `${signed(st.total.elo)} ± ${st.total.elo_err?.toFixed(0) ?? "∞"} Elo` : "—"} tone={st.total.pct > 50 ? "win" : st.total.pct < 50 ? "loss" : undefined} />
        <Kpi label="Performance" value={st.performance != null ? num(st.performance) : "—"} sub={st.avg_opponent_rating != null ? `avg opp ${num(st.avg_opponent_rating)}` : "no ratings"} />
        <Kpi label="MLE rating" value={mle ? num(mle.elo) : "—"} sub={mle ? `${num(mle.lo)} – ${num(mle.hi)}` : "anchored on CCRL"} tone="accent" />
        <Kpi label="Games / hour" value={num(p.rate_per_hour, 1)} sub={`${p.lanes} lanes`} />
        <Kpi label="Avg game" value={duration(p.avg_game_s)} sub={st.min_duration_s != null ? `${duration(st.min_duration_s)} – ${duration(st.max_duration_s)}` : "—"} />
        <Kpi label="ETA" value={r.state === "running" ? duration(p.eta_s) : r.state === "completed" ? "done" : "—"} sub={r.state === "running" ? p.eta_at : r.finished_at ? shortTime(r.finished_at) : ""} />
      </div>
      <Tabs.Root defaultValue={d.stages ? "rounds" : "standings"}>
        <Tabs.List className="tabs mb-3" aria-label="Tournament views">
          {d.stages && (
            <Tabs.Trigger className="tab" value="rounds" data-testid="tab-rounds">
              {r.config.kind === "knockout" ? "Bracket" : "Rounds"}
            </Tabs.Trigger>
          )}
          <Tabs.Trigger className="tab" value="standings">Standings</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="elo" data-testid="tab-elo">Elo graph</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="openings" data-testid="tab-openings">Openings</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="placement" data-testid="tab-placement">Where it lands</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="lanes">Lanes &amp; placement</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="games">Games</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="decisive">Decisive ({st.decisive.length})</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="terms">Terminations</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="config">Configuration</Tabs.Trigger>
          {!r.imported && (
            <Tabs.Trigger className="tab" value="broadcast" data-testid="tab-broadcast">
              Live broadcast
            </Tabs.Trigger>
          )}
        </Tabs.List>
        {d.stages && (
          <Tabs.Content value="rounds">
            <Rounds v={d.stages} ko={r.config.kind === "knockout"} />
          </Tabs.Content>
        )}
        <Tabs.Content value="standings">
          <Standings d={d} order={order} setOrder={setOrder} />
        </Tabs.Content>
        <Tabs.Content value="elo">
          <EloGraph id={id} running={r.state === "running"} />
        </Tabs.Content>
        <Tabs.Content value="openings">
          <OpeningsStats id={id} running={r.state === "running"} open={setGame} />
        </Tabs.Content>
        <Tabs.Content value="placement">
          <PlacementChart id={id} running={r.state === "running"} />
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
        <Tabs.Content value="broadcast">
          <Panel title="Live broadcast (Lichess, ccrl.live)">
            <TournamentBroadcast id={r.id} />
          </Panel>
        </Tabs.Content>
        <Tabs.Content value="config">
          <Config d={d} refresh={refresh} />
        </Tabs.Content>
      </Tabs.Root>
      <GameViewer game={game} onClose={() => setGame(null)} />
    </div>
  );
}
