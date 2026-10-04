import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Copy, FlipVertical2, Microscope, Play, Save, Square, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { EngineEntry } from "../bindings/EngineEntry";
import type { GameAnalysisProgress } from "../bindings/GameAnalysisProgress";
import type { LiveAnalysis } from "../bindings/LiveAnalysis";
import type { MoveJudgement } from "../bindings/MoveJudgement";
import type { Score } from "../bindings/Score";
import type { Settings } from "../bindings/Settings";
import type { ViewerGame } from "../bindings/ViewerGame";
import { Board, EvalBar, type Arrow } from "../components/Board";
import { LineChart } from "../components/Chart";
import { Empty, ErrorBox, Field, PageHeader, Panel, ProgressBar, Result, Spinner } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { isCheck } from "../lib/chess";
import { evalText, nps, num } from "../lib/format";
import { analysisPgn } from "../lib/pgnExport";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const TIMES = [100, 300, 1000, 3000, 10000];
const MARK: Record<string, string> = { inaccuracy: "?!", mistake: "?", blunder: "??" };
const LINE_ARROWS: Arrow["brush"][] = ["green", "paleGreen", "paleBlue", "paleGrey", "paleGrey"];

const scoreText = (s?: Score | null) => (s ? evalText(s.cp, s.mate) : "—");
const pawns = (s?: Score | null) => (s == null ? null : s.mate != null ? (s.mate > 0 ? 8 : -8) : s.cp == null ? null : Math.max(-8, Math.min(8, s.cp / 100)));
const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${ms / 1000} s`);

/** Game analysis: a game (archive, PGN or FEN), a live engine and a move-by-move review. */
export function AnalysisPage() {
  const [params] = useSearchParams();
  const { data: engines } = usePoll<EngineEntry[]>("engines_list", {}, 0);
  const { data: settings } = usePoll<Settings>("settings_get", {}, 0);
  const [game, setGame] = useState<ViewerGame>();
  const [text, setText] = useState("");
  const [loadErr, setLoadErr] = useState<string>();
  const [ply, setPly] = useState(0);
  const [flip, setFlip] = useState(false);
  const [engineId, setEngineId] = useState<number>();
  const [threads, setThreads] = useState(1);
  const [hash, setHash] = useState(256);
  const [live, setLive] = useState(false);
  const [multipv, setMultipv] = useState(3);
  const [liveState, setLiveState] = useState<LiveAnalysis>();
  const [movetime, setMovetime] = useState(1000);
  const [review, setReview] = useState<GameAnalysisProgress>();
  const listRef = useRef<HTMLDivElement>(null);

  const usable = useMemo(() => (engines ?? []).filter((e) => e.id != null && e.path && e.verify_status !== "failed"), [engines]);
  useEffect(() => {
    if (engineId == null && usable.length) setEngineId((usable.find((e) => /stockfish/i.test(e.engine)) ?? usable[0]).id!);
  }, [usable, engineId]);
  useEffect(() => {
    if (settings) setHash(settings.hash_per_thread_mb || 256);
  }, [settings]);

  // a game of the archive (from the game viewer) or nothing
  useEffect(() => {
    const source = params.get("source");
    const index = params.get("index");
    if (!source || index == null) return;
    call<ViewerGame>("game_get", { source, index: Number(index) })
      .then((g) => {
        setGame(g);
        setPly(Number(params.get("ply") ?? g.plies.length));
      })
      .catch((e) => setLoadErr(e.message));
  }, [params]);

  const load = async () => {
    setLoadErr(undefined);
    try {
      const g = await call<ViewerGame>("analysis_load_text", { text });
      setGame(g);
      setPly(0);
      setReview(undefined);
    } catch (e) {
      setLoadErr((e as Error).message);
    }
  };

  const plies = useMemo(() => game?.plies ?? [], [game]);
  const n = plies.length;
  const fen = ply > 0 ? plies[ply - 1].fen : game?.start_fen || START;
  const cur = ply > 0 ? plies[ply - 1] : undefined;
  const h = useMemo(() => Object.fromEntries(game?.headers ?? []), [game]);

  // keyboard navigation
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight") setPly((p) => Math.min(n, p + 1));
      else if (e.key === "Home") setPly(0);
      else if (e.key === "End") setPly(n);
      else if (e.key === "f") setFlip((f) => !f);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [n]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-ply="${ply}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [ply]);

  // live analysis follows the position shown
  useEffect(() => {
    if (!live || engineId == null) return;
    const t = setTimeout(() => {
      call("analysis_live", { request: { engine_id: engineId, fen, multipv, threads, hash } }).catch((e) => {
        toast.error(e.message);
        setLive(false);
      });
    }, 120);
    return () => clearTimeout(t);
  }, [live, engineId, fen, multipv, threads, hash]);
  useEffect(() => {
    if (!live) {
      call("analysis_live_stop").catch(() => {});
      return;
    }
    const t = setInterval(() => call<LiveAnalysis>("analysis_live_get").then(setLiveState).catch(() => {}), 400);
    return () => clearInterval(t);
  }, [live]);
  useEffect(() => () => void call("analysis_live_stop").catch(() => {}), []);
  const lines = live && liveState?.fen === fen ? liveState.lines : [];

  // the move-by-move review
  const pollReview = useCallback(async () => {
    const p = await call<GameAnalysisProgress>("analysis_game_progress").catch(() => undefined);
    setReview(p);
    return p;
  }, []);
  useEffect(() => {
    pollReview();
  }, [pollReview]);
  useEffect(() => {
    if (!review?.running) return;
    const t = setInterval(pollReview, 600);
    return () => clearInterval(t);
  }, [review?.running, pollReview]);
  const startReview = async () => {
    if (engineId == null || !game) return;
    try {
      await call("analysis_game_start", { config: { engine_id: engineId, start_fen: game.start_fen, moves: plies.map((p) => p.uci), movetime_ms: movetime, threads, hash } });
      pollReview();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  // a review belongs to the game shown when it has as many positions
  const result = review?.result && review.result.positions.length === n + 1 ? review.result : undefined;
  const judgement = (i: number): MoveJudgement | null | undefined => result?.moves[i];

  const arrows: Arrow[] = useMemo(() => {
    if (lines.length) return lines.filter((l) => l.pv[0]).map((l, i) => ({ uci: l.pv[0], brush: LINE_ARROWS[i] ?? "paleGrey" }));
    const pe = result?.positions[ply];
    const out: Arrow[] = [];
    if (pe?.best_uci) out.push({ uci: pe.best_uci, brush: "green" });
    return out;
  }, [lines, result, ply]);

  const shownScore: Score | null | undefined = lines[0]?.score ?? result?.positions[ply]?.score ?? (cur?.eval_cp != null ? { cp: cur.eval_cp, mate: null } : null);
  const rows = useMemo(() => {
    const out: { no: number; w?: number; b?: number }[] = [];
    const firstWhite = (game?.start_fen || START).split(" ")[1] !== "b";
    const startNo = Number((game?.start_fen || START).split(" ")[5] ?? 1) || 1;
    plies.forEach((_, i) => {
      const white = (i % 2 === 0) === firstWhite;
      if (white || out.length === 0) out.push({ no: startNo + out.length });
      out[out.length - 1][white ? "w" : "b"] = i;
    });
    return out;
  }, [plies, game]);
  const moveButton = (i: number | undefined) => {
    if (i == null) return <span />;
    const j = judgement(i);
    const pe = result?.positions[i + 1];
    return (
      <button data-ply={i + 1} className={i + 1 === ply ? "active" : ""} onClick={() => setPly(i + 1)} title={j?.tag ? `${j.tag}: −${(j.loss_cp / 100).toFixed(2)}` : undefined}>
        <span>
          {plies[i].san}
          {j?.tag && <b className={`j-${j.tag}`}>{MARK[j.tag]}</b>}
        </span>
        <span className="ev">{pe ? scoreText(pe.score) : ""}</span>
      </button>
    );
  };
  const pgnText = () => (game ? analysisPgn(game, result) : "");
  const copyPgn = async () => {
    try {
      await navigator.clipboard.writeText(pgnText());
      toast.success("PGN copied");
    } catch {
      toast.error("The clipboard is not available: use Save PGN");
    }
  };
  const savePgn = async () => {
    try {
      const r = await call<{ path: string }>("pgn_save", { text: pgnText(), folder: "analysis", name: [h.White, h.Black].filter(Boolean).join(" - ") || "analysis" });
      toast.success(`Saved: ${r.path}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const curJ = ply > 0 ? judgement(ply - 1) : undefined;
  const before = ply > 0 ? result?.positions[ply - 1] : undefined;

  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader title="Game analysis" sub="Analyse a game of the archive, a PGN or a position with an engine of the library: live lines, evaluation graph, inaccuracies, mistakes and blunders" />
      <div className="grid gap-3 cols-fit">
        <Panel title="Game or position">
          <div className="flex flex-col gap-2">
            <textarea
              className="textarea"
              rows={3}
              placeholder="Paste a PGN, moves (1. e4 e5 2. Nf3…) or a FEN. A game of the archive: Games → open it → Analyse."
              value={text}
              onChange={(e) => setText(e.target.value)}
              data-testid="analysis-text"
            />
            <div className="flex gap-2 items-center">
              <button className="btn" onClick={load} disabled={!text.trim()} data-testid="analysis-load">
                <Upload size={13} /> Load
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setGame({ headers: [], start_fen: START, plies: [], result: "*", error: null });
                  setPly(0);
                }}
              >
                Start position
              </button>
            </div>
            <ErrorBox error={loadErr} />
          </div>
        </Panel>
        <Panel title="Engine">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Engine" className="col-span-3">
              <select className="select" value={engineId ?? ""} onChange={(e) => setEngineId(Number(e.target.value))} data-testid="analysis-engine">
                {usable.length === 0 && <option value="">No engine in the library</option>}
                {usable.map((e) => (
                  <option key={e.id} value={e.id!}>
                    {e.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Threads">
              <input className="input tnum" type="number" min={1} value={threads} onChange={(e) => setThreads(Math.max(1, +e.target.value))} />
            </Field>
            <Field label="Hash (MB)">
              <input className="input tnum" type="number" min={1} value={hash} onChange={(e) => setHash(Math.max(1, +e.target.value))} />
            </Field>
            <Field label="Lines">
              <select className="select" value={multipv} onChange={(e) => setMultipv(+e.target.value)} aria-label="MultiPV">
                {[1, 2, 3, 4, 5].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
          </div>
        </Panel>
      </div>
      {!game ? (
        <Panel>
          <Empty icon={<Microscope size={18} />}>Load a game or a position to analyse it.</Empty>
        </Panel>
      ) : (
        <div className="grid gap-4 analysis-grid">
          <div className="flex flex-col gap-2 min-w-0">
            {(h.White || h.Black) && (
              <div className="flex items-center gap-2 text-[13px] flex-wrap">
                <b>{h.White ?? "?"}</b> <span className="muted">vs</span> <b>{h.Black ?? "?"}</b> <Result r={game.result} />
                {h.Event && <span className="muted text-[12px]">· {h.Event}</span>}
              </div>
            )}
            <div className="flex gap-2 items-stretch">
              <EvalBar cp={shownScore?.cp} mate={shownScore?.mate} orientation={flip ? "black" : "white"} />
              <Board fen={fen} lastMove={cur?.uci} check={isCheck(cur?.san)} orientation={flip ? "black" : "white"} arrows={arrows} className="flex-1" />
            </div>
            <div className="flex items-center gap-1">
              <button className="btn btn-icon" aria-label="Start" onClick={() => setPly(0)}>
                <ChevronFirst size={15} />
              </button>
              <button className="btn btn-icon" aria-label="Previous" onClick={() => setPly((p) => Math.max(0, p - 1))}>
                <ChevronLeft size={15} />
              </button>
              <button className="btn btn-icon" aria-label="Next" onClick={() => setPly((p) => Math.min(n, p + 1))}>
                <ChevronRight size={15} />
              </button>
              <button className="btn btn-icon" aria-label="End" onClick={() => setPly(n)}>
                <ChevronLast size={15} />
              </button>
              <button className="btn btn-icon" aria-label="Flip board" title="Flip (f)" onClick={() => setFlip((f) => !f)}>
                <FlipVertical2 size={15} />
              </button>
              <span className="muted text-[12px] ml-2 tnum">
                {ply}/{n}
              </span>
              <label className="ml-auto flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} disabled={engineId == null} data-testid="analysis-live" /> Live engine
              </label>
            </div>
            {curJ?.tag && (
              <div className="text-[12.5px]" data-testid="analysis-judgement">
                <b className={`j-${curJ.tag}`}>
                  {cur?.san}
                  {MARK[curJ.tag]} {curJ.tag}
                </b>{" "}
                <span className="muted">
                  (−{(curJ.loss_cp / 100).toFixed(2)}){before?.best_san ? ` · best was ${before.best_san}` : ""}
                  {before?.pv_san.length ? ` (${before.pv_san.slice(0, 6).join(" ")})` : ""}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3 min-w-0">
            {live && (
              <div className="panel p-2 flex flex-col gap-1 text-[12.5px]" data-testid="analysis-lines">
                <div className="flex items-center gap-2 muted text-[11.5px]">
                  {liveState?.running && liveState.fen === fen ? <Spinner size={11} /> : null}
                  {liveState?.engine || "starting…"}
                  {lines[0] && (
                    <span className="ml-auto tnum">
                      depth {lines[0].depth}
                      {lines[0].seldepth ? `/${lines[0].seldepth}` : ""} · {num(lines[0].nodes)} nodes · {nps(lines[0].nps)} nps
                    </span>
                  )}
                </div>
                {liveState?.error && liveState.fen === fen && <div className="muted">{liveState.error}</div>}
                {lines.map((l) => (
                  <div key={l.multipv} className="flex gap-2 min-w-0">
                    <span className={`tnum font-semibold shrink-0 ${(l.score.mate ?? l.score.cp ?? 0) >= 0 ? "" : "l"}`} style={{ width: 54 }}>
                      {scoreText(l.score)}
                    </span>
                    <span className="mono text-[12px] truncate" title={l.pv_san.join(" ")}>
                      {l.pv_san.slice(0, 14).join(" ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Panel
              title="Review"
              actions={
                review?.running ? (
                  <button className="btn btn-sm btn-danger" onClick={() => call("analysis_game_stop")} data-testid="review-stop">
                    <Square size={12} /> Stop
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <select className="select" style={{ height: 24, width: 90 }} value={movetime} onChange={(e) => setMovetime(+e.target.value)} aria-label="Time per move">
                      {TIMES.map((t) => (
                        <option key={t} value={t}>
                          {secs(t)}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-sm btn-primary" onClick={startReview} disabled={!n || engineId == null} data-testid="review-start">
                      <Play size={12} /> Analyse the game
                    </button>
                  </div>
                )
              }
            >
              {review?.running && (
                <div className="flex items-center gap-2 mb-2 text-[12px]">
                  <span className="tnum">
                    {review.done}/{review.total}
                  </span>
                  <div className="flex-1">
                    <ProgressBar value={review.done} max={Math.max(1, review.total)} />
                  </div>
                </div>
              )}
              {review?.error && <ErrorBox error={review.error} />}
              {result ? (
                <div className="flex flex-col gap-2">
                  <table className="tbl text-[12px]" data-testid="review-summary">
                    <thead>
                      <tr>
                        <th />
                        <th className="r">Accuracy</th>
                        <th className="r">ACPL</th>
                        <th className="r j-inaccuracy">?!</th>
                        <th className="r j-mistake">?</th>
                        <th className="r j-blunder">??</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(["white", "black"] as const).map((side) => (
                        <tr key={side}>
                          <td className="truncate" style={{ maxWidth: 160 }}>
                            {(side === "white" ? h.White : h.Black) ?? (side === "white" ? "White" : "Black")}
                          </td>
                          <td className="r">{result[side].accuracy.toFixed(1)}%</td>
                          <td className="r">{result[side].acpl.toFixed(0)}</td>
                          <td className="r">{result[side].inaccuracies}</td>
                          <td className="r">{result[side].mistakes}</td>
                          <td className="r">{result[side].blunders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <LineChart
                    x={result.positions.map((_, i) => i)}
                    series={[{ label: "Evaluation", color: "var(--accent)", values: result.positions.map((p) => pawns(p?.score)) }]}
                    height={130}
                    zeroLine
                    yRange={[-8, 8]}
                    marker={ply}
                    onClick={(i) => setPly(i)}
                  />
                  <div className="muted text-[11px]">
                    {result.engine} · {secs(result.movetime_ms)} per position · White's view, pawns (mates at ±8) — click the graph to jump
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <button className="btn btn-sm" onClick={() => copyPgn()} data-testid="pgn-copy">
                      <Copy size={12} /> Copy PGN
                    </button>
                    <button className="btn btn-sm" onClick={() => savePgn()} data-testid="pgn-save">
                      <Save size={12} /> Save PGN
                    </button>
                    <span className="muted text-[11px]">with evaluations, ?! ? ?? and the engine's lines; saved games appear in Games</span>
                  </div>
                </div>
              ) : (
                !review?.running && <div className="muted text-[12px]">Every position is searched for the time chosen; moves that lose winning chances are marked ?! inaccuracy, ? mistake, ?? blunder.</div>
              )}
            </Panel>
            <div ref={listRef} className="panel overflow-auto mono text-[12.5px]" style={{ maxHeight: 330 }} data-testid="analysis-moves">
              {n === 0 ? (
                <div className="p-2 muted">A position without moves: use the live engine.</div>
              ) : (
                <div className="movelist">
                  {rows.map((r) => (
                    <div key={r.no} className="contents">
                      <span className="no">{r.no}.</span>
                      {moveButton(r.w)}
                      {moveButton(r.b)}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {game.error && <ErrorBox error={game.error} />}
          </div>
        </div>
      )}
    </div>
  );
}
