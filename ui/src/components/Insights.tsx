import { useMemo, useState } from "react";
import type { EloHistory } from "../bindings/EloHistory";
import type { OpeningStat } from "../bindings/OpeningStat";
import type { OpeningsReport } from "../bindings/OpeningsReport";
import { usePoll } from "../lib/api";
import { num, signed } from "../lib/format";
import { LineChart } from "./Chart";
import { cmpNum, SortTh, type SortDir } from "./EngineRatings";
import { Empty, Panel, Seg, Spinner, Tip } from "./ui";
import type { GameRef } from "./GameViewer";

/** Elo of a player game after game, with its 95 % band (performance when ratings are known). */
export function EloGraph({ id, running }: { id: string; running: boolean }) {
  const [player, setPlayer] = useState<string>();
  const [mode, setMode] = useState<"elo" | "perf">("elo");
  const { data } = usePoll<EloHistory>("tournament_elo_history", { id, player: player ?? null }, running ? 15000 : 0);
  if (!data) return <Spinner />;
  const pts = data.points;
  const hasPerf = pts.some((p) => p.perf != null);
  const usePerf = mode === "perf" && hasPerf;
  const shift = (p: (typeof pts)[number]) => (usePerf && p.perf != null && p.elo != null ? p.perf - p.elo : 0);
  const last = pts[pts.length - 1];
  return (
    <Panel
      title={`Elo of ${data.player} game after game`}
      actions={
        <div className="flex items-center gap-2">
          {hasPerf && <Seg value={mode} onChange={setMode} options={[{ value: "elo", label: "Elo difference" }, { value: "perf", label: "Performance" }]} />}
          <select className="select" style={{ height: 24, width: 220 }} value={data.player} onChange={(e) => setPlayer(e.target.value)} aria-label="Player" data-testid="elo-player">
            {data.players.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
      }
    >
      {pts.length < 2 ? (
        <Empty>Not enough games of {data.player} yet.</Empty>
      ) : (
        <div className="flex flex-col gap-2" data-testid="elo-graph">
          <div className="flex flex-wrap gap-4 text-[12.5px]">
            <span>
              After <b>{last.games}</b> games: <b className="tnum">{last.elo != null ? (usePerf && last.perf != null ? num(last.perf) : signed(last.elo, 0)) : "—"}</b>
              {last.lo != null && last.hi != null && <span className="muted tnum"> ± {num((last.hi - last.lo) / 2)}</span>}
              <span className="muted"> · score {last.score_pct.toFixed(1)}%</span>
            </span>
            <span className="muted">The band is the 95 % interval: it narrows as games are played. A result is reliable when the band no longer crosses the value you compare with.</span>
          </div>
          <LineChart
            x={pts.map((p) => p.games)}
            series={[
              { label: usePerf ? "Performance" : "Elo", color: "var(--accent)", values: pts.map((p) => (p.elo == null ? null : p.elo + shift(p))), width: 2 },
              { label: "95 % high", color: "var(--muted)", values: pts.map((p) => (p.hi == null ? null : p.hi + shift(p))), dash: [4, 4], width: 1 },
              { label: "95 % low", color: "var(--muted)", values: pts.map((p) => (p.lo == null ? null : p.lo + shift(p))), dash: [4, 4], width: 1 },
            ]}
            height={260}
            zeroLine={!usePerf}
            xLabel={(v) => `${v}`}
          />
          <div className="muted text-[11.5px]">Games in the order they ended. {usePerf ? "Performance = average CCRL rating of the opponents met + the Elo difference." : "Elo difference from the score against the opponents met."}</div>
        </div>
      )}
    </Panel>
  );
}

type SortKey = "label" | "games" | "white" | "draws" | "bias" | "plies";

/** How each opening of the book played out: colour bias, draws, sweeps. */
export function OpeningsStats({ id, running, open }: { id: string; running: boolean; open: (g: GameRef) => void }) {
  const { data } = usePoll<OpeningsReport>("tournament_openings", { id }, running ? 30000 : 0);
  const [filter, setFilter] = useState<"all" | "biased" | "drawish">("all");
  const [sort, setSort] = useState<[SortKey, SortDir]>(["games", "desc"]);
  const rows = useMemo(() => {
    const drawPct = (o: OpeningStat) => (100 * o.draws) / Math.max(1, o.games);
    const bias = (o: OpeningStat) => Math.abs(o.white_pct - 50);
    let v = (data?.openings ?? []).slice();
    if (filter === "biased") v = v.filter((o) => o.pairs > 0 && (o.pairs_white_both > 0 || o.pairs_black_both > 0));
    if (filter === "drawish") v = v.filter((o) => o.games >= 2 && o.draws === o.games);
    const key: Record<SortKey, (o: OpeningStat) => number | null> = { label: () => 0, games: (o) => o.games, white: (o) => o.white_pct, draws: drawPct, bias, plies: (o) => o.avg_plies };
    v.sort((a, b) => (sort[0] === "label" ? (sort[1] === "asc" ? 1 : -1) * a.label.localeCompare(b.label) : cmpNum(key[sort[0]](a), key[sort[0]](b), sort[1])));
    return v;
  }, [data, filter, sort]);
  if (!data) return <Spinner />;
  if (!data.games) return <Empty>No finished game yet.</Empty>;
  return (
    <Panel
      noPad
      title={`${data.openings.length} openings · ${data.games} games · White ${data.white_pct.toFixed(1)}% · draws ${data.draw_pct.toFixed(1)}%`}
      actions={
        <Seg
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "biased", label: "White or Black won both" },
            { value: "drawish", label: "Always drawn" },
          ]}
        />
      }
    >
      <div className="px-3 py-2 muted text-[11.5px]" style={{ borderBottom: "1px solid var(--border)" }}>
        Every opening is played twice by the same two engines with colours reversed (a pair). <b>White both</b>: White won both games, so the opening decides the result more than the engines. <b>Sweep</b>: the same engine won both games. {data.biased > 0 && <b style={{ color: "var(--warn)" }}>{data.biased} openings were won by the same colour in every pair.</b>}
      </div>
      <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
        <table className="tbl" data-testid="openings-table">
          <thead>
            <tr>
              <SortTh k="label" sort={sort} setSort={setSort} first="asc">
                Opening
              </SortTh>
              <SortTh k="games" sort={sort} setSort={setSort} right>
                Games
              </SortTh>
              <th className="r">+ = −</th>
              <SortTh k="white" sort={sort} setSort={setSort} right>
                White %
              </SortTh>
              <SortTh k="draws" sort={sort} setSort={setSort} right>
                Draws %
              </SortTh>
              <th className="r">Pairs</th>
              <th className="r">White both</th>
              <th className="r">Black both</th>
              <th className="r">Sweeps</th>
              <SortTh k="plies" sort={sort} setSort={setSort} right>
                Avg plies
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const biased = o.pairs >= 1 && (o.pairs_white_both === o.pairs || o.pairs_black_both === o.pairs);
              return (
                <tr key={o.label + (o.fen ?? "")} className="clickable" onClick={() => open({ source: o.example_source, index: o.example_index })}>
                  <td className="mono text-[12px] truncate" style={{ maxWidth: 420 }} title={o.fen ? `${o.fen}\n${o.moves.join(" ")}` : o.label}>
                    {o.label}
                  </td>
                  <td className="r tnum">{o.games}</td>
                  <td className="r tnum muted">
                    {o.white_wins} {o.draws} {o.black_wins}
                  </td>
                  <td className="r tnum" style={biased ? { color: "var(--warn)", fontWeight: 600 } : undefined}>
                    {o.white_pct.toFixed(0)}
                  </td>
                  <td className="r tnum">{((100 * o.draws) / Math.max(1, o.games)).toFixed(0)}</td>
                  <td className="r tnum muted">{o.pairs}</td>
                  <td className="r tnum">{o.pairs_white_both || ""}</td>
                  <td className="r tnum">{o.pairs_black_both || ""}</td>
                  <td className="r tnum">{o.pairs_sweep || ""}</td>
                  <td className="r tnum muted">{o.avg_plies != null ? o.avg_plies.toFixed(0) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 muted text-[11px]">
        <Tip content="Click a row to replay one of its games">
          <span>Click an opening to replay one of its games.</span>
        </Tip>
      </div>
    </Panel>
  );
}
