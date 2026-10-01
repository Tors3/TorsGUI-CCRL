import { Calculator, Check, ListPlus, Play, Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { EngineEntry } from "../bindings/EngineEntry";
import type { NominalTc } from "../bindings/NominalTc";
import type { Participant } from "../bindings/Participant";
import type { Placement } from "../bindings/Placement";
import type { RatingLookup } from "../bindings/RatingLookup";
import type { Settings } from "../bindings/Settings";
import type { Suggestion } from "../bindings/Suggestion";
import type { TcResult } from "../bindings/TcResult";
import type { Topology } from "../bindings/Topology";
import type { TournamentConfig } from "../bindings/TournamentConfig";
import type { TournamentKind } from "../bindings/TournamentKind";
import type { TournamentRecord } from "../bindings/TournamentRecord";
import type { Variant } from "../bindings/Variant";
import type { BookSpec } from "../bindings/BookSpec";
import type { WizardPreview } from "../bindings/WizardPreview";
import { ErrorBox, Field, Modal, PageHeader, Panel, Seg, Spinner, Tip, Warn } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { duration, num } from "../lib/format";

const KIND_LABEL: Record<TournamentKind, string> = { gauntlet: "gauntlet", multi_gauntlet: "gauntlet", round_robin: "round robin", match: "match" };

function splitOpenings(games: number, passes: number, nodes: number): number[] | null {
  if (games <= 0 || games % 2 || games % (passes * 2)) return null;
  const o = games / (passes * 2);
  if (o < nodes) return null;
  return Array.from({ length: nodes }, (_, i) => Math.floor(o / nodes) + (i < o % nodes ? 1 : 0));
}

export function Wizard() {
  const nav = useNavigate();
  const { data: engines } = usePoll<EngineEntry[]>("engines_list", {}, 0);
  const { data: topo } = usePoll<Topology>("topology", {}, 0);
  const { data: settings } = usePoll<Settings>("settings_get", {}, 0);
  const { data: presets } = usePoll<NominalTc[]>("tc_presets", {}, 0);
  const { data: books } = usePoll<{ path: string; name: string; positions: number; default: boolean }[]>("books_list", {}, 0);

  const [kind, setKind] = useState<TournamentKind>("gauntlet");
  const [list, setList] = useState("Blitz");
  const [variant, setVariant] = useState<Variant>("standard");
  const [frcOpen, setFrcOpen] = useState(false);
  const [frcSpec, setFrcSpec] = useState<BookSpec>({ kind: "all", count: 200, seed: 1, include_standard: false });
  const [seeds, setSeeds] = useState<number[]>([]);
  const [opps, setOpps] = useState<number[]>([]);
  const [threads, setThreads] = useState(1);
  const [hash, setHash] = useState(512);
  const [hashAuto, setHashAuto] = useState(true);
  const [tc, setTc] = useState("103+1");
  const [nominal, setNominal] = useState("blitz");
  const [factor, setFactor] = useState(0.86);
  const [games, setGames] = useState(30);
  const [passes, setPasses] = useState(1);
  const [nodes, setNodes] = useState<number[]>([0]);
  const [lanes, setLanes] = useState(1);
  const [placement, setPlacement] = useState<Placement>("node");
  const [book, setBook] = useState("");
  const [bookStart, setBookStart] = useState(1);
  const [syzygy, setSyzygy] = useState("");
  const [site, setSite] = useState("");
  const [eventName, setEventName] = useState("");
  const [eventAuto, setEventAuto] = useState(true);
  const [adj, setAdj] = useState<TournamentConfig["adjudication"] | null>(null);
  const [extra, setExtra] = useState("");
  const [ratings, setRatings] = useState<Record<string, RatingLookup>>({});
  const [preview, setPreview] = useState<WizardPreview>();
  const [busy, setBusy] = useState(false);
  const [suggest, setSuggest] = useState<Suggestion[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!settings) return;
    setBook((b) => b || settings.default_book);
    setSyzygy((s) => s || settings.syzygy_path);
    setSite((s) => s || settings.site);
    setAdj((a) => a ?? settings.adjudication);
    setFactor((f) => (f === 0.86 && settings.default_factor !== 1 ? settings.default_factor : f));
  }, [settings]);
  useEffect(() => {
    if (!topo) return;
    setNodes(topo.nodes.map((n) => n.id));
  }, [topo]);
  useEffect(() => {
    if (hashAuto) setHash((settings?.hash_per_thread_mb ?? 512) * threads);
  }, [threads, hashAuto, settings]);
  useEffect(() => {
    if (!topo) return;
    const n = topo.nodes.find((x) => x.id === nodes[0]);
    if (n) setLanes(Math.max(1, Math.floor(n.physical_cores / (2 * threads))));
  }, [threads, topo, nodes]);

  // Chess960 needs start positions: generate the default book (all 960, seed 1) when the
  // current book is not an EPD
  useEffect(() => {
    if (variant !== "chess960" || book.toLowerCase().endsWith(".epd")) return;
    call<{ path: string }>("chess960_book", { spec: { kind: "all", count: 960, seed: 1, include_standard: false } })
      .then((r) => setBook(r.path))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);
  useEffect(() => {
    if (variant === "standard" && book.toLowerCase().endsWith(".epd") && /chess960|dfrc/i.test(book) && settings?.default_book) setBook(settings.default_book);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  const byId = useMemo(() => new Map((engines ?? []).map((e) => [e.id!, e])), [engines]);
  const seedEngines = seeds.map((i) => byId.get(i)).filter(Boolean) as EngineEntry[];
  const oppEngines = opps.map((i) => byId.get(i)).filter(Boolean) as EngineEntry[];
  const kindLabel = KIND_LABEL[kind];
  const autoEvent = kind === "round_robin" ? `CCRL ${list} round robin ${threads}CPU` : `CCRL ${list} ${kindLabel} ${seedEngines.map((e) => e.display_name).join(" + ") || "<seed>"} ${threads}CPU`;
  useEffect(() => {
    if (eventAuto) setEventName(autoEvent);
  }, [autoEvent, eventAuto]);

  // ratings of the selected engines in the target list / CPU category
  const names = (engines ?? []).map((e) => e.display_name);
  useEffect(() => {
    if (!names.length) return;
    call<RatingLookup[]>("ccrl_ratings", { list, cpus: threads, names })
      .then((r) => setRatings(Object.fromEntries(r.map((x) => [x.name, x]))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(names), list, threads]);

  const rpp = splitOpenings(games, passes, Math.max(1, nodes.length));
  const toParticipant = (e: EngineEntry, role: "seed" | "opponent"): Participant => {
    const opts: Record<string, string> = { Threads: "${THREADS}", Hash: "${HASH}", ...e.default_options };
    const r = ratings[e.display_name];
    return { name: e.display_name, cmd: e.path, dir: e.dir, args: "", options: opts, role, engine_id: e.id, has_syzygy: e.has_syzygy, uci_id: e.uci_id, rating: r?.rating ?? null, rating_estimated: r?.estimated ?? false };
  };
  const config: TournamentConfig | null = adj
    ? {
        name: eventName.replace(/^CCRL /, "") || "Tournament",
        kind,
        participants: kind === "round_robin" || kind === "match" ? [...seedEngines, ...oppEngines].map((e, i) => toParticipant(e, i === 0 ? "seed" : "opponent")) : [...seedEngines.map((e) => toParticipant(e, "seed")), ...oppEngines.map((e) => toParticipant(e, "opponent"))],
        games_per_pairing: games,
        passes,
        play_passes: null,
        nodes: nodes.length ? nodes : [0],
        rounds_per_pass: rpp ?? [1],
        lanes_per_node: lanes,
        concurrency: 1,
        threads,
        hash_mb: hash,
        tc,
        book,
        book_format: book.toLowerCase().endsWith(".epd") ? "epd" : "pgn",
        book_start: bookStart,
        event: eventName,
        site,
        syzygy_path: syzygy,
        adjudication: adj,
        extra_args: extra.split(/\s+/).filter(Boolean),
        placement,
        log_level: "info",
        ccrl_list: list,
        max_retries: 2,
        max_slot_attempts: 3,
        fastchess: "",
        startup_ms: 60000,
        variant,
      }
    : null;
  const cfgKey = JSON.stringify(config);
  useEffect(() => {
    if (!config) return;
    const t = setTimeout(() => {
      call<WizardPreview>("wizard_preview", { config }).then(setPreview).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey]);

  const computeTc = async () => {
    const n = presets?.find((p) => p.id === nominal);
    if (!n) return;
    try {
      const r = await call<TcResult>("tc_compute", { nominal: n, factor, base_formula: settings?.tc_base_formula, inc_formula: settings?.tc_inc_formula });
      setTc(r.fastchess);
      toast.success(`${n.label} × ${factor} → ${r.fastchess} (${r.human})`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const doSuggest = async () => {
    try {
      const s = await call<Suggestion[]>("ccrl_suggest", { list, cpus: threads, top: 30, threads, only_installed: true, exclude: seedEngines.map((e) => e.display_name) });
      setSuggest(s);
      const ids = s.map((x) => x.installed_engine_id).filter((x): x is number => x != null && !seeds.includes(x));
      setOpps(ids);
      toast.success(`${ids.length} opponents selected from the CCRL ${list} ${threads}CPU list`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const create = async (mode: "draft" | "queue" | "start") => {
    if (!config) return;
    setBusy(true);
    try {
      const rec = await call<TournamentRecord>("tournament_create", { config, enqueue: mode === "queue" });
      if (mode === "start") await call("tournament_start", { id: rec.id });
      toast.success(`${rec.name}: ${rec.expected_games} games ${mode === "queue" ? "queued" : mode === "start" ? "started" : "created"}`);
      nav(`/tournaments/${encodeURIComponent(rec.id)}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (arr: number[], set: (v: number[]) => void, id: number) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const filtered = (engines ?? []).filter((e) => !q || e.display_name.toLowerCase().includes(q.toLowerCase()));
  const multiSeed = kind === "multi_gauntlet";
  const seedMode = kind === "gauntlet" || kind === "multi_gauntlet";

  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader help="create-a-gauntlet" title="New tournament" sub="Every opening is played twice with colours reversed; openings are split into disjoint blocks per node, pass and pairing." />
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 360px" }}>
        <div className="flex flex-col gap-3 min-w-0">
          <Panel title="1 · Type">
            <div className="grid grid-cols-4 gap-3 items-end">
              <Field label="Tournament type">
                <Seg
                  value={kind}
                  onChange={(k) => {
                    setKind(k);
                    if (k !== "multi_gauntlet" && seeds.length > 1) setSeeds(seeds.slice(0, 1));
                  }}
                  options={[
                    { value: "gauntlet", label: "Gauntlet" },
                    { value: "multi_gauntlet", label: "Multi-seed" },
                    { value: "round_robin", label: "Round robin" },
                    { value: "match", label: "Match" },
                  ]}
                />
              </Field>
              <Field label="CCRL list">
                <Seg
                  value={list}
                  onChange={(l) => {
                    setList(l);
                    if (l === "FRC") {
                      setVariant("chess960");
                      setNominal("40/2");
                    } else if (list === "FRC") {
                      setVariant("standard");
                      setNominal(l === "40/15" ? "40/15" : "blitz");
                    }
                  }}
                  options={[{ value: "Blitz", label: "Blitz" }, { value: "40/15", label: "40/15" }, { value: "FRC", label: "FRC (960)" }]}
                />
              </Field>
              <Field label="Variant" hint={variant === "chess960" ? "Fischer Random: engines get UCI_Chess960, openings are start positions" : undefined}>
                <Seg value={variant} onChange={setVariant} options={[{ value: "standard", label: "Standard" }, { value: "chess960", label: "Chess960" }]} />
              </Field>
              <Field label="Event" className="col-span-2" hint={eventAuto ? "automatic (CCRL naming)" : <button className="underline" onClick={() => setEventAuto(true)}>reset to automatic</button>}>
                <input className="input" value={eventName} onChange={(e) => { setEventAuto(false); setEventName(e.target.value); }} data-testid="event-name" />
              </Field>
            </div>
          </Panel>
          <Panel
            title={`2 · Engines — ${seedMode ? `${seedEngines.length} seed${multiSeed ? "s" : ""}, ${oppEngines.length} opponents` : `${seedEngines.length + oppEngines.length} engines`}`}
            actions={
              <>
                <input className="input" style={{ width: 180 }} placeholder="Filter engines" value={q} onChange={(e) => setQ(e.target.value)} />
                {seedMode && (
                  <Tip content={`Top engines of the CCRL ${list} ${threads}CPU list (latest version in the list) that are installed and support ${threads} threads`}>
                    <button className="btn btn-sm" onClick={doSuggest}>
                      <Sparkles size={13} /> Suggest opponents
                    </button>
                  </Tip>
                )}
              </>
            }
            noPad
          >
            <div className="overflow-auto" style={{ maxHeight: 300 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    {seedMode && <th>Seed</th>}
                    <th>{seedMode ? "Opponent" : "Plays"}</th>
                    <th>Engine</th>
                    <th>Build</th>
                    <th className="r">Threads max</th>
                    <th>Syzygy</th>
                    <th>960</th>
                    <th className="r">Rating ({threads}CPU)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const r = ratings[e.display_name];
                    const tooFew = e.threads_max != null && e.threads_max < threads;
                    return (
                      <tr key={e.id}>
                        {seedMode && (
                          <td>
                            <input
                              type={multiSeed ? "checkbox" : "radio"}
                              name="seed"
                              checked={seeds.includes(e.id!)}
                              onChange={() => (multiSeed ? toggle(seeds, setSeeds, e.id!) : setSeeds([e.id!]))}
                              aria-label={`seed ${e.display_name}`}
                            />
                          </td>
                        )}
                        <td>
                          <input type="checkbox" checked={opps.includes(e.id!)} disabled={seeds.includes(e.id!)} onChange={() => toggle(opps, setOpps, e.id!)} aria-label={`opponent ${e.display_name}`} />
                        </td>
                        <td className="font-medium">{e.display_name}</td>
                        <td className="mono">{e.build || "—"}</td>
                        <td className="r" style={{ color: tooFew ? "var(--loss)" : undefined }}>
                          {e.threads_max ?? "?"}
                        </td>
                        <td>{e.has_syzygy ? "yes" : <span className="muted">no</span>}</td>
                        <td>{e.chess960 ? <span className="chip chip-accent">960</span> : <span className="muted">—</span>}</td>
                        <td className="r tnum">
                          {r?.rating != null ? num(r.rating) : <span className="muted">—</span>}
                          {r?.estimated && <span className="chip chip-warn ml-1" title={r.note}>est.</span>}
                        </td>
                        <td>
                          {!e.path ? (
                            <span className="chip chip-loss" title="metadata only: set the executable in Engines">no binary</span>
                          ) : tooFew ? (
                            <span className="chip chip-loss">max {e.threads_max} threads</span>
                          ) : variant === "chess960" && !e.chess960 && e.options.length > 0 ? (
                            <span className="chip chip-loss" title="the engine does not declare UCI_Chess960">no Chess960</span>
                          ) : e.verify_status === "ok" ? (
                            <span className="chip chip-win">verified</span>
                          ) : (
                            <span className="chip chip-warn">{e.verify_status || "unverified"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted">
                        The engine library is empty: add engines first (Engines → Add from GitHub).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {suggest.length > 0 && <div className="px-3 py-2 muted text-[12px]">Suggested: {suggest.map((s) => `${s.rank}. ${s.list_name} (${num(s.rating)})`).join(" · ")}</div>}
          </Panel>
          <Panel title="3 · Conditions">
            <div className="grid grid-cols-6 gap-3">
              <Field label="Threads / engine">
                <input className="input tnum" type="number" min={1} value={threads} onChange={(e) => setThreads(Math.max(1, +e.target.value))} />
              </Field>
              <Field label="Hash (MB)" hint={hashAuto ? `${settings?.hash_per_thread_mb ?? 512} MB × threads` : <button className="underline" onClick={() => setHashAuto(true)}>automatic</button>}>
                <input className="input tnum" type="number" value={hash} onChange={(e) => { setHashAuto(false); setHash(+e.target.value); }} />
              </Field>
              <Field label="Games / pairing" hint={rpp ? `${games / 2} openings × 2 colours` : "must be a multiple of passes × 2"}>
                <input className="input tnum" type="number" step={2} min={2} value={games} onChange={(e) => setGames(+e.target.value)} data-testid="games-per-pairing" />
              </Field>
              <Field label="Passes" hint="openings of pass 2 follow pass 1">
                <input className="input tnum" type="number" min={1} value={passes} onChange={(e) => setPasses(Math.max(1, +e.target.value))} />
              </Field>
              <Field label="Time control (fastchess)" className="col-span-2">
                <div className="flex gap-1.5">
                  <input className="input mono" value={tc} onChange={(e) => setTc(e.target.value)} data-testid="tc" />
                </div>
              </Field>
              <Field label="CCRL nominal TC" className="col-span-2">
                <select className="select" value={nominal} onChange={(e) => setNominal(e.target.value)}>
                  {(presets ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Machine factor" hint="from the bench">
                <input className="input tnum" type="number" step={0.001} value={factor} onChange={(e) => setFactor(+e.target.value)} />
              </Field>
              <div className="flex items-end">
                <button className="btn w-full justify-center" onClick={computeTc}>
                  <Calculator size={13} /> Local TC
                </button>
              </div>
              <Field
                label={variant === "chess960" ? "Start positions (EPD)" : "Opening book (PGN/EPD)"}
                className="col-span-2"
                hint={
                  variant === "chess960" ? (
                    <button className="underline" onClick={() => setFrcOpen(true)} data-testid="frc-generate">
                      generate Chess960 positions…
                    </button>
                  ) : undefined
                }
              >
                <div className="flex gap-2">
                  {variant !== "chess960" && (books ?? []).length > 0 && (
                    <select className="select !w-[230px] shrink-0" value={(books ?? []).find((b) => b.path === book)?.path ?? ""} onChange={(e) => e.target.value && setBook(e.target.value)} aria-label="Installed books" data-testid="book-select">
                      <option value="">Installed books…</option>
                      {(books ?? []).map((b) => (
                        <option key={b.path} value={b.path}>
                          {b.name} ({num(b.positions)})
                        </option>
                      ))}
                    </select>
                  )}
                  <input className="input mono" value={book} onChange={(e) => setBook(e.target.value)} placeholder={variant === "chess960" ? "chess960-all-seed1.epd" : "C:\\CCRL\\books\\AVT2026d.pgn"} data-testid="book" />
                </div>
              </Field>
              <Field label="Book start">
                <input className="input tnum" type="number" min={1} value={bookStart} onChange={(e) => setBookStart(Math.max(1, +e.target.value))} />
              </Field>
              <Field label="Syzygy path (engines)" className="col-span-2">
                <input className="input mono" value={syzygy} onChange={(e) => setSyzygy(e.target.value)} />
              </Field>
              <Field label="Site">
                <input className="input" value={site} onChange={(e) => setSite(e.target.value)} />
              </Field>
            </div>
            {adj && (
              <div className="grid grid-cols-6 gap-3 mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                <label className="flex items-center gap-2 col-span-2">
                  <input type="checkbox" checked={adj.draw_enabled} onChange={(e) => setAdj({ ...adj, draw_enabled: e.target.checked })} /> Draw adjudication
                </label>
                <Field label="from move">
                  <input className="input tnum" type="number" value={adj.draw_movenumber} onChange={(e) => setAdj({ ...adj, draw_movenumber: +e.target.value })} />
                </Field>
                <Field label="moves">
                  <input className="input tnum" type="number" value={adj.draw_movecount} onChange={(e) => setAdj({ ...adj, draw_movecount: +e.target.value })} />
                </Field>
                <Field label="|score| ≤ cp">
                  <input className="input tnum" type="number" value={adj.draw_score} onChange={(e) => setAdj({ ...adj, draw_score: +e.target.value })} />
                </Field>
                <div />
                <label className="flex items-center gap-2 col-span-2">
                  <input type="checkbox" checked={adj.resign_enabled} onChange={(e) => setAdj({ ...adj, resign_enabled: e.target.checked })} /> Resign adjudication
                </label>
                <Field label="moves">
                  <input className="input tnum" type="number" value={adj.resign_movecount} onChange={(e) => setAdj({ ...adj, resign_movecount: +e.target.value })} />
                </Field>
                <Field label="|score| ≥ cp">
                  <input className="input tnum" type="number" value={adj.resign_score} onChange={(e) => setAdj({ ...adj, resign_score: +e.target.value })} />
                </Field>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={adj.resign_twosided} onChange={(e) => setAdj({ ...adj, resign_twosided: e.target.checked })} /> two-sided
                </label>
                <Field label="Extra fastchess args">
                  <input className="input mono" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="-ucinewgame-ms 60000" />
                </Field>
              </div>
            )}
          </Panel>
          <Panel title="4 · NUMA placement">
            <div className="grid grid-cols-4 gap-3 items-end">
              <Field label="Nodes">
                <div className="flex gap-2 flex-wrap">
                  {(topo?.nodes ?? []).map((n) => (
                    <label key={n.id} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={nodes.includes(n.id)} onChange={() => setNodes(nodes.includes(n.id) ? nodes.filter((x) => x !== n.id) : [...nodes, n.id].sort())} />
                      node {n.id} <span className="muted">({n.physical_cores}c)</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Lanes per node" hint={`suggested: cores / (2 × threads) = ${topo?.nodes[0] ? Math.max(1, Math.floor(topo.nodes[0].physical_cores / (2 * threads))) : "?"}`}>
                <input className="input tnum" type="number" min={1} value={lanes} onChange={(e) => setLanes(Math.max(1, +e.target.value))} />
              </Field>
              <Field label="Placement" className="col-span-2">
                <Seg value={placement} onChange={setPlacement} options={[{ value: "node", label: "Node (1 thread / core)" }, { value: "lane", label: "Disjoint cores per lane" }, { value: "none", label: "None" }]} />
              </Field>
            </div>
          </Panel>
        </div>
        <div className="flex flex-col gap-3">
          <div className="sticky top-0 flex flex-col gap-3">
            <Panel title="Summary">
              {!preview ? (
                <Spinner />
              ) : (
                <div className="flex flex-col gap-2 text-[12.5px]" data-testid="wizard-summary">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="kpi-label">Total games</div>
                      <div className="kpi-value" data-testid="total-games">
                        {num(preview.total_games)}
                      </div>
                    </div>
                    <div>
                      <div className="kpi-label">ETA</div>
                      <div className="kpi-value">{duration(preview.eta_s)}</div>
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">Pairings</span>
                    <span className="tnum">
                      {preview.pairings} × {preview.games_per_pairing}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">Openings per pass / node</span>
                    <span className="tnum">{preview.rounds_per_pass.join(", ")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">Openings used</span>
                    <span className="tnum">
                      {preview.openings_used} (up to #{preview.last_opening})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">Concurrent games</span>
                    <span className="tnum">{preview.concurrent_games}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">Cores</span>
                    <span className="tnum" style={{ color: preview.physical_cores && preview.busy_threads > preview.physical_cores ? "var(--loss)" : undefined }}>
                      {preview.busy_threads} busy / {preview.physical_cores} physical
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">RAM</span>
                    <span className="tnum" style={{ color: preview.ram_needed_mb > preview.ram_total_mb * 0.85 ? "var(--loss)" : undefined }}>
                      {(preview.ram_needed_mb / 1024).toFixed(1)} / {(preview.ram_total_mb / 1024).toFixed(0)} GB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">Est. game</span>
                    <span className="tnum">{duration(preview.est_game_s)}</span>
                  </div>
                  {preview.event_example && <div className="mono text-[11px] muted break-all">Event: {preview.event_example}</div>}
                  {preview.errors.map((e, i) => (
                    <ErrorBox key={i} error={e} />
                  ))}
                  {preview.warnings.map((w, i) => (
                    <Warn key={i}>{w}</Warn>
                  ))}
                  {preview.errors.length === 0 && (
                    <div className="flex items-center gap-1.5" style={{ color: "var(--win)" }}>
                      <Check size={14} /> Ready
                    </div>
                  )}
                </div>
              )}
            </Panel>
            <div className="flex flex-col gap-2">
              <button className="btn btn-primary justify-center h-9" disabled={busy || !preview || preview.errors.length > 0} onClick={() => create("start")} data-testid="create-start">
                <Play size={14} /> Create and start
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn justify-center" disabled={busy || !preview || preview.errors.length > 0} onClick={() => create("queue")}>
                  <ListPlus size={14} /> Create &amp; queue
                </button>
                <button className="btn justify-center" disabled={busy || !preview || preview.errors.length > 0} onClick={() => create("draft")} data-testid="create-draft">
                  <Plus size={14} /> Save draft
                </button>
              </div>
            </div>
            {preview?.first_command && (
              <Panel title="First game command">
                <pre className="mono text-[10.5px] whitespace-pre-wrap break-all max-h-[180px] overflow-auto">{preview.first_command}</pre>
              </Panel>
            )}
          </div>
        </div>
      </div>
      <Modal
        open={frcOpen}
        onOpenChange={setFrcOpen}
        title="Chess960 start positions"
        footer={
          <button
            className="btn btn-primary"
            data-testid="frc-create"
            onClick={async () => {
              try {
                const r = await call<{ path: string; positions: number }>("chess960_book", { spec: frcSpec });
                setBook(r.path);
                setFrcOpen(false);
                toast.success(`${r.positions} start positions: ${r.path.split(/[\\/]/).pop()}`);
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Generate book
          </button>
        }
      >
        <div className="flex flex-col gap-3 text-[12.5px]">
          <Seg
            value={frcSpec.kind}
            onChange={(k) => setFrcSpec({ ...frcSpec, kind: k })}
            options={[
              { value: "all", label: "All 960" },
              { value: "random", label: "Random set" },
              { value: "double", label: "Double 960" },
            ]}
          />
          <div className="muted">
            {frcSpec.kind === "all"
              ? "Every Chess960 start position once (shuffled with the seed), each played with both colours."
              : frcSpec.kind === "random"
                ? "A random set of distinct start positions."
                : "Double Chess960 (DFRC): White and Black get different random setups."}{" "}
            The same seed always gives the same book, on every machine.
          </div>
          <div className="grid grid-cols-3 gap-3">
            {frcSpec.kind !== "all" && (
              <Field label="Positions">
                <input className="input tnum" type="number" min={1} value={frcSpec.count} onChange={(e) => setFrcSpec({ ...frcSpec, count: Math.max(1, +e.target.value) })} />
              </Field>
            )}
            <Field label="Seed">
              <input className="input tnum" type="number" min={0} value={frcSpec.seed} onChange={(e) => setFrcSpec({ ...frcSpec, seed: Math.max(0, +e.target.value) })} />
            </Field>
            <label className="flex items-end gap-2 pb-1.5">
              <input type="checkbox" checked={frcSpec.include_standard} onChange={(e) => setFrcSpec({ ...frcSpec, include_standard: e.target.checked })} /> include the standard position (518)
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}
