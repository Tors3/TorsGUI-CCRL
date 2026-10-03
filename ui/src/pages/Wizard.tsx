import { Calculator, Check, Crosshair, ListPlus, Play, Plus, Save, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import type { TournamentDetail } from "../bindings/TournamentDetail";
import type { TournamentRecord } from "../bindings/TournamentRecord";
import type { Variant } from "../bindings/Variant";
import type { BookSpec } from "../bindings/BookSpec";
import type { WizardPreview } from "../bindings/WizardPreview";
import { UciOptionsEditor } from "../components/UciOptions";
import { cmpNum, EloCell, matchesEngine, SortTh, useEngineRatings, type RatingList, type SortDir } from "../components/EngineRatings";
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
  // /tournaments/:id/edit: the same screen edits a tournament that has not played yet
  const { id: editId } = useParams();
  const [editing, setEditing] = useState<TournamentRecord | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const keepLanes = useRef(false);
  const [castLichess, setCastLichess] = useState(false);
  const [castCcrl, setCastCcrl] = useState(false);
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
  const [sort, setSort] = useState<["name" | "rating" | "near", SortDir]>(["name", "asc"]);
  const [eloMin, setEloMin] = useState("");
  const [eloMax, setEloMax] = useState("");
  const { ratings: libRatings } = useEngineRatings();
  // UCI options of the engines in this tournament (they start from Engines → Edit)
  const [partOpts, setPartOpts] = useState<Record<number, Record<string, string>>>({});
  const [optsFor, setOptsFor] = useState<EngineEntry | null>(null);
  const [optsDraft, setOptsDraft] = useState<Record<string, string>>({});
  const [optsRev, setOptsRev] = useState(0);

  useEffect(() => {
    if (!settings) return;
    setBook((b) => b || settings.default_book);
    setSyzygy((s) => s || settings.syzygy_path);
    setSite((s) => s || settings.site);
    setAdj((a) => a ?? settings.adjudication);
    setFactor((f) => (f === 0.86 && settings.default_factor !== 1 ? settings.default_factor : f));
  }, [settings]);
  useEffect(() => {
    if (!topo || editId) return;
    setNodes(topo.nodes.map((n) => n.id));
  }, [topo, editId]);
  useEffect(() => {
    if (hashAuto) setHash((settings?.hash_per_thread_mb ?? 512) * threads);
  }, [threads, hashAuto, settings]);
  useEffect(() => {
    if (!topo) return;
    if (keepLanes.current) {
      keepLanes.current = false;
      return;
    }
    const n = topo.nodes.find((x) => x.id === nodes[0]);
    if (n) setLanes(Math.max(1, Math.floor(n.physical_cores / (2 * threads))));
  }, [threads, topo, nodes]);

  // edit mode: load the tournament once the engines, the topology and the settings are known
  useEffect(() => {
    if (!editId || editing || !engines || !topo || !settings) return;
    call<TournamentDetail>("tournament_get", { id: editId, order: "config" })
      .then((d) => {
        const r = d.summary.record;
        if (r.imported) throw new Error("imported tournaments are read-only");
        if (r.state === "running") throw new Error("pause or stop the tournament before editing it");
        if (d.summary.progress.done > 0) throw new Error("games were already played: only tournaments that have not started can be edited here");
        const c = r.config;
        const ids = new Set(engines.map((e) => e.id));
        const pick = (role: string) => c.participants.filter((p) => p.role === role && p.engine_id != null && ids.has(p.engine_id)).map((p) => p.engine_id!);
        const missing = c.participants.filter((p) => p.engine_id == null || !ids.has(p.engine_id)).map((p) => p.name);
        if (missing.length) toast.warning(`Not in the engine library any more: ${missing.join(", ")}`);
        keepLanes.current = true;
        setKind(c.kind);
        setList(c.ccrl_list || "Blitz");
        setVariant(c.variant);
        setSeeds(pick("seed"));
        setOpps(pick("opponent"));
        setThreads(c.threads);
        setHashAuto(c.hash_mb === (settings.hash_per_thread_mb ?? 512) * c.threads);
        setHash(c.hash_mb);
        setTc(c.tc);
        setGames(c.games_per_pairing);
        setPasses(c.passes);
        setNodes(c.nodes);
        setLanes(c.lanes_per_node);
        setPlacement(c.placement);
        setBook(c.book);
        setBookStart(c.book_start);
        setSyzygy(c.syzygy_path);
        setSite(c.site);
        setEventAuto(false);
        setEventName(c.event);
        setAdj(c.adjudication);
        setExtra(c.extra_args.join(" "));
        setEditing(r);
        call<{ config: { lichess: boolean; ccrl_live: boolean } }>("broadcast_get", { id: r.id })
          .then((b) => {
            setCastLichess(b.config.lichess);
            setCastCcrl(b.config.ccrl_live);
          })
          .catch(() => {});
      })
      .catch((e) => setEditError((e as Error).message));
  }, [editId, editing, engines, topo, settings]);

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
  const baseOptions = (e: EngineEntry): Record<string, string> => {
    const was = editing?.config.participants.find((p) => p.engine_id === e.id);
    return was ? { ...was.options } : { Threads: "${THREADS}", Hash: "${HASH}", ...e.default_options };
  };
  const customOpts = (e: EngineEntry) => {
    const o = partOpts[e.id!];
    return o != null && JSON.stringify(o) !== JSON.stringify(baseOptions(e));
  };
  const toParticipant = (e: EngineEntry, role: "seed" | "opponent"): Participant => {
    // an edited tournament keeps the options and arguments it had for this engine
    const was = editing?.config.participants.find((p) => p.engine_id === e.id);
    const opts: Record<string, string> = partOpts[e.id!] ?? baseOptions(e);
    const r = ratings[e.display_name];
    return { name: e.display_name, cmd: e.path, dir: e.dir, args: was?.args ?? e.args ?? "", options: opts, role, engine_id: e.id, has_syzygy: e.has_syzygy, uci_id: e.uci_id, rating: r?.rating ?? null, rating_estimated: r?.estimated ?? false };
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
      if (editing) {
        await call("broadcast_set", { id: editing.id, lichess: castLichess, ccrl_live: castCcrl });
        const rec = await call<TournamentRecord>("tournament_update", { id: editing.id, config: { ...editing.config, ...config, max_retries: editing.config.max_retries, max_slot_attempts: editing.config.max_slot_attempts, startup_ms: editing.config.startup_ms, fastchess: editing.config.fastchess, log_level: editing.config.log_level } });
        if (mode === "queue" && editing.state !== "queued") await call("queue_add", { id: rec.id });
        if (mode === "start") await call("tournament_start", { id: rec.id });
        toast.success(`${rec.name}: ${rec.expected_games} games, ${mode === "queue" ? "saved and queued" : mode === "start" ? "saved and started" : "changes saved"}`);
        nav(`/tournaments/${encodeURIComponent(rec.id)}`);
        return;
      }
      const rec = await call<TournamentRecord>("tournament_create", { config, enqueue: mode === "queue" });
      if (castLichess || castCcrl) {
        await call("broadcast_set", { id: rec.id, lichess: castLichess, ccrl_live: castCcrl }).catch((e) => toast.error((e as Error).message));
      }
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
  // rating in the target list and CPU category, else the CCRL rating shown in Engines
  const libRating = (e: EngineEntry) => libRatings.get(e.id!)?.[list as RatingList];
  const eloOf = (e: EngineEntry) => ratings[e.display_name]?.rating ?? libRating(e)?.rating ?? null;
  const seedElos = seedEngines.map(eloOf).filter((x): x is number => x != null);
  const seedElo = seedElos.length ? seedElos.reduce((a, b) => a + b, 0) / seedElos.length : null;
  const lo = eloMin.trim() ? +eloMin : null;
  const hi = eloMax.trim() ? +eloMax : null;
  const filtered = (engines ?? [])
    .filter((e) => matchesEngine(e, q))
    .filter((e) => {
      // the engines already chosen always stay visible
      if (seeds.includes(e.id!) || opps.includes(e.id!) || (lo == null && hi == null)) return true;
      const r = eloOf(e);
      return r != null && (lo == null || r >= lo) && (hi == null || r <= hi);
    })
    .sort((a, b) =>
      sort[0] === "name"
        ? (sort[1] === "asc" ? 1 : -1) * a.display_name.localeCompare(b.display_name, undefined, { numeric: true, sensitivity: "base" })
        : sort[0] === "near" && seedElo != null
          ? cmpNum(eloOf(a) == null ? null : Math.abs(eloOf(a)! - seedElo), eloOf(b) == null ? null : Math.abs(eloOf(b)! - seedElo), "asc")
          : cmpNum(eloOf(a), eloOf(b), sort[1]),
    );
  const multiSeed = kind === "multi_gauntlet";
  const seedMode = kind === "gauntlet" || kind === "multi_gauntlet";

  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader
        help="create-a-gauntlet"
        title={editId ? `Edit ${editing?.name ?? "tournament"}` : "New tournament"}
        sub={editId ? "Change anything before the first game; Save keeps it as it is (draft or queued), or save and queue / start it." : "Every opening is played twice with colours reversed; openings are split into disjoint blocks per node, pass and pairing."}
      />
      {editError && <ErrorBox error={editError} />}
      {editId && !editing && !editError && <div className="muted text-[12px]">Loading the tournament…</div>}
      <div className="grid gap-3 wizard-grid">
        <div className="flex flex-col gap-3 min-w-0">
          <Panel title="1 · Type">
            <div className="flex flex-wrap gap-3 items-end">
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
              <Field label="Event" className="flex-1 min-w-[280px]" hint={eventAuto ? "automatic (CCRL naming)" : <button className="underline" onClick={() => setEventAuto(true)}>reset to automatic</button>}>
                <input className="input" value={eventName} onChange={(e) => { setEventAuto(false); setEventName(e.target.value); }} data-testid="event-name" />
              </Field>
            </div>
          </Panel>
          <Panel
            title={`2 · Engines — ${seedMode ? `${seedEngines.length} seed${multiSeed ? "s" : ""}, ${oppEngines.length} opponents` : `${seedEngines.length + oppEngines.length} engines`}`}
            actions={
              <>
                <div className="relative">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 muted" />
                  <input className="input" style={{ width: 170, paddingLeft: 26 }} placeholder="Search engines" value={q} onChange={(e) => setQ(e.target.value)} data-testid="wizard-search" />
                </div>
                <Tip content={`Only engines rated in this range (CCRL ${list}); the engines already chosen stay visible`}>
                  <div className="flex items-center gap-1 text-[12px] muted">
                    Elo
                    <input className="input tnum" style={{ width: 64 }} placeholder="from" inputMode="numeric" value={eloMin} onChange={(e) => setEloMin(e.target.value.replace(/[^0-9]/g, ""))} data-testid="elo-min" />
                    –
                    <input className="input tnum" style={{ width: 64 }} placeholder="to" inputMode="numeric" value={eloMax} onChange={(e) => setEloMax(e.target.value.replace(/[^0-9]/g, ""))} data-testid="elo-max" />
                  </div>
                </Tip>
                {seedMode && (
                  <Tip content={seedElo != null ? `Sort by distance from the seed's rating (${num(seedElo)})` : "Choose a seed with a CCRL rating first"}>
                    <button className={`btn btn-sm ${sort[0] === "near" ? "btn-primary" : ""}`} disabled={seedElo == null} onClick={() => setSort(sort[0] === "near" ? ["rating", "desc"] : ["near", "asc"])} data-testid="sort-near">
                      <Crosshair size={13} /> Closest to seed
                    </button>
                  </Tip>
                )}
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
                    <SortTh k="name" sort={sort} setSort={setSort} first="asc">
                      Engine
                    </SortTh>
                    <th>Build</th>
                    <th className="r">Threads max</th>
                    <th>Syzygy</th>
                    <th>960</th>
                    <SortTh k="rating" sort={sort} setSort={setSort} right>
                      CCRL {list} ({threads}CPU)
                    </SortTh>
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
                        <td className="font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {e.display_name}
                            {(seeds.includes(e.id!) || opps.includes(e.id!)) && (
                              <Tip content="UCI options of this engine in this tournament (network file, contempt, …)">
                                <button
                                  className={`btn btn-sm ${customOpts(e) ? "btn-primary" : "btn-ghost"}`}
                                  onClick={() => {
                                    setOptsDraft(partOpts[e.id!] ?? baseOptions(e));
                                    setOptsFor(e);
                                  }}
                                  data-testid={`wizard-options-${e.id}`}
                                >
                                  <SlidersHorizontal size={12} /> {customOpts(e) ? "custom options" : "options"}
                                </button>
                              </Tip>
                            )}
                          </span>
                        </td>
                        <td className="mono truncate max-w-[180px]" title={e.build}>{e.build || "—"}</td>
                        <td className="r" style={{ color: tooFew ? "var(--loss)" : undefined }}>
                          {e.threads_max ?? "?"}
                        </td>
                        <td>{e.has_syzygy ? "yes" : <span className="muted">no</span>}</td>
                        <td>{e.chess960 ? <span className="chip chip-accent">960</span> : <span className="muted">—</span>}</td>
                        <td className="r tnum" data-testid={`wizard-elo-${e.id}`}>
                          {r?.rating != null ? num(r.rating) : <EloCell r={libRating(e)} />}
                          {r?.estimated && <span className="chip chip-warn ml-1" title={r.note}>est.</span>}
                          {sort[0] === "near" && seedElo != null && eloOf(e) != null && !seeds.includes(e.id!) && <span className="muted text-[11px] ml-1">({eloOf(e)! - seedElo >= 0 ? "+" : ""}{num(eloOf(e)! - seedElo)})</span>}
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
            <div className="grid gap-3 cond-grid">
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
              <div className="grid gap-3 cond-grid mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
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
            <div className="grid gap-3 items-end numa-grid">
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
            <div className="flex gap-4 text-[12.5px] px-1" data-testid="wizard-broadcast">
              <span className="muted">Broadcast live:</span>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={castLichess} onChange={(e) => setCastLichess(e.target.checked)} disabled={!settings?.lichess_token} /> Lichess
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={castCcrl} onChange={(e) => setCastCcrl(e.target.checked)} /> ccrl.live
              </label>
            </div>
            <div className="flex flex-col gap-2">
              <button className="btn btn-primary justify-center h-9" disabled={busy || (!!editId && !editing) || !preview || preview.errors.length > 0} onClick={() => create("start")} data-testid="create-start">
                <Play size={14} /> {editing ? "Save and start" : "Create and start"}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn justify-center" disabled={busy || (!!editId && !editing) || !preview || preview.errors.length > 0} onClick={() => create("queue")}>
                  <ListPlus size={14} /> {editing ? "Save & queue" : "Create & queue"}
                </button>
                <button className="btn justify-center" disabled={busy || (!!editId && !editing) || !preview || preview.errors.length > 0} onClick={() => create("draft")} data-testid="create-draft">
                  {editing ? <Save size={14} /> : <Plus size={14} />} {editing ? "Save changes" : "Save draft"}
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
      <Modal
        open={optsFor != null}
        onOpenChange={(o) => !o && setOptsFor(null)}
        title={`${optsFor?.display_name ?? ""}: UCI options in this tournament`}
        width={900}
        footer={
          <>
            <button
              className="btn"
              onClick={() => {
                if (!optsFor) return;
                setOptsDraft({ Threads: "${THREADS}", Hash: "${HASH}", ...optsFor.default_options });
                setOptsRev((r) => r + 1);
              }}
            >
              Engine's options (Engines → Edit)
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (optsFor) setPartOpts({ ...partOpts, [optsFor.id!]: optsDraft });
                setOptsFor(null);
              }}
              data-testid="wizard-options-apply"
            >
              Apply
            </button>
          </>
        }
      >
        {optsFor && <UciOptionsEditor key={`${optsFor.id}-${optsRev}`} options={optsFor.options} values={optsDraft} onChange={setOptsDraft} engineId={optsFor.id} dir={optsFor.dir} />}
      </Modal>
    </div>
  );
}
