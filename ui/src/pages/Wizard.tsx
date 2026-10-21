import { ArrowDown, ArrowUp, Calculator, Check, Crosshair, ListPlus, Play, Plus, Save, Search, SlidersHorizontal, Sparkles } from "lucide-react";
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
import type { Gpu } from "../bindings/Gpu";
import type { TournamentConfig } from "../bindings/TournamentConfig";
import type { TournamentKind } from "../bindings/TournamentKind";
import type { TournamentDetail } from "../bindings/TournamentDetail";
import type { TournamentRecord } from "../bindings/TournamentRecord";
import type { Variant } from "../bindings/Variant";
import type { BookSpec } from "../bindings/BookSpec";
import type { WizardPreview } from "../bindings/WizardPreview";
import { CoresPanel, type CoresValue } from "../components/CoresPanel";
import { UciOptionsEditor } from "../components/UciOptions";
import { cmpNum, EloCell, matchesEngine, SortTh, useEngineRatings, type RatingList, type SortDir } from "../components/EngineRatings";
import { BOOK_FILTERS, PathInput } from "../components/PathInput";
import { BookPicker, type InstalledBook } from "../components/OpeningBooks";
import { Empty, ErrorBox, Field, Modal, PageHeader, PageTabs, Panel, Seg, Spinner, Tip, useTabParam, Warn } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { suggestedLanes } from "../lib/cores";
import { cpuLabel, heaviestPair } from "../lib/cpu";
import { useMsg, useT } from "../i18n";
import { duration, num } from "../lib/format";

const WIZARD_STEPS = ["engines", "seeding", "conditions", "numa"] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];
const KIND_LABEL: Record<TournamentKind, string> = { gauntlet: "gauntlet", multi_gauntlet: "gauntlet", round_robin: "round robin", match: "match", swiss: "swiss", knockout: "knockout" };

function splitOpenings(games: number, passes: number, nodes: number): number[] | null {
  if (games <= 0 || games % 2 || games % (passes * 2)) return null;
  const o = games / (passes * 2);
  if (o < nodes) return null;
  return Array.from({ length: nodes }, (_, i) => Math.floor(o / nodes) + (i < o % nodes ? 1 : 0));
}

