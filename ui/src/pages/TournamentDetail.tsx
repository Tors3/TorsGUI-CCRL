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
import { useMsg, useT, type Key } from "../i18n";
import { duration, num, pct, shortTime, signed } from "../lib/format";

function Standings({ d, order, setOrder }: { d: TournamentDetail; order: RowOrder; setOrder: (o: RowOrder) => void }) {
  const t = useT();
  const random = d.summary.record.config.random_openings ?? false;
  const st = d.standings;
  const perGame = d.summary.record.config.games_per_pairing;
  return (
    <div className="grid gap-3 cols-main-side">
      <Panel
        title={t("detail.standings.title", { seed: st.seed })}
        noPad
        actions={<Seg value={order} onChange={setOrder} options={[{ value: "rating", label: t("detail.standings.order.rating") }, { value: "score", label: t("detail.standings.order.score") }, { value: "config", label: t("detail.standings.order.config") }]} />}
      >
        <div className="overflow-auto">
          <table className="tbl" data-testid="standings">
            <thead>
              <tr>
                <th className="r">#</th>
                <th>{t("detail.standings.opponent")}</th>
                <th className="r">{t("detail.standings.rating")}</th>
                <th className="r">{t("detail.standings.games")}</th>
                <th className="r">{t("detail.standings.wb")}</th>
                <th>{t("detail.standings.result")}</th>
                <th className="r">{t("detail.standings.score")}</th>
                <th className="r">%</th>
                <th className="r">{t("detail.standings.elo")}</th>
                <th className="r">{t("detail.standings.perf")}</th>
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
                        <span title={r.rating_estimated ? t("detail.standings.estimatedTip") : t("detail.standings.listTip")}>
                          {num(r.rating)}
                          {r.rating_estimated && <span className="chip chip-warn ml-1">{t("detail.standings.est")}</span>}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="r">
                      {r.games}
                      {r.games < perGame && d.summary.record.state !== "completed" && <span className="muted">/{perGame}</span>}
                    </td>
                    <td className="r" style={{ color: unbalanced ? "var(--warn)" : undefined }} title={unbalanced ? t("detail.standings.unbalancedTip") : t("detail.standings.colourTip")}>
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
                <td>{t("detail.standings.total")}</td>
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
        <Panel title={t("detail.standings.byColour")}>
          {[st.white, st.black].map((r) => (
            <div key={r.name} className="flex items-center justify-between py-1 tnum">
              <span className="capitalize w-14">{r.name === "white" ? t("detail.standings.white") : r.name === "black" ? t("detail.standings.black") : r.name}</span>
              <Wdl w={r.wins} d={r.draws} l={r.losses} />
              <span>{pct(r.pct)}</span>
            </div>
          ))}
        </Panel>
        <Panel
          title={t("detail.standings.mle")}
          actions={
            <Tip content={t("detail.standings.ratingsTip", { list: d.summary.record.config.ccrl_list || "Blitz", cpu: cpuLabel(d.summary.record.config.participants, d.summary.record.config.threads) })}>
              <button
                className="btn btn-sm"
                onClick={() =>
                  call<{ found: number; total: number }>("tournament_refresh_ratings", { id: d.summary.record.id })
                    .then((r) => toast.success(t("detail.standings.found", { found: r.found, total: r.total })))
                    .catch((e) => toast.error(e.message))
                }
              >
                {t("detail.standings.update")}
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
                  {t("detail.standings.ci", { lo: num(e.lo), hi: num(e.hi), games: e.games, method: e.method })}
                </div>
              </div>
            ))
          ) : (
            <div className="muted text-[12px]">{t("detail.standings.noAnchors")}</div>
          )}
        </Panel>
        <Panel title={t("detail.standings.terminations")}>
          {Object.entries(st.termination_totals).map(([k, v]) => (
            <div key={k} className="flex justify-between py-0.5 tnum">
              <span className={k === "normal" || k === "adjudication" ? "" : "l"}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
          <div className="flex justify-between py-0.5 tnum muted">
            <span>{t("detail.standings.duplicates")}</span>
            <span>{st.duplicates}</span>
          </div>
        </Panel>
        <Panel title={t("tournament.pairs.title")}>
          {st.incomplete_pairs.length === 0 && d.open_pairs.length === 0 ? (
            <div style={{ color: "var(--win)" }} data-testid="pairs-complete">
              {t(random ? "tournament.pairs.allRandom" : "tournament.pairs.allPaired")}
            </div>
          ) : (
            <div className="flex flex-col gap-1 text-[12px]" data-testid="pairs-open">
              <Warn>{t(random ? "tournament.pairs.openRandom" : "tournament.pairs.openPaired", { count: d.open_pairs.length })}</Warn>
              {random && <div className="muted">{t("tournament.pairs.randomAbout")}</div>}
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
  const t = useT();
  if (!warnings.length) return null;
  const lanes = warnings.map((w) => Number(PLACEMENT.exec(w)?.[1])).sort((a, b) => a - b);
  return (
    <Warn>
      <details data-testid="placement-warnings">
        <summary className="cursor-pointer">
          {t("detail.lanes.placementWarn", { count: lanes.length, list: lanes.join(", ") })}
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
  const t = useT();
  if (!d.lanes.length) return <Empty>{t("detail.lanes.empty")}</Empty>;
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
              <th>{t("detail.lanes.node")}</th>
              <th>{t("detail.lanes.lane")}</th>
              <th>{t("detail.lanes.state")}</th>
              <th>{t("detail.lanes.game")}</th>
              <th className="r">{t("detail.lanes.opening")}</th>
              <th className="r">{t("detail.lanes.elapsed")}</th>
              <th>{t("detail.lanes.cpus")}</th>
              <th>{t("detail.lanes.check")}</th>
              <th className="r">{t("detail.lanes.played")}</th>
              <th className="r">{t("detail.lanes.failures")}</th>
            </tr>
          </thead>
          <tbody>
            {d.lanes.map((l) => (
              <tr key={`${l.partition}-${l.lane}`}>
                <td>{l.node}</td>
                <td>{l.lane}</td>
                <td>{l.busy ? <span className="chip chip-win"><span className="dot dot-pulse" />{t("detail.lanes.playing")}</span> : <span className="chip">{t("detail.lanes.idle")}</span>}</td>
                <td>{l.job ? `${l.job.white} – ${l.job.black} (p${l.job.pass} r${l.job.round})` : "—"}</td>
                <td className="r">{l.job?.opening ?? "—"}</td>
                <td className="r">{l.started_at && l.busy ? duration(Date.now() / 1000 - l.started_at) : "—"}</td>
                <td className="mono">{l.cpuset ?? t("detail.lanes.noPlacement")}</td>
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
  const t = useT();
  const [f, setF] = useState<Folders>();
  useEffect(() => {
    call<Folders>("tournament_folders", { id }).then(setF).catch(() => {});
  }, [id]);
  if (!f) return null;
  const open = (path: string) => call("open_folder", { path }).catch((e) => toast.error((e as Error).message));
  const rows: [string, string, string][] = [
    [t("detail.files.pgn"), f.pgn, t("detail.files.pgnTip")],
    [t("detail.files.logs"), f.game_logs, t("detail.files.logsTip")],
    [t("detail.files.folder"), f.folder, t("detail.files.folderTip")],
  ];
  return (
    <Panel title={t("detail.files.title")}>
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
  const t = useT();
  const rows = d.standings.decisive;
  if (!rows.length) return <Empty>{t("detail.decisive.empty")}</Empty>;
  return (
    <Panel noPad title={t("detail.decisive.title", { count: rows.length })}>
      <table className="tbl">
        <thead>
          <tr>
            <th>{t("detail.decisive.finished")}</th>
            <th>{t("detail.decisive.result")}</th>
            <th>{t("detail.decisive.forSeed")}</th>
            <th>{t("detail.decisive.opponent")}</th>
            <th>{t("detail.decisive.seedColour")}</th>
            <th className="r">{t("detail.decisive.moves")}</th>
            <th>{t("detail.decisive.termination")}</th>
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
                <td>{seedWon ? <span className="chip chip-win">{t("detail.decisive.win")}</span> : <span className="chip chip-loss">{t("detail.decisive.loss")}</span>}</td>
                <td>{g.opponent}</td>
                <td className="capitalize">{g.seed_color === "white" ? t("detail.standings.white") : g.seed_color === "black" ? t("detail.standings.black") : g.seed_color}</td>
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
  const tr = useT();
  const kinds = Array.from(new Set(d.standings.terminations.map((t) => t.kind))).sort();
  const opps = Array.from(new Set(d.standings.terminations.map((t) => t.opponent)));
  const get = (o: string, k: string) => d.standings.terminations.find((t) => t.opponent === o && t.kind === k)?.count ?? 0;
  return (
    <Panel noPad>
      <table className="tbl">
        <thead>
          <tr>
            <th>{tr("detail.terms.opponent")}</th>
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
  const t = useT();
  if (!m.b)
    return (
      <tr>
        <td className="font-medium">{m.a}</td>
        <td className="muted" colSpan={3}>
          {t("detail.rounds.bye")}{ko ? t("detail.rounds.goesThrough") : ` (+${pts(m.score_a)})`}
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
        {t("detail.rounds.games", { played: m.played, total: m.total })}
        {m.tiebreaks > 0 && <span className="chip chip-warn ml-1.5">{t("detail.rounds.tiebreaks", { count: m.tiebreaks })}</span>}
        {!done && <span className="chip chip-accent ml-1.5">{t("detail.rounds.playing")}</span>}
      </td>
    </tr>
  );
}

/** Swiss table and rounds, or the knockout bracket. */
function Rounds({ v, ko }: { v: StagesView; ko: boolean }) {
  const t = useT();
  return (
    <div className="grid gap-3 cols-main-wide-side" data-testid="rounds">
      <div className="flex flex-col gap-3 min-w-0">
        {v.champion && (
          <div className="panel px-3 py-2.5 text-[14px]">
            🏆 <b>{v.champion}</b> {t("detail.rounds.wins")} {t(ko ? "detail.rounds.cup" : "detail.rounds.swiss")}
          </div>
        )}
        {[...v.stages].reverse().map((s) => (
          <Panel key={s.number} title={t("detail.rounds.of", { round: ko && s.number === v.rounds_total ? t("detail.rounds.final") : ko && s.number === v.rounds_total - 1 ? t("detail.rounds.semis") : t("detail.rounds.round", { n: s.number }), total: v.rounds_total }) + (s.complete ? "" : t("detail.rounds.inProgress"))} noPad>
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
            {t("detail.rounds.more", { count: v.rounds_total - v.stages.length })}
          </div>
        )}
      </div>
      <Panel title={ko ? t("detail.rounds.engines") : t("detail.rounds.swissTable")} noPad>
        <table className="tbl" data-testid="swiss-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("detail.rounds.engine")}</th>
              <th className="r">{t("detail.rounds.points")}</th>
              {!ko && <th className="r" title={t("detail.rounds.buchholzTip")}>{t("detail.rounds.buchholz")}</th>}
              <th className="r">{t("detail.rounds.games2")}</th>
            </tr>
          </thead>
          <tbody>
            {v.table.map((r, i) => (
              <tr key={r.name} className={ko && !r.alive ? "muted" : ""}>
                <td className="tnum">{i + 1}</td>
                <td className="font-medium">
                  {r.name}
                  {ko && !r.alive && <span className="text-[11px] ml-1">{t("detail.rounds.out")}</span>}
                  {r.byes > 0 && <span className="chip ml-1.5">{t("detail.rounds.byes", { count: r.byes })}</span>}
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
  const t = useT();
  const r = d.summary.record;
  if (r.imported) return null;
  const dynamic = r.config.kind === "swiss" || r.config.kind === "knockout";
  const running = d.summary.runner_alive;
  const toggle = async (name: string, withdrawn: boolean) => {
    if (withdrawn && !confirm(t("detail.withdraw.confirm", { name }))) return;
    try {
      const x = await call<{ expected_games: number }>("tournament_withdraw", { id: r.id, name, withdrawn });
      toast.success(t(withdrawn ? "detail.withdraw.withdrawn" : "detail.withdraw.back", { name, games: x.expected_games }));
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Panel title={t("detail.withdraw.title")} actions={<span className="muted text-[11.5px]">{dynamic ? t("detail.withdraw.dynamic") : running ? t("detail.withdraw.pauseFirst") : t("detail.withdraw.about")}</span>}>
      <div className="flex flex-col gap-1" data-testid="withdraw-panel">
        {r.config.participants.map((p) => (
          <div key={p.name} className="flex items-center gap-2 text-[12.5px]">
            <span className={`flex-1 truncate ${p.withdrawn ? "line-through muted" : ""}`}>{p.name}</span>
            {p.role === "seed" && <span className="chip">{t("detail.withdraw.seed")}</span>}
            {p.withdrawn && <span className="chip chip-warn">{t("detail.withdraw.withdrawnChip")}</span>}
            {p.role !== "seed" && !dynamic && (
              <button className="btn btn-sm" disabled={running} onClick={() => toggle(p.name, !p.withdrawn)} data-testid={`withdraw-${p.name}`}>
                {p.withdrawn ? t("detail.withdraw.bringBack") : t("detail.withdraw.withdraw")}
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
  const tr = useT();
  const rename = async (dry: boolean) => {
    try {
      const x = await call<RenameReport>("rename_player", { id: r.id, old, new: nw, dry_run: dry });
      setRep(x);
      if (!dry) {
        toast.success(tr("detail.config.renamed", { count: x.pgn_tags }));
        refresh();
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="grid gap-3 cols-fit-wide">
      <Panel title={tr("detail.config.title")}>
        <pre className="mono text-[11.5px] overflow-auto max-h-[60vh]">{JSON.stringify(r.config, null, 2)}</pre>
      </Panel>
      <div className="flex flex-col gap-3">
        <Withdraw d={d} refresh={refresh} />
        <Panel title={tr("detail.config.pairings")}>
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
        <Panel title={tr("detail.config.rename")}>
          <p className="muted text-[12px] mb-2">{tr("detail.config.renameAbout")}</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label={tr("detail.config.current")}>
              <select className="select" value={old} onChange={(e) => setOld(e.target.value)}>
                {r.config.participants.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label={tr("detail.config.newName")}>
              <input className="input" value={nw} onChange={(e) => setNw(e.target.value)} placeholder={tr("detail.config.newPlaceholder")} />
            </Field>
          </div>
          <div className="flex gap-2 mt-2">
            <button className="btn" onClick={() => rename(true)} disabled={!nw}>
              {tr("detail.config.dryRun")}
            </button>
            <button className="btn btn-primary" onClick={() => rename(false)} disabled={!nw}>
              <ArrowDownUp size={13} /> {tr("detail.config.renameBtn")}
            </button>
          </div>
          {rep && <div className="mt-2 text-[12px] muted">{tr(rep.dry_run ? "detail.config.wouldChange" : "detail.config.changed", { tags: rep.pgn_tags, files: rep.files.length })}{rep.config_changed ? tr("detail.config.andConfig") : ""}.</div>}
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
  const t = useT();
  const eng = engines?.find((e) => e.id === p?.engine_id);
  const running = r.state === "running";
  const values = vals ?? p?.options ?? {};
  const save = async () => {
    try {
      const x = await call<{ warnings: string[] }>("tournament_set_options", { id: r.id, name, options: values });
      setWarn(x.warnings);
      toast.success(r.done_games > 0 ? t("detail.options.savedFrom", { name, n: r.done_games + 1 }) : t("detail.options.saved", { name }));
      setVals(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  if (!p) return null;
  return (
    <Panel title={t("detail.options.title")}>
      <div className="flex flex-col gap-2" data-testid="tournament-engine-options">
        <div className="flex items-end gap-2">
          <Field label={t("detail.options.engine")}>
            <select
              className="select"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setVals(null);
                setWarn([]);
                setRev((x) => x + 1);
              }}
              aria-label={t("detail.options.engineLabel")}
            >
              {r.config.participants.map((x) => (
                <option key={x.name}>{x.name}</option>
              ))}
            </select>
          </Field>
          <button className="btn btn-primary" onClick={save} disabled={running || r.imported || vals == null} data-testid="tournament-options-save">
            <SlidersHorizontal size={13} /> {t("detail.options.save")}
          </button>
        </div>
        <p className="muted text-[12px]">
          {r.imported ? t("detail.options.readOnly") : running ? t("detail.options.pauseFirst") : r.done_games > 0 ? t("detail.options.played", { count: r.done_games }) : t("detail.options.first")}
        </p>
        <UciOptionsEditor key={`${name}-${rev}`} options={eng?.options ?? []} values={values} onChange={setVals} engineId={p.engine_id} dir={p.dir} syzygyPath={r.config.syzygy_path} tournament />
        {warn.length > 0 && <Warn>{warn.join(" · ")}</Warn>}
      </div>
    </Panel>
  );
}

export function TournamentDetailPage() {
  const t = useT();
  const tm = useMsg();
  const { id = "" } = useParams();
  const [order, setOrder] = useState<RowOrder>("rating");
  const { data: d, error, refresh } = usePoll<TournamentDetail>("tournament_get", { id, order }, 4000);
  const [game, setGame] = useState<GameRef | null>(null);
  if (!d) return <div className="p-4">{error ? <ErrorBox error={error} /> : <span className="muted">{t("detail.loading")}</span>}</div>;
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
            {r.imported && <span className="chip">{t("detail.imported")}</span>}
          </span>
        }
        sub={t("detail.sub", { event: r.config.event, kind: t(`tournament.kind.${r.config.kind}` as Key), variant: r.config.variant === "chess960" ? " · Chess960" : "", tc: r.config.tc, cpu: cpuLabel(r.config.participants, r.config.threads), hash: r.config.hash_mb, book: r.config.book.split(/[\\/]/).pop() ?? "", mode: t(r.config.random_openings ? "tournament.openingMode.random" : "tournament.openingMode.paired"), nodes: r.config.nodes.length, lanes: r.config.lanes_per_node })}
        actions={
          <>
            <Tip content={t("detail.exportTip")}>
              <Link className="btn" to={`/export?id=${encodeURIComponent(r.id)}`}>
                <Download size={13} /> {t("detail.export")}
              </Link>
            </Tip>
            <Link className="btn" to={`/export?id=${encodeURIComponent(r.id)}&post=1`}>
              <MessageSquareText size={13} /> {t("detail.post")}
            </Link>
            {!r.imported && p.done === 0 && r.state !== "running" && (
              <Tip content={t("detail.editTip")}>
                <Link className="btn" to={`/tournaments/${encodeURIComponent(r.id)}/edit`} data-testid="edit-tournament">
                  <Pencil size={13} /> {t("detail.edit")}
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
          <span data-testid="ccrl-disclaimer">{tm(d.ccrl_disclaimer)}</span>
        </Warn>
      )}
      <div className="grid gap-3 kpi-grid">
        <Kpi label={t("detail.kpi.games")} value={`${p.done}/${p.expected}`} sub={<ProgressBar value={p.done} max={p.expected} tone={r.state === "running" ? "win" : "accent"} />} />
        <Kpi label={t("detail.kpi.result")} value={<Wdl w={st.total.wins} d={st.total.draws} l={st.total.losses} />} sub={`${st.total.score.toFixed(1)} / ${st.total.games}`} />
        <Kpi label={t("detail.kpi.score")} value={pct(st.total.pct)} sub={st.total.elo != null ? `${signed(st.total.elo)} ± ${st.total.elo_err?.toFixed(0) ?? "∞"} Elo` : "—"} tone={st.total.pct > 50 ? "win" : st.total.pct < 50 ? "loss" : undefined} />
        <Kpi label={t("detail.kpi.performance")} value={st.performance != null ? num(st.performance) : "—"} sub={st.avg_opponent_rating != null ? t("detail.kpi.avgOpp", { rating: num(st.avg_opponent_rating) }) : t("detail.kpi.noRatings")} />
        <Kpi label={t("detail.kpi.mle")} value={mle ? num(mle.elo) : "—"} sub={mle ? `${num(mle.lo)} – ${num(mle.hi)}` : t("detail.kpi.anchored")} tone="accent" />
        <Kpi label={t("detail.kpi.rate")} value={num(p.rate_per_hour, 1)} sub={t("detail.kpi.lanes", { count: p.lanes })} />
        <Kpi label={t("detail.kpi.avg")} value={duration(p.avg_game_s)} sub={st.min_duration_s != null ? `${duration(st.min_duration_s)} – ${duration(st.max_duration_s)}` : "—"} />
        <Kpi label={t("detail.kpi.eta")} value={r.state === "running" ? duration(p.eta_s) : r.state === "completed" ? t("detail.kpi.done") : "—"} sub={r.state === "running" ? p.eta_at : r.finished_at ? shortTime(r.finished_at) : ""} />
      </div>
      <Tabs.Root defaultValue={d.stages ? "rounds" : "standings"}>
        <Tabs.List className="tabs mb-3" aria-label={t("detail.tabs.label")}>
          {d.stages && (
            <Tabs.Trigger className="tab" value="rounds" data-testid="tab-rounds">
              {r.config.kind === "knockout" ? t("detail.tabs.bracket") : t("detail.tabs.rounds")}
            </Tabs.Trigger>
          )}
          <Tabs.Trigger className="tab" value="standings">{t("detail.tabs.standings")}</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="elo" data-testid="tab-elo">{t("detail.tabs.elo")}</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="openings" data-testid="tab-openings">{t("detail.tabs.openings")}</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="placement" data-testid="tab-placement">{t("detail.tabs.placement")}</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="lanes">{t("detail.tabs.lanes")}</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="games">{t("detail.tabs.games")}</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="decisive">{t("detail.tabs.decisive", { count: st.decisive.length })}</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="terms">{t("detail.tabs.terms")}</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="config">{t("detail.tabs.config")}</Tabs.Trigger>
          {!r.imported && (
            <Tabs.Trigger className="tab" value="broadcast" data-testid="tab-broadcast">
              {t("detail.tabs.broadcast")}
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
          <OpeningsStats id={id} running={r.state === "running"} open={setGame} random={r.config.random_openings ?? false} />
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
          <Panel title={t("detail.broadcastTitle")}>
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
