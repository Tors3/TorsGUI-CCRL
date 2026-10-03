import * as Tabs from "@radix-ui/react-tabs";
import { CloudDownload, ClipboardPaste, FileUp, Link2, PackageOpen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { CcrlList } from "../bindings/CcrlList";
import type { EngineEntry } from "../bindings/EngineEntry";
import type { ListSource } from "../bindings/ListSource";
import type { MatchCandidate } from "../bindings/MatchCandidate";
import type { Suggestion } from "../bindings/Suggestion";
import type { Threshold } from "../bindings/Threshold";
import type { TournamentSummary } from "../bindings/TournamentSummary";
import { Empty, ErrorBox, Field, Modal, PageHeader, Panel, Seg, Spinner } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { num } from "../lib/format";

const cpusOf = (n: string) => Number(/(\d+)\s*CPU/i.exec(n)?.[1] ?? 1);
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/64-?bit|\d+\s*cpu|\(.*?\)/g, " ")
    .replace(/\bv(\d)/g, "$1")
    .replace(/[^a-z0-9.]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((t) => (/^[\d.]+$/.test(t) ? t.replace(/(\.0)+$/, "") : t))
    .join(" ");

function ImportDialog({ open, setOpen, onDone }: { open: boolean; setOpen: (o: boolean) => void; onDone: () => void }) {
  const [list, setList] = useState("Blitz");
  const [variant, setVariant] = useState("all");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await call<{ entries: number }>("ccrl_import_text", { list, variant, cpu: "mixed", text });
      toast.success(`${r.entries} entries imported`);
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={setOpen} title="Manual import" width={760} footer={<button className="btn btn-primary" onClick={go} disabled={!text || busy}>{busy && <Spinner />} Import</button>}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <Field label="List">
            <Seg value={list} onChange={setList} options={[{ value: "Blitz", label: "Blitz" }, { value: "40/15", label: "40/15" }, { value: "FRC", label: "FRC" }]} />
          </Field>
          <Field label="Variant">
            <Seg value={variant} onChange={setVariant} options={[{ value: "all", label: "All versions" }, { value: "best", label: "Best versions" }]} />
          </Field>
        </div>
        <label className="btn self-start">
          <FileUp size={14} /> Open a saved page (.html, .txt, .csv)
          <input
            type="file"
            accept=".html,.htm,.txt,.csv"
            className="hidden"
            data-testid="ccrl-file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setText(await f.text());
              const n = f.name.toLowerCase();
              if (/frc|960/.test(n)) setList("FRC");
              else if (/4040|40.?15/.test(n)) setList("40/15");
              toast.info(`${f.name} loaded: check list and variant, then Import`);
            }}
          />
        </label>
        <p className="muted text-[12px] -mt-1">
          In the browser: open the list on computerchess.org.uk, <b>Save page as… (HTML only)</b>, then open the file here.
        </p>
        <Field label="Paste the table (copied from the CCRL page), HTML, or CSV (rank,name,rating or name,rating)" hint="CPU categories are read from the names (… 64-bit 8CPU); names without a CPU suffix are 1CPU.">
          <textarea className="textarea" rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={"1  Stockfish 17 64-bit 8CPU  3791  +14 −14  ...\n2  ..."} data-testid="ccrl-paste" />
        </Field>
      </div>
    </Modal>
  );
}