export function Wizard() {
  const t = useT();
  const tm = useMsg();
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
  const { data: books } = usePoll<InstalledBook[]>("books_list", {}, 0);

  const [kind, setKind] = useState<TournamentKind>("gauntlet");
  const [list, setList] = useState("Blitz");
  const [variant, setVariant] = useState<Variant>("standard");
  const [frcOpen, setFrcOpen] = useState(false);
  const [frcSpec, setFrcSpec] = useState<BookSpec>({ kind: "all", count: 200, seed: 1, include_standard: false });
  const [seeds, setSeeds] = useState<number[]>([]);
  const [opps, setOpps] = useState<number[]>([]);
  /** Swiss / cup: seed order chosen by hand (engine ids, best seed first); null = by rating. */
  const [seedOrder, setSeedOrder] = useState<number[] | null>(null);
  const [step, setStep] = useTabParam(WIZARD_STEPS, "engines");
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
  const [showInactive, setShowInactive] = useState(false);
  const [smt, setSmt] = useState(false);
  // graphics cards for the GPU engines: one game per card at a time
  const [cards, setCards] = useState<Gpu[]>();
  const [gpus, setGpus] = useState<number[] | null>(null);
  useEffect(() => {
    call<Gpu[]>("gpus").then(setCards).catch(() => setCards([]));
  }, []);
  const [book, setBook] = useState("");
  const [bookStart, setBookStart] = useState(1);
  const [randomOpenings, setRandomOpenings] = useState(false);
  // as is: the tournament sets no engine option
  const [asIs, setAsIs] = useState(false);
  const [openingSeed, setOpeningSeed] = useState(() => 1 + Math.floor(Math.random() * 999_999));
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
  // threads of single engines when they differ from the tournament's (an 8CPU seed vs 1CPU opponents)
  const [partThreads, setPartThreads] = useState<Record<number, number>>({});
  // custom: single engines with their own threads (an 8CPU seed vs 1CPU opponents)
  const [customThreads, setCustomThreads] = useState(false);
  const threadsOfEngine = (e: EngineEntry) => partThreads[e.id!] ?? threads;
  // threads of the two engines of the heaviest game, and the CPUs one lane needs: known from the ids alone
  const pair = heaviestPair(kind, [...seeds.map((id) => ({ role: "seed" as const, threads: partThreads[id] ?? null })), ...opps.map((id) => ({ role: "opponent" as const, threads: partThreads[id] ?? null }))], threads);
  const laneCores = Math.max(2, pair[0] + pair[1]);
  const laneCoresKey = `${laneCores}`;
  const gpuEngines = (engines ?? []).filter((e) => e.gpu && (seeds.includes(e.id!) || opps.includes(e.id!))).map((e) => e.display_name);
  // every card by default
  const gpuList = gpus ?? (cards ?? []).map((c) => c.index);
  const gpuCap = (n: number) => (gpuEngines.length ? Math.min(n, Math.max(1, Math.floor(Math.max(1, gpuList.length) / Math.max(1, nodes.length)))) : n);
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
  // CCRL hash: Blitz 256 MB per thread (2048 at 8CPU); longer lists 512 per thread, at least 1024
  const isBlitz = (l: string) => !l || l.toLowerCase() === "blitz";
  const ccrlHash = (l: string, t: number) => (isBlitz(l) ? (settings?.hash_per_thread_blitz_mb ?? 256) * t : Math.max((settings?.hash_per_thread_mb ?? 512) * t, (settings?.hash_per_thread_mb ?? 512) * 2));
  useEffect(() => {
    if (hashAuto) setHash(ccrlHash(list, threads));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, hashAuto, list, settings]);
  useEffect(() => {
    if (!topo) return;
    if (keepLanes.current) {
      keepLanes.current = false;
      return;
    }
    if (topo.nodes.some((x) => x.id === nodes[0])) setLanes(gpuCap(suggestedLanes(topo, nodes[0], laneCores, smt)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, topo, nodes, laneCoresKey, smt, gpuEngines.length > 0, gpuList.length]);

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
        if (missing.length) toast.warning(t("wizard.toast.missing", { names: missing.join(", ") }));
        keepLanes.current = true;
        setKind(c.kind);
        setList(c.ccrl_list || "Blitz");
        setVariant(c.variant);
        setSeeds(pick("seed"));
        setOpps(pick("opponent"));
        if (c.kind === "swiss" || c.kind === "knockout") setSeedOrder(c.participants.filter((p) => p.engine_id != null && ids.has(p.engine_id)).map((p) => p.engine_id!));
        setThreads(c.threads);
        const own = c.participants.filter((p) => p.engine_id != null && ids.has(p.engine_id) && p.threads != null);
        setPartThreads(Object.fromEntries(own.map((p) => [p.engine_id!, p.threads!])));
        setCustomThreads(own.length > 0);
        setHashAuto(c.hash_mb === ccrlHash(c.ccrl_list, c.threads));
        setHash(c.hash_mb);
        setTc(c.tc);
        setGames(c.games_per_pairing);
        setPasses(c.passes);
        setNodes(c.nodes);
        setLanes(c.lanes_per_node);
        setPlacement(c.placement);
        setSmt(c.use_smt ?? false);
        if (c.gpus?.length) setGpus(c.gpus);
        setBook(c.book);
        setBookStart(c.book_start);
        setRandomOpenings(c.random_openings ?? false);
        setAsIs(c.as_is ?? false);
        if (c.opening_seed) setOpeningSeed(c.opening_seed);
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
  const dynamicKind = kind === "swiss" || kind === "knockout";
  const roleRows = [...seedEngines.map((e) => ({ role: "seed" as const, threads: partThreads[e.id!] ?? null })), ...oppEngines.map((e) => ({ role: "opponent" as const, threads: partThreads[e.id!] ?? null }))];
  const cpus = cpuLabel(roleRows, threads);
  const mixed = cpus !== `${threads}CPU`;
  const autoEvent = kind === "round_robin" || dynamicKind ? `CCRL ${list} ${kindLabel} ${cpus}` : `CCRL ${list} ${kindLabel} ${seedEngines.map((e) => e.display_name).join(" + ") || "<seed>"} ${cpus}`;
  useEffect(() => {
    if (eventAuto) setEventName(autoEvent);
  }, [autoEvent, eventAuto]);

  // ratings of the selected engines in the target list / CPU category
  const names = (engines ?? []).map((e) => e.display_name);
  const partThreadsKey = JSON.stringify(partThreads);
  useEffect(() => {
    if (!names.length) return;
    // each engine in the CPU category it plays in
    const groups = new Map<number, string[]>();
    for (const e of engines ?? []) {
      const t = partThreads[e.id!] ?? threads;
      groups.set(t, [...(groups.get(t) ?? []), e.display_name]);
    }
    Promise.all([...groups].map(([cpus, names]) => call<RatingLookup[]>("ccrl_ratings", { list, cpus, names })))
      .then((rs) => setRatings(Object.fromEntries(rs.flat().map((x) => [x.name, x]))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(names), list, threads, partThreadsKey]);

  // Swiss / knockout: one block of openings per match, `passes` = Swiss rounds
  const rpp = dynamicKind ? (games > 0 && games % 2 === 0 ? [games / 2] : null) : splitOpenings(games, passes, Math.max(1, nodes.length));
  // seeding of a Swiss / knockout: highest CCRL rating first
  const seedRating = (e: EngineEntry) => ratings[e.display_name]?.rating ?? libRatings.get(e.id!)?.[list as RatingList]?.rating ?? -1;
  // the seed order: by rating, or as arranged by hand (engines added later go by rating at the end)
  const byRating = [...seedEngines, ...oppEngines].sort((a, b) => seedRating(b) - seedRating(a) || a.display_name.localeCompare(b.display_name));
  const seeded: EngineEntry[] = seedOrder
    ? [...(seedOrder.map((i) => byRating.find((e) => e.id === i)).filter(Boolean) as EngineEntry[]), ...byRating.filter((e) => !seedOrder.includes(e.id!))]
    : byRating;
  const steps = (dynamicKind ? ["engines", "seeding", "conditions", "numa"] : ["engines", "conditions", "numa"]) as WizardStep[];
  const shownStep: WizardStep = step === "seeding" && !dynamicKind ? "engines" : step;
  const stepIndex = steps.indexOf(shownStep);
  const moveSeed = (i: number, d: number) => {
    const ids = seeded.map((e) => e.id!);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setSeedOrder(ids);
  };
  const baseOptions = (e: EngineEntry): Record<string, string> => {
    const was = editing?.config.participants.find((p) => p.engine_id === e.id);
    // an engine's own tablebase path wins only when set (an empty one, "<empty>" included, takes the settings')
    const own = Object.fromEntries(Object.entries(e.default_options).filter(([k, v]) => !(k in tablebaseOptions(e)) || (v.trim() !== "" && v.trim() !== "<empty>")));
    return was ? { ...was.options } : { Threads: "${THREADS}", Hash: "${HASH}", ...tablebaseOptions(e), ...own };
  };
  // Gaviota / Nalimov paths of the settings, for the engines that have such an option
  function tablebaseOptions(e: EngineEntry): Record<string, string> {
    const out: Record<string, string> = {};
    for (const o of e.options) {
      const n = o.name.toLowerCase();
      if (o.kind !== "string" || !(n.includes("path") || n.includes("dir"))) continue;
      if (n.includes("gaviota") && settings?.gaviota_path?.trim()) out[o.name] = settings.gaviota_path.trim();
      else if (n.includes("nalimov") && settings?.nalimov_path?.trim()) out[o.name] = settings.nalimov_path.trim();
      else if (n.includes("egbb") && settings?.egbb_path?.trim()) {
        // Scorpio appends the file names to the path: it ends with a separator
        const p = settings.egbb_path.trim();
        out[o.name] = /[\\/]$/.test(p) ? p : p + (p.includes("\\") ? "\\" : "/");
      }
    }
    return out;
  }
  const customOpts = (e: EngineEntry) => {
    const o = partOpts[e.id!];
    return o != null && JSON.stringify(o) !== JSON.stringify(baseOptions(e));
  };
  const toParticipant = (e: EngineEntry, role: "seed" | "opponent"): Participant => {
    // an edited tournament keeps the options and arguments it had for this engine
    const was = editing?.config.participants.find((p) => p.engine_id === e.id);
    const opts: Record<string, string> = partOpts[e.id!] ?? baseOptions(e);
    const r = ratings[e.display_name];
    const own = partThreads[e.id!];
    const ownThreads = own != null && own !== threads ? own : null;
    return { name: e.display_name, cmd: e.path, dir: e.dir, args: was?.args ?? e.args ?? "", options: opts, role, engine_id: e.id, has_syzygy: e.has_syzygy, uci_id: e.uci_id, rating: r?.rating ?? null, rating_estimated: r?.estimated ?? false, threads: ownThreads, hash_mb: ownThreads != null ? ccrlHash(list, ownThreads) : null, withdrawn: was?.withdrawn ?? false, gpu: !!e.gpu, gpu_select: e.gpu && e.options.some((o) => o.name === "BackendOptions") ? "BackendOptions" : "" };
  };
  const config: TournamentConfig | null = adj
    ? {
        name: eventName.replace(/^CCRL /, "") || "Tournament",
        kind,
        participants: dynamicKind
          ? seeded.map((e, i) => toParticipant(e, i === 0 ? "seed" : "opponent"))
          : kind === "round_robin" || kind === "match"
            ? [...seedEngines, ...oppEngines].map((e, i) => toParticipant(e, i === 0 ? "seed" : "opponent")) : [...seedEngines.map((e) => toParticipant(e, "seed")), ...oppEngines.map((e) => toParticipant(e, "opponent"))],
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
        random_openings: randomOpenings,
        as_is: asIs,
        opening_seed: openingSeed,
        event: eventName,
        site,
        syzygy_path: syzygy,
        adjudication: adj,
        extra_args: extra.split(/\s+/).filter(Boolean),
        placement,
        use_smt: smt,
        gpus: gpuEngines.length ? gpuList : [],
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
      toast.success(t("wizard.toast.tc", { label: n.label, factor, fastchess: r.fastchess, human: r.human }));
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
      toast.success(t("wizard.toast.suggested", { count: ids.length, list, threads }));
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
        toast.success(t(mode === "queue" ? "wizard.toast.savedQueued" : mode === "start" ? "wizard.toast.savedStarted" : "wizard.toast.saved", { name: rec.name, games: rec.expected_games }));
        nav(`/tournaments/${encodeURIComponent(rec.id)}`);
        return;
      }
      const rec = await call<TournamentRecord>("tournament_create", { config, enqueue: mode === "queue" });
      if (castLichess || castCcrl) {
        await call("broadcast_set", { id: rec.id, lichess: castLichess, ccrl_live: castCcrl }).catch((e) => toast.error((e as Error).message));
      }
      if (mode === "start") await call("tournament_start", { id: rec.id });
      toast.success(t(mode === "queue" ? "wizard.toast.queued" : mode === "start" ? "wizard.toast.started" : "wizard.toast.created", { name: rec.name, games: rec.expected_games }));
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
  const inactiveN = (engines ?? []).filter((e) => e.inactive).length;
  // inactive engines only on request (or when none is active); the chosen ones always show
  const withInactive = showInactive || inactiveN === (engines ?? []).length;
  const filtered = (engines ?? [])
    .filter((e) => withInactive || !e.inactive || seeds.includes(e.id!) || opps.includes(e.id!))
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
        title={editId ? t("wizard.editTitle", { name: editing?.name ?? t("wizard.editFallback") }) : t("wizard.title")}
        sub={editId ? t("wizard.editSub") : t(randomOpenings ? "tournament.wizardSub.random" : "tournament.wizardSub.paired")}
      />
      {editError && <ErrorBox error={editError} />}
      {editId && !editing && !editError && <div className="muted text-[12px]">{t("wizard.loading")}</div>}
      <div className="grid gap-3 wizard-grid">
        <div className="flex flex-col gap-3 min-w-0">
          <PageTabs
            tabs={[
              { id: "engines", label: t("wizard.steps.engines"), badge: seedEngines.length + oppEngines.length || undefined },
              { id: "seeding", label: t("wizard.steps.seeding"), hidden: !dynamicKind },
              { id: "conditions", label: t("wizard.steps.conditions", { n: dynamicKind ? 3 : 2 }) },
              { id: "numa", label: `${dynamicKind ? 4 : 3} · ${t("cores.step")}` },
            ]}
            value={shownStep}
            onChange={setStep}
            testid="wizard-step"
          />
          {shownStep === "engines" && (
            <>
          <Panel title={t("wizard.type.title")}>
            <div className="flex flex-wrap gap-3 items-end">
              <Field label={t("wizard.type.kind")}>
                <Seg
                  value={kind}
                  onChange={(k) => {
                    setKind(k);
                    if (k !== "multi_gauntlet" && seeds.length > 1) setSeeds(seeds.slice(0, 1));
                    if (k === "swiss" && passes < 3) setPasses(5);
                    if (k === "knockout") setPasses(1);
                  }}
                  options={[
                    { value: "gauntlet", label: t("wizard.type.gauntlet") },
                    { value: "multi_gauntlet", label: t("wizard.type.multi") },
                    { value: "round_robin", label: t("wizard.type.roundRobin") },
                    { value: "match", label: t("wizard.type.match") },
                    { value: "swiss", label: t("wizard.type.swiss") },
                    { value: "knockout", label: t("wizard.type.knockout") },
                  ]}
                />
              </Field>
              <Field label={t("wizard.type.list")}>
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
              <Field label={t("wizard.type.variant")} hint={variant === "chess960" ? t("wizard.type.variantHint") : undefined}>
                <Seg value={variant} onChange={setVariant} options={[{ value: "standard", label: t("wizard.type.standard") }, { value: "chess960", label: "Chess960" }]} />
              </Field>
              <Field label={t("wizard.type.event")} className="flex-1 min-w-[280px]" hint={eventAuto ? t("wizard.type.eventAuto") : <button className="underline" onClick={() => setEventAuto(true)}>{t("wizard.type.eventReset")}</button>}>
                <input className="input" value={eventName} onChange={(e) => { setEventAuto(false); setEventName(e.target.value); }} data-testid="event-name" />
              </Field>
            </div>
          </Panel>
          <Panel
            title={seedMode ? t("wizard.engines.titleSeed", { seeds: seedEngines.length, seedWord: t(multiSeed ? "wizard.engines.seedMany" : "wizard.engines.seedOne"), opps: oppEngines.length }) : t("wizard.engines.titleAll", { count: seedEngines.length + oppEngines.length })}
            actions={
              <>
                <div className="relative">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 muted" />
                  <input className="input" style={{ width: 170, paddingLeft: 26 }} placeholder={t("wizard.engines.search")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="wizard-search" />
                </div>
                {inactiveN > 0 && inactiveN < (engines ?? []).length && (
                  <Tip content={t("engines.wizardInactiveTip")}>
                    <label className="flex items-center gap-1.5 text-[12px] muted whitespace-nowrap">
                      <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} data-testid="wizard-show-inactive" />
                      {t("engines.wizardInactive", { count: inactiveN })}
                    </label>
                  </Tip>
                )}
                <Tip content={t("wizard.engines.eloTip", { list })}>
                  <div className="flex items-center gap-1 text-[12px] muted">
                    Elo
                    <input className="input tnum" style={{ width: 64 }} placeholder={t("wizard.engines.from")} inputMode="numeric" value={eloMin} onChange={(e) => setEloMin(e.target.value.replace(/[^0-9]/g, ""))} data-testid="elo-min" />
                    –
                    <input className="input tnum" style={{ width: 64 }} placeholder={t("wizard.engines.to")} inputMode="numeric" value={eloMax} onChange={(e) => setEloMax(e.target.value.replace(/[^0-9]/g, ""))} data-testid="elo-max" />
                  </div>
                </Tip>
                {seedMode && (
                  <Tip content={seedElo != null ? t("wizard.engines.nearTip", { rating: num(seedElo) }) : t("wizard.engines.nearNone")}>
                    <button className={`btn btn-sm ${sort[0] === "near" ? "btn-primary" : ""}`} disabled={seedElo == null} onClick={() => setSort(sort[0] === "near" ? ["rating", "desc"] : ["near", "asc"])} data-testid="sort-near">
                      <Crosshair size={13} /> {t("wizard.engines.near")}
                    </button>
                  </Tip>
                )}
                {seedMode && (
                  <Tip content={t("wizard.engines.suggestTip", { list, threads })}>
                    <button className="btn btn-sm" onClick={doSuggest}>
                      <Sparkles size={13} /> {t("wizard.engines.suggest")}
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
                    {seedMode && <th>{t("wizard.engines.seed")}</th>}
                    <th>{seedMode ? t("wizard.engines.opponent") : t("wizard.engines.plays")}</th>
                    <SortTh k="name" sort={sort} setSort={setSort} first="asc">
                      {t("wizard.engines.engine")}
                    </SortTh>
                    <th>{t("wizard.engines.build")}</th>
                    {customThreads && <th className="r" title={t("wizard.engines.threadsTip")}>{t("wizard.engines.threads")}</th>}
                    <th className="r">{t("wizard.engines.threadsMax")}</th>
                    <th>Syzygy</th>
                    <th>960</th>
                    <SortTh k="rating" sort={sort} setSort={setSort} right>
                      {t("wizard.engines.ccrl", { list, threads })}
                    </SortTh>
                    <th>{t("wizard.engines.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const r = ratings[e.display_name];
                    const tooFew = e.threads_max != null && e.threads_max < threadsOfEngine(e);
                    const selected = seeds.includes(e.id!) || opps.includes(e.id!);
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
                              <Tip content={t("wizard.engines.optionsTip")}>
                                <button
                                  className={`btn btn-sm ${customOpts(e) ? "btn-primary" : "btn-ghost"}`}
                                  onClick={() => {
                                    setOptsDraft(partOpts[e.id!] ?? baseOptions(e));
                                    setOptsFor(e);
                                  }}
                                  data-testid={`wizard-options-${e.id}`}
                                >
                                  <SlidersHorizontal size={12} /> {customOpts(e) ? t("wizard.engines.customOptions") : t("wizard.engines.options")}
                                </button>
                              </Tip>
                            )}
                          </span>
                        </td>
                        <td className="mono truncate max-w-[180px]" title={e.build}>{e.build || "—"}</td>
                        {customThreads && (
                        <td className="r">
                          {selected && (
                            <input
                              className="input tnum"
                              style={{ width: 58, height: 24, padding: "0 6px", textAlign: "right", opacity: partThreads[e.id!] != null && partThreads[e.id!] !== threads ? 1 : 0.6 }}
                              type="number"
                              min={1}
                              placeholder={String(threads)}
                              value={partThreads[e.id!] ?? ""}
                              onChange={(ev) => {
                                const v = ev.target.value === "" ? null : Math.max(1, +ev.target.value);
                                setPartThreads((m) => {
                                  const n = { ...m };
                                  if (v == null) delete n[e.id!];
                                  else n[e.id!] = v;
                                  return n;
                                });
                              }}
                              aria-label={`threads of ${e.display_name}`}
                              data-testid={`wizard-threads-${e.id}`}
                            />
                          )}
                        </td>
                        )}
                        <td className="r" style={{ color: tooFew ? "var(--loss)" : undefined }}>
                          {e.threads_max ?? "?"}
                        </td>
                        <td>{e.has_syzygy ? t("app.common.yes") : <span className="muted">{t("app.common.no")}</span>}</td>
                        <td>{e.chess960 ? <span className="chip chip-accent">960</span> : <span className="muted">—</span>}</td>
                        <td className="r tnum" data-testid={`wizard-elo-${e.id}`}>
                          {r?.rating != null ? num(r.rating) : <EloCell r={libRating(e)} />}
                          {r?.estimated && <span className="chip chip-warn ml-1" title={r.note}>{t("wizard.engines.est")}</span>}
                          {sort[0] === "near" && seedElo != null && eloOf(e) != null && !seeds.includes(e.id!) && <span className="muted text-[11px] ml-1">({eloOf(e)! - seedElo >= 0 ? "+" : ""}{num(eloOf(e)! - seedElo)})</span>}
                        </td>
                        <td>
                          {!e.path ? (
                            <span className="chip chip-loss" title={t("wizard.engines.noBinaryTip")}>{t("wizard.engines.noBinary")}</span>
                          ) : tooFew ? (
                            <span className="chip chip-loss">{t("wizard.engines.maxThreads", { count: e.threads_max ?? 0 })}</span>
                          ) : variant === "chess960" && !e.chess960 && e.options.length > 0 ? (
                            <span className="chip chip-loss" title={t("wizard.engines.no960Tip")}>{t("wizard.engines.no960")}</span>
                          ) : e.verify_status === "ok" ? (
                            <span className="chip chip-win">{t("wizard.engines.verified")}</span>
                          ) : (
                            <span className="chip chip-warn">{e.verify_status || t("wizard.engines.unverified")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={customThreads ? 9 : 8} className="muted">
                        {(engines ?? []).length === 0 ? t("wizard.engines.empty") : t("engines.wizardNone")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {suggest.length > 0 && <div className="px-3 py-2 muted text-[12px]">{t("wizard.engines.suggestedLine", { list: suggest.map((s) => `${s.rank}. ${s.list_name} (${num(s.rating)})`).join(" · ") })}</div>}
          </Panel>
            </>
          )}
          {shownStep === "seeding" &&
            (seeded.length >= 2 ? (
            <Panel
              title={kind === "knockout" ? t("wizard.seeding.titleCup") : t("wizard.seeding.title")}
              actions={
                <div className="flex items-center gap-2">
                  <span className="muted text-[11.5px]">{seedOrder ? t("wizard.seeding.byHand") : t("wizard.seeding.byRating", { list })}</span>
                  {seedOrder && (
                    <button className="btn btn-sm" onClick={() => setSeedOrder(null)} data-testid="seed-by-rating">
                      {t("wizard.seeding.reset")}
                    </button>
                  )}
                </div>
              }
            >
              <div className="grid gap-3 cols-fit">
                <div>
                  <table className="tbl" data-testid="seed-order">
                    <thead>
                      <tr>
                        <th className="r">{t("wizard.seeding.seed")}</th>
                        <th>{t("wizard.seeding.engine")}</th>
                        <th className="r">{t("wizard.seeding.rating")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {seeded.map((e, i) => (
                        <tr key={e.id}>
                          <td className="r tnum">{i + 1}</td>
                          <td className="font-medium">{e.display_name}</td>
                          <td className="r tnum muted">{seedRating(e) > 0 ? num(seedRating(e)) : "—"}</td>
                          <td className="r whitespace-nowrap">
                            <button className="btn btn-ghost btn-icon btn-sm" disabled={i === 0} onClick={() => moveSeed(i, -1)} aria-label={`seed ${e.display_name} up`}>
                              <ArrowUp size={12} />
                            </button>
                            <button className="btn btn-ghost btn-icon btn-sm" disabled={i === seeded.length - 1} onClick={() => moveSeed(i, 1)} aria-label={`seed ${e.display_name} down`}>
                              <ArrowDown size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-[12.5px] flex flex-col gap-1" data-testid="seed-preview">
                  {kind === "knockout" ? (
                    <>
                      <div className="muted text-[11.5px]">{t("wizard.seeding.cupAbout")}</div>
                      {firstRound(seeded.map((e) => e.display_name)).map(([a, b], k) => (
                        <div key={k} className="flex gap-2">
                          <span className="muted tnum w-5 text-right">{k + 1}.</span>
                          <b>{a}</b>
                          {b ? (
                            <>
                              <span className="muted">{t("wizard.seeding.vs")}</span> <b>{b}</b>
                            </>
                          ) : (
                            <span className="muted">{t("wizard.seeding.bye")}</span>
                          )}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="muted">
                      {t("wizard.seeding.swissAbout", { a: Math.floor(seeded.length / 2) + 1, b: Math.floor(seeded.length / 2) + 2 })}
                      {seeded.length % 2 === 1 ? t("wizard.seeding.odd") : ""}
                    </div>
                  )}
                </div>
              </div>
            </Panel>
            ) : (
              <Panel title={t("wizard.seeding.title")}>
                <Empty>{t("wizard.seeding.needTwo")}</Empty>
              </Panel>
            ))}
          {shownStep === "conditions" && (
          <Panel title={t("wizard.cond.title")}>
            <label className="flex items-start gap-2 mb-3 text-[12.5px] p-2 rounded-md" style={{ background: asIs ? "var(--warn-bg, var(--bg-2))" : "var(--bg-2)" }} data-testid="wizard-as-is">
              <input type="checkbox" className="mt-0.5" checked={asIs} onChange={(e) => setAsIs(e.target.checked)} />
              <span>
                <span className="font-medium">{t("wizard.cond.asIs")}</span>
                <span className="block muted">{t(asIs ? "wizard.cond.asIsOn" : "wizard.cond.asIsAbout")}</span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3 text-[12.5px]" data-testid="wizard-cpu-block">
              <span className="font-medium">{t("wizard.cond.cpu")}</span>
              <span className="inline-flex items-center gap-1">
                {[1, 2, 4, 8].map((n) => (
                  <button key={n} className={`chip ${threads === n ? "chip-accent" : ""}`} onClick={() => setThreads(n)} data-testid={`wizard-cpu-${n}`}>
                    {n}CPU
                  </button>
                ))}
              </span>
              <input className="input tnum" style={{ width: 64 }} type="number" min={1} value={threads} onChange={(e) => setThreads(Math.max(1, +e.target.value))} aria-label={t("wizard.cond.threadsLabel")} />
              <span className="muted">{t("wizard.cond.threadsAbout")}</span>
              <span className="muted">·</span>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={customThreads}
                  onChange={(e) => {
                    setCustomThreads(e.target.checked);
                    if (!e.target.checked) setPartThreads({});
                  }}
                  data-testid="wizard-custom-threads"
                />
                {t("wizard.cond.custom")}
              </label>
              {customThreads && (kind === "gauntlet" || kind === "multi_gauntlet") && (
                <button
                  className="btn btn-sm"
                  title={t("wizard.cond.presetTip")}
                  onClick={() => {
                    setThreads(1);
                    setPartThreads(Object.fromEntries(seedEngines.map((e) => [e.id!, 8])));
                  }}
                  data-testid="wizard-preset-8v1"
                >
                  {t("wizard.cond.preset")}
                </button>
              )}
              {!customThreads && (kind === "gauntlet" || kind === "multi_gauntlet") && (
                <button
                  className="underline muted"
                  onClick={() => {
                    setCustomThreads(true);
                    setThreads(1);
                    setPartThreads(Object.fromEntries(seedEngines.map((e) => [e.id!, 8])));
                  }}
                  data-testid="wizard-preset-8v1"
                >
                  {t("wizard.cond.preset")}
                </button>
              )}
              {customThreads && (
                <span className="muted">
                  {mixed ? (
                    <>
                      <b data-testid="wizard-cpu-label" style={{ color: "var(--fg)" }}>
                        {cpus}
                      </b>{" "}
                      ·{" "}
                    </>
                  ) : null}
                  {t("wizard.cond.customAbout1")}<i>{t("wizard.cond.customAbout2")}</i>{t("wizard.cond.customAbout3", { threads })}
                </span>
              )}
            </div>
            <div className="grid gap-3 cond-grid">
              <Field label={t("wizard.cond.hash")} hint={hashAuto ? (isBlitz(list) ? t("wizard.cond.hashBlitz") : t("wizard.cond.hashOther", { list })) : <button className="underline" onClick={() => setHashAuto(true)}>{t("wizard.cond.automatic")}</button>}>
                <input className="input tnum" type="number" value={hash} onChange={(e) => { setHashAuto(false); setHash(+e.target.value); }} />
              </Field>
              <Field
                label={dynamicKind ? t("wizard.cond.gamesMatch") : t("wizard.cond.gamesPairing")}
                hint={
                  !rpp
                    ? dynamicKind
                      ? t("wizard.cond.mustEven")
                      : t("wizard.cond.mustMultiple")
                    : kind === "knockout"
                      ? t("wizard.cond.cupGames", { openings: games / 2 })
                      : t("wizard.cond.pairGames", { openings: games / 2 })
                }
              >
                <input className="input tnum" type="number" step={2} min={2} value={games} onChange={(e) => setGames(+e.target.value)} data-testid="games-per-pairing" />
              </Field>
              {kind === "knockout" ? (
                <Field label={t("wizard.cond.rounds")} hint={t("wizard.cond.cupRounds")}>
                  <input className="input tnum" disabled value={Math.max(1, Math.ceil(Math.log2(Math.max(2, seedEngines.length + oppEngines.length))))} />
                </Field>
              ) : (
                <Field
                  label={kind === "swiss" ? t("wizard.cond.rounds") : t("wizard.cond.passes")}
                  hint={
                    kind === "swiss"
                      ? t("wizard.cond.swissRounds", { max: Math.max(1, seedEngines.length + oppEngines.length - 1) })
                      : passes > 1
                        ? t("wizard.cond.stages", { passes, games: games / passes })
                        : t("wizard.cond.oneStage")
                  }
                >
                  <input className="input tnum" type="number" min={1} value={passes} onChange={(e) => setPasses(Math.max(1, +e.target.value))} data-testid="passes" />
                </Field>
              )}
              <Field label={t("wizard.cond.tc")} className="col-span-2">
                <div className="flex gap-1.5">
                  <input className="input mono" value={tc} onChange={(e) => setTc(e.target.value)} data-testid="tc" />
                </div>
              </Field>
              <Field label={t("wizard.cond.nominal")} className="col-span-2">
                <select className="select" value={nominal} onChange={(e) => setNominal(e.target.value)}>
                  {(presets ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("wizard.cond.factor")} hint={t("wizard.cond.factorHint")}>
                <input className="input tnum" type="number" step={0.001} value={factor} onChange={(e) => setFactor(+e.target.value)} />
              </Field>
              <div className="flex items-end">
                <button className="btn w-full justify-center" onClick={computeTc}>
                  <Calculator size={13} /> {t("wizard.cond.localTc")}
                </button>
              </div>
              <Field
                label={variant === "chess960" ? t("wizard.cond.positions") : t("wizard.cond.book")}
                className="col-span-2"
                hint={
                  variant === "chess960" ? (
                    <button className="underline" onClick={() => setFrcOpen(true)} data-testid="frc-generate">
                      {t("wizard.cond.generate960")}
                    </button>
                  ) : undefined
                }
              >
                <div className="flex gap-2">
                  {variant !== "chess960" && (books ?? []).length > 0 && <BookPicker books={books ?? []} value={book} onPick={setBook} />}
                  <PathInput kind="file" className="flex-1" value={book} onChange={setBook} filters={BOOK_FILTERS} placeholder={variant === "chess960" ? "chess960-all-seed1.epd" : "C:\\CCRL\\books\\AVT2026d.pgn"} testid="book" />
                </div>
              </Field>
              <Field label={t("wizard.cond.bookStart")}>
                <input className="input tnum" type="number" min={1} value={bookStart} onChange={(e) => setBookStart(Math.max(1, +e.target.value))} />
              </Field>
              <Field label={t("wizard.cond.openings")} hint={randomOpenings ? t("wizard.cond.randomHint") : t("wizard.cond.pairedHint")}>
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={randomOpenings} onChange={(e) => setRandomOpenings(e.target.checked)} data-testid="random-openings" />
                  {t("wizard.cond.random")}
                </label>
              </Field>
              <Field label={t("wizard.cond.syzygy")} className="col-span-2" hint={t("wizard.cond.syzygyHint")}>
                <PathInput kind="folder" value={syzygy} onChange={setSyzygy} testid="syzygy" />
              </Field>
              <Field label={t("wizard.cond.site")}>
                <input className="input" value={site} onChange={(e) => setSite(e.target.value)} />
              </Field>
            </div>
            {adj && (
              <div className="grid gap-3 cond-grid mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                <label className="flex items-center gap-2 col-span-2">
                  <input type="checkbox" checked={adj.draw_enabled} onChange={(e) => setAdj({ ...adj, draw_enabled: e.target.checked })} /> {t("wizard.cond.draw")}
                </label>
                <Field label={t("wizard.cond.fromMove")}>
                  <input className="input tnum" type="number" value={adj.draw_movenumber} onChange={(e) => setAdj({ ...adj, draw_movenumber: +e.target.value })} />
                </Field>
                <Field label={t("wizard.cond.moves")}>
                  <input className="input tnum" type="number" value={adj.draw_movecount} onChange={(e) => setAdj({ ...adj, draw_movecount: +e.target.value })} />
                </Field>
                <Field label="|score| ≤ cp">
                  <input className="input tnum" type="number" value={adj.draw_score} onChange={(e) => setAdj({ ...adj, draw_score: +e.target.value })} />
                </Field>
                <div />
                <label className="flex items-center gap-2 col-span-2">
                  <input type="checkbox" checked={adj.resign_enabled} onChange={(e) => setAdj({ ...adj, resign_enabled: e.target.checked })} /> {t("wizard.cond.resign")}
                </label>
                <Field label={t("wizard.cond.moves")}>
                  <input className="input tnum" type="number" value={adj.resign_movecount} onChange={(e) => setAdj({ ...adj, resign_movecount: +e.target.value })} />
                </Field>
                <Field label="|score| ≥ cp">
                  <input className="input tnum" type="number" value={adj.resign_score} onChange={(e) => setAdj({ ...adj, resign_score: +e.target.value })} />
                </Field>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={adj.resign_twosided} onChange={(e) => setAdj({ ...adj, resign_twosided: e.target.checked })} /> {t("wizard.cond.twoSided")}
                </label>
                <Field label={t("wizard.cond.extra")}>
                  <input className="input mono" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="-ucinewgame-ms 60000" />
                </Field>
              </div>
            )}
          </Panel>
          )}
          {shownStep === "numa" && (
            <CoresPanel
              topo={topo}
              value={{ nodes, lanes, placement, smt, gpus: gpuList }}
              cards={cards}
              gpuEngines={gpuEngines}
              onChange={(v: Partial<CoresValue>) => {
                if (v.nodes) setNodes(v.nodes);
                if (v.lanes != null) {
                  keepLanes.current = false;
                  setLanes(v.lanes);
                }
                if (v.placement) setPlacement(v.placement);
                if (v.smt != null) setSmt(v.smt);
                if (v.gpus) setGpus(v.gpus);
              }}
              pair={pair}
              preview={preview}
            />
          )}
          <div className="flex justify-between">
            <button className="btn" disabled={stepIndex === 0} onClick={() => setStep(steps[stepIndex - 1])} data-testid="wizard-back">
              {t("app.common.back")}
            </button>
            <button className="btn" disabled={stepIndex === steps.length - 1} onClick={() => setStep(steps[stepIndex + 1])} data-testid="wizard-next">
              {t("app.common.next")}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="sticky top-0 flex flex-col gap-3">
            <Panel title={t("wizard.sum.title")}>
              {!preview ? (
                <Spinner />
              ) : (
                <div className="flex flex-col gap-2 text-[12.5px]" data-testid="wizard-summary">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="kpi-label">{t("wizard.sum.total")}</div>
                      <div className="kpi-value" data-testid="total-games">
                        {num(preview.total_games)}
                      </div>
                    </div>
                    <div>
                      <div className="kpi-label">{t("wizard.sum.eta")}</div>
                      <div className="kpi-value">{duration(preview.eta_s)}</div>
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">{t("wizard.sum.pairings")}</span>
                    <span className="tnum">
                      {preview.pairings} × {preview.games_per_pairing}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">{t("wizard.sum.perPass")}</span>
                    <span className="tnum">{preview.rounds_per_pass.join(", ")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">{t("wizard.sum.used")}</span>
                    <span className="tnum">
                      {t("wizard.sum.usedValue", { used: preview.openings_used, last: preview.last_opening })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">{t("cores.summary.games")}</span>
                    <span className="tnum">{preview.concurrent_games}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">{t("cores.summary.cpus")}</span>
                    <span className="tnum" style={{ color: preview.cpu_budget && preview.busy_threads > preview.cpu_budget ? "var(--loss)" : undefined }} data-testid="summary-cpus">
                      {t("cores.summary.busy", { busy: preview.busy_threads, budget: preview.cpu_budget, unit: t(smt ? "cores.unit.threads" : "cores.unit.cores", { count: preview.cpu_budget }) })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">{t("wizard.sum.ram")}</span>
                    <span className="tnum" style={{ color: preview.ram_needed_mb > preview.ram_total_mb * 0.85 ? "var(--loss)" : undefined }}>
                      {(preview.ram_needed_mb / 1024).toFixed(1)} / {(preview.ram_total_mb / 1024).toFixed(0)} GB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="muted">{t("wizard.sum.estGame")}</span>
                    <span className="tnum">{duration(preview.est_game_s)}</span>
                  </div>
                  {preview.event_example && <div className="mono text-[11px] muted break-all">{t("wizard.sum.event", { event: preview.event_example })}</div>}
                  {preview.errors.map((e, i) => (
                    <ErrorBox key={i} error={tm(e)} />
                  ))}
                  {preview.warnings.map((w, i) => (
                    <Warn key={i}>{tm(w)}</Warn>
                  ))}
                  {preview.errors.length === 0 && (
                    <div className="flex items-center gap-1.5" style={{ color: "var(--win)" }}>
                      <Check size={14} /> {t("wizard.sum.ready")}
                    </div>
                  )}
                </div>
              )}
            </Panel>
            <div className="flex gap-4 text-[12.5px] px-1" data-testid="wizard-broadcast">
              <span className="muted">{t("wizard.sum.broadcast")}</span>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={castLichess} onChange={(e) => setCastLichess(e.target.checked)} disabled={!settings?.lichess_token} /> Lichess
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={castCcrl} onChange={(e) => setCastCcrl(e.target.checked)} /> ccrl.live
              </label>
            </div>
            <div className="flex flex-col gap-2">
              <button className="btn btn-primary justify-center h-9" disabled={busy || (!!editId && !editing) || !preview || preview.errors.length > 0} onClick={() => create("start")} data-testid="create-start">
                <Play size={14} /> {editing ? t("wizard.sum.saveStart") : t("wizard.sum.createStart")}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn justify-center" disabled={busy || (!!editId && !editing) || !preview || preview.errors.length > 0} onClick={() => create("queue")}>
                  <ListPlus size={14} /> {editing ? t("wizard.sum.saveQueue") : t("wizard.sum.createQueue")}
                </button>
                <button className="btn justify-center" disabled={busy || (!!editId && !editing) || !preview || preview.errors.length > 0} onClick={() => create("draft")} data-testid="create-draft">
                  {editing ? <Save size={14} /> : <Plus size={14} />} {editing ? t("wizard.sum.saveChanges") : t("wizard.sum.saveDraft")}
                </button>
              </div>
            </div>
            {preview?.first_command && (
              <Panel title={t("wizard.sum.firstCommand")}>
                <pre className="mono text-[10.5px] whitespace-pre-wrap break-all max-h-[180px] overflow-auto">{preview.first_command}</pre>
              </Panel>
            )}
          </div>
        </div>
      </div>
      <Modal
        open={frcOpen}
        onOpenChange={setFrcOpen}
        title={t("wizard.frc.title")}
        footer={
          <button
            className="btn btn-primary"
            data-testid="frc-create"
            onClick={async () => {
              try {
                const r = await call<{ path: string; positions: number }>("chess960_book", { spec: frcSpec });
                setBook(r.path);
                setFrcOpen(false);
                toast.success(t("wizard.toast.frc", { count: r.positions, file: r.path.split(/[\\/]/).pop() ?? "" }));
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            {t("wizard.frc.generate")}
          </button>
        }
      >
        <div className="flex flex-col gap-3 text-[12.5px]">
          <Seg
            value={frcSpec.kind}
            onChange={(k) => setFrcSpec({ ...frcSpec, kind: k })}
            options={[
              { value: "all", label: t("wizard.frc.all") },
              { value: "random", label: t("wizard.frc.random") },
              { value: "double", label: t("wizard.frc.double") },
            ]}
          />
          <div className="muted">
            {frcSpec.kind === "all"
              ? t("wizard.frc.allAbout")
              : frcSpec.kind === "random"
                ? t("wizard.frc.randomAbout")
                : t("wizard.frc.doubleAbout")}{" "}
            {t("wizard.frc.sameSeed")}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {frcSpec.kind !== "all" && (
              <Field label={t("wizard.frc.positions")}>
                <input className="input tnum" type="number" min={1} value={frcSpec.count} onChange={(e) => setFrcSpec({ ...frcSpec, count: Math.max(1, +e.target.value) })} />
              </Field>
            )}
            <Field label={t("wizard.frc.seed")}>
              <input className="input tnum" type="number" min={0} value={frcSpec.seed} onChange={(e) => setFrcSpec({ ...frcSpec, seed: Math.max(0, +e.target.value) })} />
            </Field>
            <label className="flex items-end gap-2 pb-1.5">
              <input type="checkbox" checked={frcSpec.include_standard} onChange={(e) => setFrcSpec({ ...frcSpec, include_standard: e.target.checked })} /> {t("wizard.frc.standard")}
            </label>
          </div>
        </div>
      </Modal>
      <Modal
        open={optsFor != null}
        onOpenChange={(o) => !o && setOptsFor(null)}
        title={t("wizard.opts.title", { name: optsFor?.display_name ?? "" })}
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
              {t("wizard.opts.engine")}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (optsFor) setPartOpts({ ...partOpts, [optsFor.id!]: optsDraft });
                setOptsFor(null);
              }}
              data-testid="wizard-options-apply"
            >
              {t("wizard.opts.apply")}
            </button>
          </>
        }
      >
        {optsFor && <UciOptionsEditor key={`${optsFor.id}-${optsRev}`} options={optsFor.options} values={optsDraft} onChange={setOptsDraft} engineId={optsFor.id} dir={optsFor.dir} syzygyPath={syzygy} />}
      </Modal>
    </div>
  );
}

/** Positions in a seeded bracket of `size` (8 → 1 8 4 5 2 7 3 6), as the scheduler does. */
function bracketOrder(size: number): number[] {
  let v = [1];
  while (v.length < size) {
    const m = v.length * 2 + 1;
    v = v.flatMap((s) => [s, m - s]);
  }
  return v;
}

/** First-round matches of a cup: [higher seed, lower seed or null for a bye]. */
export function firstRound(names: string[]): [string, string | null][] {
  let size = 1;
  while (size < names.length) size *= 2;
  const o = bracketOrder(size);
  const out: [string, string | null][] = [];
  for (let k = 0; k < o.length; k += 2) {
    const [a, b] = [o[k], o[k + 1]].sort((x, y) => x - y);
    out.push([names[a - 1], b <= names.length ? names[b - 1] : null]);
  }
  return out;
}
