import type { Key } from "chessground/types";
import { Copy, Flag, FlipVertical2, Gamepad2, Microscope, Play as PlayIcon, Save, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { EngineEntry } from "../bindings/EngineEntry";
import type { PlayState } from "../bindings/PlayState";
import { Board, EvalBar } from "../components/Board";
import { BoardSettingsButton } from "../components/BoardSettings";
import { Material } from "../components/GameViewer";
import { Empty, Field, Modal, PageHeader, Panel, Seg } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { playMove, useBoardPrefs } from "../lib/boardPrefs";
import { isCapture } from "../lib/chess";
import { evalText } from "../lib/format";

type Tc = { id: string; label: string; base: number; inc: number; movetime: number };
const TCS: Tc[] = [
  { id: "1+0", label: "1+0", base: 60, inc: 0, movetime: 0 },
  { id: "3+2", label: "3+2", base: 180, inc: 2, movetime: 0 },
  { id: "5+3", label: "5+3", base: 300, inc: 3, movetime: 0 },
  { id: "10+5", label: "10+5", base: 600, inc: 5, movetime: 0 },
  { id: "15+10", label: "15+10", base: 900, inc: 10, movetime: 0 },
  { id: "move1", label: "Engine 1 s / move", base: 0, inc: 0, movetime: 1000 },
  { id: "move5", label: "Engine 5 s / move", base: 0, inc: 0, movetime: 5000 },
];

const clock = (ms?: number | null) => {
  if (ms == null) return "—";
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return s.toFixed(1);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/** The strength settings an engine offers: UCI_Elo (with its range) or a skill level. */
function strengthOf(e?: EngineEntry) {
  const opt = (n: string) => e?.options.find((o) => o.name.toLowerCase() === n.toLowerCase());
  const elo = opt("UCI_Elo");
  if (elo && opt("UCI_LimitStrength")) return { kind: "elo" as const, name: elo.name, min: Number(elo.min ?? 1000), max: Number(elo.max ?? 3000) };
  const skill = opt("Skill Level") ?? opt("Skill") ?? opt("Level");
  if (skill && skill.kind === "spin") return { kind: "skill" as const, name: skill.name, min: Number(skill.min ?? 0), max: Number(skill.max ?? 20) };
  return null;
}

/** A game against an engine of the library. */
export function PlayPage() {
  const nav = useNavigate();
  const prefs = useBoardPrefs();
  const { data: engines } = usePoll<EngineEntry[]>("engines_list", {}, 0);
  const usable = useMemo(() => (engines ?? []).filter((e) => e.id != null && e.path && e.verify_status !== "failed"), [engines]);
  const [engineId, setEngineId] = useState<number>();
  const [color, setColor] = useState<"white" | "black" | "random">("white");
  const [tc, setTc] = useState("5+3");
  const [limit, setLimit] = useState(true);
  const [strength, setStrength] = useState(1500);
  const [fen, setFen] = useState("");
  const [showEval, setShowEval] = useState(false);
  const [flip, setFlip] = useState(false);
  const [st, setSt] = useState<PlayState>();
  const [promo, setPromo] = useState<string | null>(null);
  const prevMoves = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const engine = usable.find((e) => e.id === engineId);
  const str = strengthOf(engine);
  useEffect(() => {
    if (engineId == null && usable.length) setEngineId((usable.find((e) => /stockfish/i.test(e.engine)) ?? usable[0]).id!);
  }, [usable, engineId]);
  // a fresh default when the engine changes: 1500 Elo, or skill level 5
  useEffect(() => {
    if (str) setStrength(Math.min(str.max, Math.max(str.min, str.kind === "elo" ? 1500 : 5)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineId, str?.kind]);

  // the game: polled while it is played
  useEffect(() => {
    call<PlayState>("play_state").then(setSt).catch(() => {});
  }, []);
  useEffect(() => {
    if (!st?.active) return;
    const t = setInterval(() => call<PlayState>("play_state").then(setSt).catch(() => {}), 200);
    return () => clearInterval(t);
  }, [st?.active]);
  useEffect(() => {
    const n = st?.moves.length ?? 0;
    if (prefs.sound && n === prevMoves.current + 1) playMove(isCapture(st?.sans[n - 1]));
    prevMoves.current = n;
    listRef.current?.querySelector<HTMLElement>(`[data-ply="${n}"]`)?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.moves.length]);

  const start = async () => {
    if (engineId == null) return;
    const t = TCS.find((x) => x.id === tc)!;
    const humanWhite = color === "random" ? Math.random() < 0.5 : color === "white";
    const options: Record<string, string> = {};
    if (str && limit) {
      if (str.kind === "elo") {
        options.UCI_LimitStrength = "true";
        options[str.name] = String(strength);
      } else options[str.name] = String(strength);
    }
    try {
      const s = await call<PlayState>("play_start", { config: { engine_id: engineId, human_white: humanWhite, base_ms: t.base * 1000, inc_ms: t.inc * 1000, movetime_ms: t.movetime, start_fen: fen.trim(), threads: 1, hash: 64, options, player_name: "" } });
      setFlip(!humanWhite);
      setSt(s);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const act = async (cmd: string, args: Record<string, unknown> = {}) => {
    try {
      setSt(await call<PlayState>(cmd, args));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const onMove = (o: Key, d: Key) => {
    if (st?.promotions.includes(`${o}${d}`)) setPromo(`${o}${d}`);
    else act("play_move", { uci: `${o}${d}` });
  };
  const movable = useMemo(
    () => (st?.human_to_move ? { color: (st.human_white ? "white" : "black") as "white" | "black", dests: new Map(Object.entries(st.legal) as [Key, Key[]][]) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [st?.human_to_move, st?.fen],
  );
  const pgn = () => call<string>("play_pgn");
  const save = async () => {
    try {
      const text = await pgn();
      const r = await call<{ path: string }>("pgn_save", { text, folder: "play", name: `${st?.player ?? "Human"} vs ${st?.engine ?? "engine"}` });
      toast.success(`Saved: ${r.path}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const analyse = async () => {
    try {
      sessionStorage.setItem("torsgui-analysis-text", await pgn());
    } catch {
      /* private mode */
    }
    nav("/analysis?from=play");
  };

  const orientation = flip ? "black" : "white";
  const started = !!st && (st.active || st.result !== "*" || st.moves.length > 0);
  const humanWhite = st?.human_white ?? true;
  const bar = (white: boolean) => {
    const name = white === humanWhite ? st?.player || "You" : st?.engine;
    const ms = white ? st?.white_ms : st?.black_ms;
    const toMove = !!st?.active && (st.fen.split(" ")[1] === "w") === white;
    return (
      <div className="flex items-center gap-2 px-1" data-testid={white ? "play-bar-white" : "play-bar-black"}>
        <span className={`inline-block w-3 h-3 rounded-full`} style={{ background: white ? "#f2f2f2" : "#222", border: "1px solid var(--border-strong)" }} />
        <span className="font-medium truncate">{name}</span>
        {st && <Material fen={st.fen || "8/8/8/8/8/8/8/8 w - - 0 1"} side={white ? "w" : "b"} />}
        {white !== humanWhite && st?.thinking && <span className="muted text-[11.5px]">thinking…</span>}
        <span className={`clock ml-auto ${toMove ? "running" : ""}`}>{st && (st.base_ms > 0 ? clock(ms) : white === humanWhite ? "—" : `${st.movetime_ms / 1000}s`)}</span>
      </div>
    );
  };
  const rows = useMemo(() => {
    const out: { no: number; w?: number; b?: number }[] = [];
    const sf = (st?.start_fen || "w").split(" ");
    const firstWhite = sf[1] !== "b";
    const startNo = Number(sf[5] ?? 1) || 1;
    (st?.sans ?? []).forEach((_, i) => {
      const white = (i % 2 === 0) === firstWhite;
      if (white || out.length === 0) out.push({ no: startNo + out.length });
      out[out.length - 1][white ? "w" : "b"] = i;
    });
    return out;
  }, [st?.sans, st?.start_fen]);
  const info = st?.info;

  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader title="Play against an engine" sub="A game against any engine of the library, with a clock, take-backs and an engine strength you choose" />
      <div className="grid gap-4 analysis-grid">
        <div className="flex flex-col gap-2 min-w-0">
          {bar(flip)}
          <div className="flex gap-2 items-stretch">
            {showEval && <EvalBar cp={info?.score.cp} mate={info?.score.mate} orientation={orientation} />}
            <Board
              fen={st?.fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}
              lastMove={st?.last_move}
              check={st?.check}
              orientation={orientation}
              interactive
              movable={movable}
              onMove={onMove}
              arrows={showEval && info?.pv[0] && !st?.human_to_move ? [{ uci: info.pv[0], brush: "paleBlue" }] : []}
              className="flex-1"
            />
          </div>
          {bar(!flip)}
          <div className="flex items-center gap-1 flex-wrap">
            <button className="btn btn-sm" onClick={() => act("play_undo")} disabled={!st || st.moves.length === 0} data-testid="play-undo">
              <Undo2 size={13} /> Take back
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => act("play_resign")} disabled={!st?.active} data-testid="play-resign">
              <Flag size={13} /> Resign
            </button>
            <button className="btn btn-sm btn-icon" aria-label="Flip board" onClick={() => setFlip((f) => !f)}>
              <FlipVertical2 size={14} />
            </button>
            <BoardSettingsButton />
            <label className="ml-auto flex items-center gap-1.5 text-[12.5px]">
              <input type="checkbox" checked={showEval} onChange={(e) => setShowEval(e.target.checked)} data-testid="play-show-eval" /> Show the engine's evaluation
            </label>
          </div>
        </div>
        <div className="flex flex-col gap-3 min-w-0">
          {st && st.result !== "*" && (
            <div className="panel p-3 flex flex-wrap items-center gap-3" style={{ borderColor: "var(--accent)" }} data-testid="play-result">
              <span className="text-[18px] font-semibold tnum">{st.result}</span>
              <span>{st.termination}</span>
              {st.error && <span className="muted text-[12px]">{st.error}</span>}
            </div>
          )}
          {(!st?.active || !started) && (
            <Panel title={started ? "New game" : "Game"}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Engine" className="col-span-2">
                  <select className="select" value={engineId ?? ""} onChange={(e) => setEngineId(Number(e.target.value))} data-testid="play-engine">
                    {usable.length === 0 && <option value="">No engine in the library</option>}
                    {usable.map((e) => (
                      <option key={e.id} value={e.id!}>
                        {e.display_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="You play">
                  <Seg value={color} onChange={setColor} options={[{ value: "white", label: "White" }, { value: "black", label: "Black" }, { value: "random", label: "Random" }]} />
                </Field>
                <Field label="Time control (minutes + seconds per move)">
                  <select className="select" value={tc} onChange={(e) => setTc(e.target.value)} data-testid="play-tc">
                    {TCS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Strength" className="col-span-2" hint={str ? undefined : "this engine has no strength setting (UCI_Elo or Skill Level): it plays at full strength"}>
                  {str ? (
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={limit} onChange={(e) => setLimit(e.target.checked)} aria-label="Limit the strength" />
                      <input type="range" className="flex-1" min={str.min} max={str.max} step={str.kind === "elo" ? 50 : 1} value={strength} disabled={!limit} onChange={(e) => setStrength(+e.target.value)} aria-label="Strength" />
                      <span className="tnum w-24 text-right">{limit ? (str.kind === "elo" ? `${strength} Elo` : `level ${strength}`) : "full strength"}</span>
                    </div>
                  ) : (
                    <span className="muted text-[12.5px]">Full strength</span>
                  )}
                </Field>
                <Field label="Start position (FEN, empty = the usual start)" className="col-span-2">
                  <input className="input mono" value={fen} onChange={(e) => setFen(e.target.value)} placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" data-testid="play-fen" />
                </Field>
              </div>
              <button className="btn btn-primary mt-3 w-full justify-center" onClick={start} disabled={engineId == null} data-testid="play-start">
                <PlayIcon size={14} /> Start the game
              </button>
            </Panel>
          )}
          {started ? (
            <>
              {showEval && info && (
                <div className="panel p-2 text-[12.5px] flex gap-2" data-testid="play-info">
                  <b className="tnum shrink-0">{evalText(info.score.cp, info.score.mate)}</b>
                  <span className="muted shrink-0">d{info.depth}</span>
                  <span className="mono text-[12px] truncate">{info.pv_san.slice(0, 10).join(" ")}</span>
                </div>
              )}
              <div ref={listRef} className="panel overflow-auto mono text-[12.5px]" style={{ maxHeight: 360 }} data-testid="play-moves">
                {rows.length === 0 ? (
                  <div className="p-2 muted">{st?.human_to_move ? "Your move." : "The engine is thinking…"}</div>
                ) : (
                  <div className="movelist">
                    {rows.map((r) => (
                      <div key={r.no} className="contents">
                        <span className="no">{r.no}.</span>
                        {[r.w, r.b].map((i, k) =>
                          i == null ? (
                            <span key={k} />
                          ) : (
                            <button key={k} data-ply={i + 1} className={i + 1 === st?.moves.length ? "active" : ""}>
                              <span>{st?.sans[i]}</span>
                            </button>
                          ),
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button className="btn btn-sm" onClick={save} disabled={!st?.moves.length} data-testid="play-save">
                  <Save size={12} /> Save PGN
                </button>
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(await pgn());
                      toast.success("PGN copied");
                    } catch {
                      toast.error("The clipboard is not available: use Save PGN");
                    }
                  }}
                  disabled={!st?.moves.length}
                >
                  <Copy size={12} /> Copy PGN
                </button>
                <button className="btn btn-sm" onClick={analyse} disabled={!st?.moves.length || !!st?.active} data-testid="play-analyse">
                  <Microscope size={12} /> Analyse the game
                </button>
              </div>
            </>
          ) : (
            <Panel>
              <Empty icon={<Gamepad2 size={18} />}>Choose an engine, your colour and the time control, then start. Drag or click the pieces to move; you can take back moves.</Empty>
            </Panel>
          )}
        </div>
      </div>
      <Modal open={!!promo} onOpenChange={(o) => !o && setPromo(null)} title="Promote to" width={320}>
        <div className="grid grid-cols-4 gap-2" data-testid="play-promotion">
          {(["q", "r", "b", "n"] as const).map((p) => (
            <button
              key={p}
              className="btn justify-center h-12 text-[22px]"
              onClick={() => {
                const u = `${promo}${p}`;
                setPromo(null);
                act("play_move", { uci: u });
              }}
              aria-label={`promote to ${p}`}
            >
              {{ q: humanWhite ? "♕" : "♛", r: humanWhite ? "♖" : "♜", b: humanWhite ? "♗" : "♝", n: humanWhite ? "♘" : "♞" }[p]}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