export function CcrlLists() {
  const { data: lists, error, refresh } = usePoll<CcrlList[]>("ccrl_lists", {}, 0);
  const { data: sources } = usePoll<ListSource[]>("ccrl_sources", {}, 0);
  const { data: engines } = usePoll<EngineEntry[]>("engines_list", {}, 0);
  const { data: ts } = usePoll<TournamentSummary[]>("tournaments_list", {}, 0);
  const { data: aliases, refresh: refreshAliases } = usePoll<[string, string, string][]>("aliases_list", {}, 0);
  const [sel, setSel] = useState<number | null>(null);
  const [cpu, setCpu] = useState("all");
  const [q, setQ] = useState("");
  const [imp, setImp] = useState(false);
  const [fetching, setFetching] = useState<string | null>(null);
  const cur = lists?.find((l) => l.id === sel) ?? lists?.[0];
  const installed = useMemo(() => new Map((engines ?? []).map((e) => [norm(e.display_name), e])), [engines]);
  const aliasMap = useMemo(() => new Map((aliases ?? []).map(([a, c]) => [norm(c), a])), [aliases]);
  const rows = (cur?.entries ?? []).filter((e) => (cpu === "all" || cpusOf(e.name) === Number(cpu)) && (!q || e.name.toLowerCase().includes(q.toLowerCase())));

  // tools
  const [top, setTop] = useState(30);
  const [threads, setThreads] = useState(8);
  const [onlyInst, setOnlyInst] = useState(false);
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [matchQ, setMatchQ] = useState("");
  const [cands, setCands] = useState<MatchCandidate[]>([]);
  const [tid, setTid] = useState("");
  const [ranks, setRanks] = useState("1,5,10,20,30");
  const [thr, setThr] = useState<Threshold[]>([]);

  const fetchSrc = async (s: ListSource) => {
    setFetching(s.url);
    try {
      const r = await call<{ entries: number }>("ccrl_fetch", { source: s });
      toast.success(`${s.list} ${s.variant}: ${r.entries} entries`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message, { duration: 12000 });
    } finally {
      setFetching(null);
    }
  };
  const fetchAll = async () => {
    setFetching("all");
    try {
      const r = await call<{ done: { list: string; variant: string; entries: number }[]; failed: { list: string; variant: string; error: string }[] }>("ccrl_fetch_all");
      if (r.done.length) toast.success(`Downloaded: ${r.done.map((d) => `${d.list} ${d.variant} (${d.entries})`).join(", ")}`);
      if (r.failed.length) toast.error(`Not reachable: ${r.failed.map((d) => `${d.list} ${d.variant}`).join(", ")} — the bundled or previous lists stay in use`, { duration: 12000 });
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFetching(null);
    }
  };
  const suggest = async () => setSugg(await call<Suggestion[]>("ccrl_suggest", { list: cur?.list ?? "Blitz", cpus: Number(cpu === "all" ? 1 : cpu), top, threads, only_installed: onlyInst }));
  const match = async () => setCands(await call<MatchCandidate[]>("ccrl_match", { name: matchQ }));
  const saveAlias = async (canonical: string) => {
    await call("alias_set", { alias: matchQ, canonical });
    toast.success(`"${matchQ}" ↔ "${canonical}" saved`);
    refreshAliases();
  };
  const thresholds = async () => {
    const t = ts?.find((x) => x.record.id === tid);
    if (!t) return;
    const d = await call<{ standings: { rows: { rating: number | null; games: number }[] } }>("tournament_get", { id: tid });
    const opps: [number, number][] = d.standings.rows.filter((r) => r.rating != null).map((r) => [r.rating!, r.games]);
    if (!opps.length) {
      toast.error("The tournament's opponents have no ratings");
      return;
    }
    setThr(await call<Threshold[]>("ccrl_thresholds", { list: t.record.config.ccrl_list || "Blitz", cpus: t.record.config.threads, opponents: opps, ranks: ranks.split(",").map((x) => Number(x.trim())).filter(Boolean) }));
  };

  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader help="ccrl-lists"
        title="CCRL Lists"
        sub="Blitz and 40/15, 1CPU/4CPU/8CPU, all and best versions — fetched from computerchess.org.uk or imported by hand"
        actions={
          <button className="btn btn-primary" onClick={() => setImp(true)}>
            <ClipboardPaste size={14} /> Manual import
          </button>
        }
      />
      <ErrorBox error={error} />
      <div className="grid gap-3 ccrl-grid">
        <div className="flex flex-col gap-3">
          <Panel title="Lists" noPad>
            {(lists ?? []).length === 0 && <Empty>No list yet.</Empty>}
            {(lists ?? []).map((l) => (
              <button key={l.id} className="w-full text-left px-3 py-2 flex justify-between items-center" style={{ background: cur?.id === l.id ? "var(--accent-bg)" : undefined, borderBottom: "1px solid var(--border)" }} onClick={() => setSel(l.id)}>
                <span>
                  <span className="font-medium">
                    {l.list} · {l.variant}
                  </span>
                  <span className="block muted text-[11px]">
                    {l.entries.length} engines · {l.source === "manual import" ? "manual" : l.source.startsWith("bundled") ? `bundled (${l.source.match(/\(([^)]+)\)/)?.[1] ?? ""})` : "site"} · {l.fetched_at.slice(0, 10)}
                  </span>
                </span>
                <span
                  role="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label="Delete list"
                  onClick={(e) => {
                    e.stopPropagation();
                    call("ccrl_delete_list", { id: l.id }).then(refresh);
                  }}
                >
                  <Trash2 size={12} />
                </span>
              </button>
            ))}
          </Panel>
          <Panel title="Fetch from the site" noPad>
            <div className="flex gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <button className="btn btn-sm btn-primary" disabled={!!fetching} onClick={fetchAll} data-testid="ccrl-fetch-all">
                {fetching === "all" ? <Spinner size={12} /> : <CloudDownload size={13} />} Fetch all
              </button>
              <button
                className="btn btn-sm"
                title="Blitz, 40/15 and FRC (best versions) as bundled with TorsGUI"
                onClick={async () => {
                  await call("ccrl_load_snapshot");
                  toast.success("Bundled CCRL lists restored");
                  refresh();
                }}
                data-testid="ccrl-snapshot"
              >
                <PackageOpen size={13} /> Bundled lists
              </button>
            </div>
            {(sources ?? []).map((s) => (
              <button key={s.url} className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] hover:bg-[var(--hover)]" style={{ borderBottom: "1px solid var(--border)" }} onClick={() => fetchSrc(s)} title={s.url}>
                {fetching === s.url ? <Spinner size={12} /> : <CloudDownload size={13} />} {s.list} · {s.variant}
              </button>
            ))}
            <div className="px-3 py-2 muted text-[11px]">Each list tries several addresses and the site's text export. If the site refuses the download, the bundled lists stay in use; a page saved from the browser can be opened with Manual import.</div>
          </Panel>
        </div>
        <Panel
          title={cur ? `${cur.list} — ${cur.variant} versions` : "List"}
          noPad
          actions={
            <>
              <input className="input" style={{ width: 160 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
              <Seg value={cpu} onChange={setCpu} options={[{ value: "1", label: "1CPU" }, { value: "4", label: "4CPU" }, { value: "8", label: "8CPU" }, { value: "all", label: "All" }]} />
            </>
          }
        >
          <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 200px)" }}>
            <table className="tbl" data-testid="ccrl-table">
              <thead>
                <tr>
                  <th className="r">Rank</th>
                  <th>Engine</th>
                  <th className="r">Rating</th>
                  <th className="r">±</th>
                  <th className="r">Games</th>
                  <th className="r">Score</th>
                  <th>Library</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const inst = installed.get(norm(e.name)) ?? (aliasMap.get(norm(e.name)) ? installed.get(norm(aliasMap.get(norm(e.name))!)) : undefined);
                  return (
                    <tr key={`${e.rank}-${e.name}`}>
                      <td className="r tnum muted">{e.rank}</td>
                      <td className="font-medium">{e.name}</td>
                      <td className="r tnum">{num(e.rating)}</td>
                      <td className="r tnum muted">{e.err_plus != null ? num(e.err_plus) : ""}</td>
                      <td className="r tnum muted">{e.games != null ? num(e.games) : ""}</td>
                      <td className="r tnum muted">{e.score != null ? `${e.score}%` : ""}</td>
                      <td>{inst ? <span className="chip chip-win">{inst.display_name}</span> : ""}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No entry in this category.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="flex flex-col gap-3 min-w-0">
          <Tabs.Root defaultValue="suggest" className="panel">
            <Tabs.List className="tabs px-2" aria-label="Tools">
              <Tabs.Trigger className="tab" value="suggest">Opponents</Tabs.Trigger>
              <Tabs.Trigger className="tab" value="match">Name matching</Tabs.Trigger>
              <Tabs.Trigger className="tab" value="threshold">Threshold</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="suggest" className="p-3 flex flex-col gap-2">
              <p className="muted text-[12px]">Top N of the list, latest version that appears in it, filtered by what is installed and by thread support.</p>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Top N">
                  <input className="input tnum" type="number" value={top} onChange={(e) => setTop(+e.target.value)} />
                </Field>
                <Field label="Threads">
                  <input className="input tnum" type="number" value={threads} onChange={(e) => setThreads(+e.target.value)} />
                </Field>
                <label className="flex items-end gap-1.5 pb-1.5">
                  <input type="checkbox" checked={onlyInst} onChange={(e) => setOnlyInst(e.target.checked)} /> installed
                </label>
              </div>
              <button className="btn" onClick={suggest} disabled={!cur}>
                Suggest ({cpu === "all" ? 1 : cpu}CPU)
              </button>
              <div className="max-h-[420px] overflow-auto">
                {sugg.map((s) => (
                  <div key={s.list_name} className="flex justify-between py-1 text-[12px]" style={{ borderBottom: "1px solid var(--border)" }}>
                    <span className="truncate">
                      <span className="muted tnum mr-1.5">{s.rank}</span>
                      {s.list_name}
                      {s.note && <span className="chip chip-warn ml-1">{s.note}</span>}
                    </span>
                    <span className="flex gap-1.5 items-center shrink-0">
                      <span className="tnum">{num(s.rating)}</span>
                      {s.installed_name ? <span className="chip chip-win">installed</span> : <span className="chip">missing</span>}
                    </span>
                  </div>
                ))}
              </div>
            </Tabs.Content>
            <Tabs.Content value="match" className="p-3 flex flex-col gap-2">
              <p className="muted text-[12px]">Fuzzy matching between list, library and PGN names (e.g. “Integral v8” ↔ “Integral 8”). Confirm a candidate to store the alias.</p>
              <div className="flex gap-2">
                <input className="input" value={matchQ} onChange={(e) => setMatchQ(e.target.value)} placeholder="Name as in the PGN / library" onKeyDown={(e) => e.key === "Enter" && match()} />
                <button className="btn" onClick={match} disabled={!matchQ}>
                  Match
                </button>
              </div>
              {cands.map((c) => (
                <div key={c.name} className="flex items-center justify-between text-[12px]">
                  <span>
                    {c.name} <span className="muted tnum">{(c.score * 100).toFixed(0)}%</span>
                  </span>
                  <button className="btn btn-sm" onClick={() => saveAlias(c.name)}>
                    <Link2 size={12} /> Confirm
                  </button>
                </div>
              ))}
              <div className="kpi-label mt-2">Aliases</div>
              <div className="max-h-[220px] overflow-auto">
                {(aliases ?? []).map(([a, c]) => (
                  <div key={a} className="flex justify-between text-[12px] py-0.5">
                    <span className="truncate">
                      {a} ↔ {c}
                    </span>
                    <button className="btn btn-ghost btn-icon btn-sm" aria-label="Delete alias" onClick={() => call("alias_delete", { alias: a }).then(refreshAliases)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </Tabs.Content>
            <Tabs.Content value="threshold" className="p-3 flex flex-col gap-2">
              <p className="muted text-[12px]">Score the seed needs, against its actual opponents, for its performance to pass rank k of its CPU category.</p>
              <Field label="Tournament">
                <select className="select" value={tid} onChange={(e) => setTid(e.target.value)}>
                  <option value="">—</option>
                  {(ts ?? []).map((t) => (
                    <option key={t.record.id} value={t.record.id}>
                      {t.record.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ranks">
                <input className="input" value={ranks} onChange={(e) => setRanks(e.target.value)} />
              </Field>
              <button className="btn" onClick={thresholds} disabled={!tid}>
                Compute
              </button>
              {thr.map((t) => (
                <div key={t.rank} className="text-[12px] py-1" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="flex justify-between">
                    <span>
                      pass #{t.rank} {t.target_name} ({num(t.target_rating)})
                    </span>
                    <span className="tnum font-semibold">
                      {t.points_needed}/{t.games}
                    </span>
                  </div>
                  <div className="muted tnum">
                    {t.pct_needed.toFixed(1)}% {t.reachable ? "" : "· not reachable"}
                  </div>
                </div>
              ))}
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>
      <ImportDialog open={imp} setOpen={setImp} onDone={refresh} />
    </div>
  );
}
