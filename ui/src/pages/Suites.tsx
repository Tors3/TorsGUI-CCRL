import { CheckCircle2, Play, Puzzle, Square, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { EngineEntry } from "../bindings/EngineEntry";
import type { EpdPosition } from "../bindings/EpdPosition";
import type { SuiteConfig } from "../bindings/SuiteConfig";
import type { SuiteInfo } from "../bindings/SuiteInfo";
import type { SuiteProgress } from "../bindings/SuiteProgress";
import type { SuiteRun } from "../bindings/SuiteRun";
import { Board, type Arrow } from "../components/Board";
import { matchesEngine } from "../components/EngineRatings";
import { Empty, ErrorBox, Field, PageHeader, Panel, ProgressBar, Seg, Spinner } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { evalText } from "../lib/format";

type Source = "builtin" | "file" | "paste";
const TIMES = [100, 250, 500, 1000, 3000, 10000];
const ENGINE_ARROWS: Arrow["brush"][] = ["blue", "yellow", "paleBlue", "paleGrey"];

const secs = (ms?: number | null) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`);

/** Test suites: EPD puzzles and mate finding for the engines of the library. */
export function SuitesPage() {
  const { data: builtin } = usePoll<SuiteInfo[]>("suites_builtin", {}, 0);
  const { data: engines } = usePoll<EngineEntry[]>("engines_list", {}, 0);
  const { data: history, refresh: refreshHistory } = usePoll<SuiteRun[]>("suite_history", {}, 0);
  const [source, setSource] = useState<Source>("builtin");
  const [suiteId, setSuiteId] = useState("mates");
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const [movetime, setMovetime] = useState(1000);
  const [threads, setThreads] = useState(1);
  const [hash, setHash] = useState(64);
  const [concurrency, setConcurrency] = useState(1);
  const [preview, setPreview] = useState<{ name: string; positions: EpdPosition[]; errors: string[] }>();
  const [previewErr, setPreviewErr] = useState<string>();
  const [progress, setProgress] = useState<SuiteProgress>();
  const [shownId, setShownId] = useState<string>("current");
  const [sel, setSel] = useState(0);

  const config: SuiteConfig = useMemo(
    () => ({ builtin: source === "builtin" ? suiteId : "", path: source === "file" ? path : "", text: source === "paste" ? text : "", engines: picked, movetime_ms: movetime, threads, hash, concurrency }),
    [source, suiteId, path, text, picked, movetime, threads, hash, concurrency],
  );
  const sourceKey = JSON.stringify([config.builtin, config.path, config.text]);
  useEffect(() => {
    setPreviewErr(undefined);
    if ((source === "file" && !path.trim()) || (source === "paste" && !text.trim())) {
      setPreview(undefined);
      return;
    }
    const t = setTimeout(() => {
      call<{ name: string; positions: EpdPosition[]; errors: string[] }>("suite_preview", { config })
        .then(setPreview)
        .catch((e) => {
          setPreview(undefined);
          setPreviewErr(e.message);
        });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  // progress of the running suite
  useEffect(() => {
    let was = false;
    const tick = async () => {
      const p = await call<SuiteProgress>("suite_progress").catch(() => undefined);
      setProgress(p);
      if (was && p && !p.running) {
        refreshHistory();
        if (p.error) toast.error(p.error);
        else if (p.run) toast.success(`${p.run.suite}: finished`);
      }
      was = !!p?.running;
    };
    tick();
    const t = setInterval(tick, 700);
    return () => clearInterval(t);
  }, [refreshHistory]);

  const usable = (engines ?? []).filter((e) => e.id != null && e.path && e.verify_status !== "failed");
  const shownEngines = usable.filter((e) => matchesEngine(e, q));
  const run: SuiteRun | undefined = shownId === "current" ? progress?.run ?? undefined : history?.find((h) => h.id === shownId);
  const running = !!progress?.running;

  const start = async () => {
    try {
      await call("suite_start", { config });
      setShownId("current");
      setSel(0);
      toast.success("Test suite started");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const del = async (id: string) => {
    await call("suite_delete", { id }).catch((e) => toast.error(e.message));
    if (shownId === id) setShownId("current");
    refreshHistory();
  };

  const nPositions = preview?.positions.length ?? 0;
  const estimate = nPositions && picked.length ? (nPositions * picked.length * movetime) / 1000 / Math.max(1, concurrency) : 0;

  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader
        title="Test suites"
        sub="Puzzles and mate finding for engines: EPD positions with a best move (bm), a move to avoid (am) or a mate in N (dm)"
        actions={
          running ? (
            <button className="btn btn-danger" onClick={() => call("suite_stop").then(() => toast("Stopping…"))} data-testid="suite-stop">
              <Square size={13} /> Stop
            </button>
          ) : (
            <button className="btn btn-primary" onClick={start} disabled={!picked.length || !nPositions} data-testid="suite-start">
              <Play size={13} /> Run {nPositions ? `${nPositions} positions` : ""}
              {picked.length > 1 ? ` × ${picked.length} engines` : ""}
            </button>
          )
        }
      />
      <div className="grid gap-3 cols-fit">
        <Panel title="Positions" actions={<Seg value={source} onChange={setSource} options={[{ value: "builtin", label: "Built-in" }, { value: "file", label: "EPD file" }, { value: "paste", label: "Paste" }]} />}>
          <div className="flex flex-col gap-2">
            {source === "builtin" &&
              (builtin ?? []).map((b) => (
                <label key={b.id} className="flex items-start gap-2 cursor-pointer" data-testid={`suite-${b.id}`}>
                  <input type="radio" className="mt-1" checked={suiteId === b.id} onChange={() => setSuiteId(b.id)} />
                  <span>
                    <b>{b.name}</b> <span className="muted">· {b.positions} positions</span>
                    <div className="muted text-[11.5px]">{b.about}</div>
                  </span>
                </label>
              ))}
            {source === "file" && (
              <Field label="EPD file" hint="WAC, ECM, STS, Arasan, mate collections… any file with bm / am / dm">
                <input className="input mono" placeholder="C:\Suites\wac.epd" value={path} onChange={(e) => setPath(e.target.value)} data-testid="suite-path" />
              </Field>
            )}
            {source === "paste" && (
              <textarea
                className="textarea"
                rows={6}
                placeholder={'6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - bm Rd8#; dm 1; id "back rank";'}
                value={text}
                onChange={(e) => setText(e.target.value)}
                data-testid="suite-text"
              />
            )}
            <ErrorBox error={previewErr} />
            {preview && (
              <div className="text-[12px]" data-testid="suite-preview">
                <span className={preview.positions.length ? "w" : "l"}>{preview.positions.length} positions</span>
                {preview.errors.length > 0 && (
                  <details className="mt-1">
                    <summary className="muted cursor-pointer">{preview.errors.length} lines skipped</summary>
                    <div className="mono text-[11px] muted max-h-[120px] overflow-auto">
                      {preview.errors.map((e) => (
                        <div key={e}>{e}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </Panel>
        <Panel title="Engines" actions={<input className="input" style={{ width: 160, height: 24 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />}>
          <div className="flex flex-col gap-2">
            <div className="max-h-[170px] overflow-auto flex flex-col gap-0.5" data-testid="suite-engines">
              {shownEngines.length === 0 && <div className="muted text-[12px]">No engine in the library yet: add one in Engines.</div>}
              {shownEngines.map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-[12.5px] cursor-pointer">
                  <input type="checkbox" checked={picked.includes(e.id!)} onChange={(ev) => setPicked(ev.target.checked ? [...picked, e.id!] : picked.filter((x) => x !== e.id))} aria-label={e.display_name} />
                  <span className="truncate">{e.display_name}</span>
                  <span className="muted text-[11px] truncate">{e.build}</span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2">
              <Field label="Time / position">
                <select className="select" value={movetime} onChange={(e) => setMovetime(+e.target.value)} data-testid="suite-time">
                  {TIMES.map((t) => (
                    <option key={t} value={t}>
                      {secs(t)}
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
              <Field label="In parallel" hint="engine processes">
                <input className="input tnum" type="number" min={1} max={64} value={concurrency} onChange={(e) => setConcurrency(Math.max(1, +e.target.value))} />
              </Field>
            </div>
            {estimate > 0 && <div className="muted text-[11.5px]">About {estimate < 90 ? `${Math.ceil(estimate)} s` : `${Math.ceil(estimate / 60)} min`} at most (engines stop at the time limit).</div>}
          </div>
        </Panel>
      </div>
      {running && progress && (
        <Panel title="Running">
          <div className="flex items-center gap-3 text-[12.5px]">
            <Spinner />
            <span className="tnum">
              {progress.done} / {progress.total}
            </span>
            <div className="flex-1">
              <ProgressBar value={progress.done} max={Math.max(1, progress.total)} />
            </div>
          </div>
        </Panel>
      )}
      <Panel
        title="Results"
        noPad
        actions={
          <div className="flex items-center gap-2">
            <select className="select" style={{ height: 24, width: 260 }} value={shownId} onChange={(e) => setShownId(e.target.value)} aria-label="Run" data-testid="suite-run-select">
              <option value="current">{progress?.run ? `Last run: ${progress.run.suite}` : "Last run"}</option>
              {(history ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.created_at.slice(0, 16).replace("T", " ")} · {h.suite} · {secs(h.movetime_ms)}
                </option>
              ))}
            </select>
            {shownId !== "current" && (
              <button className="btn btn-sm btn-ghost btn-icon" aria-label="Delete this run" onClick={() => del(shownId)}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        }
      >
        {!run ? (
          <div className="p-3">
            <Empty icon={<Puzzle size={18} />}>Pick the positions and the engines, then press Run. Every engine searches every position for the time chosen; a position is solved when the final move is a solution (or a mate as short as asked).</Empty>
          </div>
        ) : (
          <SuiteResults run={run} sel={sel} setSel={setSel} />
        )}
      </Panel>
    </div>
  );
}

function SuiteResults({ run, sel, setSel }: { run: SuiteRun; sel: number; setSel: (i: number) => void }) {
  const p = run.positions[Math.min(sel, run.positions.length - 1)];
  const arrows: Arrow[] = [];
  if (p) {
    for (const m of p.bm_uci) arrows.push({ uci: m, brush: "green" });
    for (const m of p.am_uci) arrows.push({ uci: m, brush: "red" });
    run.engines.forEach((e, i) => {
      const r = e.results[sel];
      if (r && r.bestmove && !p.bm_uci.includes(r.bestmove)) arrows.push({ uci: r.bestmove, brush: r.solved ? "paleGreen" : ENGINE_ARROWS[i % ENGINE_ARROWS.length] });
    });
  }
  return (
    <div className="grid gap-3 p-3 cols-main-side">
      <div className="overflow-auto" style={{ maxHeight: 520 }}>
        <table className="tbl" data-testid="suite-results">
          <thead>
            <tr>
              <th>Position</th>
              <th>Task</th>
              {run.engines.map((e) => (
                <th key={e.engine_id}>{e.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.positions.map((pos, i) => (
              <tr key={i} className="clickable" onClick={() => setSel(i)} style={i === sel ? { background: "var(--accent-bg)" } : undefined}>
                <td className="font-medium">{pos.id}</td>
                <td className="muted text-[11.5px]">
                  {pos.bm.length ? `bm ${pos.bm.join(" ")}` : ""}
                  {pos.am.length ? ` am ${pos.am.join(" ")}` : ""}
                  {pos.dm != null ? ` · mate in ${pos.dm}` : ""}
                </td>
                {run.engines.map((e) => {
                  const r = e.results[i];
                  if (!r) return <td key={e.engine_id} className="muted">…</td>;
                  if (r.error)
                    return (
                      <td key={e.engine_id} className="l" title={r.error}>
                        error
                      </td>
                    );
                  return (
                    <td key={e.engine_id} title={`${r.bestmove_san} · ${evalText(r.score.cp, r.score.mate)} · depth ${r.depth}`}>
                      {r.solved ? (
                        <span className="w inline-flex items-center gap-1">
                          <CheckCircle2 size={12} /> {secs(r.solved_at_ms)}
                        </span>
                      ) : (
                        <span className="l inline-flex items-center gap-1">
                          <XCircle size={12} /> {r.bestmove_san}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                Solved · {run.positions.length} positions · {secs(run.movetime_ms)} each{!run.finished && run.engines.some((e) => e.results.some((r) => !r)) ? " · stopped" : ""}
              </td>
              {run.engines.map((e) => (
                <td key={e.engine_id} data-testid="suite-solved">
                  {e.solved}/{run.positions.length} <span className="muted">({Math.round((100 * e.solved) / Math.max(1, run.positions.length))}%)</span>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
        {run.engines.length > 1 && (
          <div className="muted text-[11.5px] mt-2">Ties on solved positions are broken by the total solve time: {run.engines.map((e) => `${e.name} ${secs(e.solve_time_ms)}`).join(" · ")}</div>
        )}
      </div>
      {p && (
        <div className="flex flex-col gap-2">
          <div className="text-[12.5px]">
            <b>{p.id}</b> <span className="muted">· {p.fen.split(" ")[1] === "w" ? "White" : "Black"} to move</span>
          </div>
          <div style={{ maxWidth: 380 }}>
            <Board fen={p.fen} orientation={p.fen.split(" ")[1] === "b" ? "black" : "white"} arrows={arrows} />
          </div>
          <div className="text-[12px] flex flex-col gap-0.5">
            {p.bm.length > 0 && (
              <div>
                <span className="w">■</span> Solution: <b>{p.bm.join(", ")}</b>
              </div>
            )}
            {p.am.length > 0 && (
              <div>
                <span className="l">■</span> Avoid: <b>{p.am.join(", ")}</b>
              </div>
            )}
            {p.dm != null && <div>Mate in {p.dm}</div>}
            {run.engines.map((e) => {
              const r = e.results[sel];
              return (
                <div key={e.engine_id} className="muted">
                  {e.name}: {r ? (r.error ? r.error : `${r.bestmove_san} (${evalText(r.score.cp, r.score.mate)}, depth ${r.depth})`) : "…"}
                </div>
              );
            })}
            <div className="mono muted text-[10.5px] break-all mt-1">{p.fen}</div>
          </div>
        </div>
      )}
    </div>
  );
}
