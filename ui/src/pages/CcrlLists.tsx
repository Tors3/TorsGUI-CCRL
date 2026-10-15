import { CloudDownload, ClipboardPaste, Download, FileUp, Link2, PackageOpen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { CcrlList } from "../bindings/CcrlList";
import type { EngineEntry } from "../bindings/EngineEntry";
import type { ListSource } from "../bindings/ListSource";
import type { MatchCandidate } from "../bindings/MatchCandidate";
import type { Suggestion } from "../bindings/Suggestion";
import type { Threshold } from "../bindings/Threshold";
import type { TournamentSummary } from "../bindings/TournamentSummary";
import { Empty, ErrorBox, Field, Modal, PageHeader, Panel, Seg, Spinner, PageTabs, useTabParam, Warn } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { num } from "../lib/format";
import { useT } from "../i18n";

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
  const tr = useT();
  const go = async () => {
    setBusy(true);
    try {
      const r = await call<{ entries: number }>("ccrl_import_text", { list, variant, cpu: "mixed", text });
      toast.success(tr("ccrl.imp.imported", { count: r.entries }));
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={setOpen} title={tr("ccrl.imp.title")} width={760} footer={<button className="btn btn-primary" onClick={go} disabled={!text || busy}>{busy && <Spinner />} {tr("ccrl.imp.import")}</button>}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <Field label={tr("ccrl.imp.list")}>
            <Seg value={list} onChange={setList} options={[{ value: "Blitz", label: "Blitz" }, { value: "40/15", label: "40/15" }, { value: "FRC", label: "FRC" }]} />
          </Field>
          <Field label={tr("ccrl.imp.variant")}>
            <Seg value={variant} onChange={setVariant} options={[{ value: "all", label: tr("ccrl.imp.allVersions") }, { value: "best", label: tr("ccrl.imp.bestVersions") }]} />
          </Field>
        </div>
        <label className="btn self-start">
          <FileUp size={14} /> {tr("ccrl.imp.open")}
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
              toast.info(tr("ccrl.imp.loaded", { name: f.name }));
            }}
          />
        </label>
        <p className="muted text-[12px] -mt-1">
          {tr("ccrl.imp.browser1")}<b>{tr("ccrl.imp.browser2")}</b>{tr("ccrl.imp.browser3")}
        </p>
        <Field label={tr("ccrl.imp.paste")} hint={tr("ccrl.imp.pasteHint")}>
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
  const nav = useNavigate();
  const tr = useT();
  const [sel, setSel] = useState<number | null>(null);
  const [tab, setTab] = useTabParam(["lists", "suggest", "match", "threshold"] as const, "lists");
  const [cpu, setCpu] = useState("all");
  const [q, setQ] = useState("");
  const [imp, setImp] = useState(false);
  const [fetching, setFetching] = useState<string | null>(null);
  const cur = lists?.find((l) => l.id === sel) ?? lists?.[0];
  const installed = useMemo(() => new Map((engines ?? []).map((e) => [norm(e.display_name), e])), [engines]);
  const aliasMap = useMemo(() => new Map((aliases ?? []).map(([a, c]) => [norm(c), a])), [aliases]);
  // lists with the very same rows: downloaded from a page of another list (fixed in 0.5.2)
  const twins = useMemo(() => {
    const out: string[] = [];
    const ls = lists ?? [];
    const same = (a: CcrlList, b: CcrlList) => a.entries.length === b.entries.length && a.entries.length > 0 && a.entries.every((e, i) => e.name === b.entries[i].name && e.rating === b.entries[i].rating);
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) if ((ls[i].list !== ls[j].list || ls[i].variant !== ls[j].variant) && same(ls[i], ls[j])) out.push(`${ls[i].list} ${ls[i].variant} = ${ls[j].list} ${ls[j].variant}`);
    return out;
  }, [lists]);
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
      toast.success(tr("ccrl.fetched", { list: s.list, variant: s.variant, count: r.entries }));
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
      if (r.done.length) toast.success(tr("ccrl.downloaded", { list: r.done.map((d) => `${d.list} ${d.variant} (${d.entries})`).join(", ") }));
      if (r.failed.length) toast.error(tr("ccrl.notReachable", { list: r.failed.map((d) => `${d.list} ${d.variant}`).join(", ") }), { duration: 12000 });
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
    toast.success(tr("ccrl.aliasSaved", { alias: matchQ, name: canonical }));
    refreshAliases();
  };
  const thresholds = async () => {
    const t = ts?.find((x) => x.record.id === tid);
    if (!t) return;
    const d = await call<{ standings: { rows: { rating: number | null; games: number }[] } }>("tournament_get", { id: tid });
    const opps: [number, number][] = d.standings.rows.filter((r) => r.rating != null).map((r) => [r.rating!, r.games]);
    if (!opps.length) {
      toast.error(tr("ccrl.noRatings"));
      return;
    }
    setThr(await call<Threshold[]>("ccrl_thresholds", { list: t.record.config.ccrl_list || "Blitz", cpus: t.record.config.threads, opponents: opps, ranks: ranks.split(",").map((x) => Number(x.trim())).filter(Boolean) }));
  };

  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader help="ccrl-lists"
        title={tr("ccrl.title")}
        sub={tr("ccrl.sub")}
        actions={
          <button className="btn btn-primary" onClick={() => setImp(true)}>
            <ClipboardPaste size={14} /> {tr("ccrl.manual")}
          </button>
        }
      />
      <ErrorBox error={error} />
      <PageTabs
        tabs={[
          { id: "lists", label: tr("ccrl.tabs.lists") },
          { id: "suggest", label: tr("ccrl.tabs.suggest") },
          { id: "match", label: tr("ccrl.tabs.match"), badge: aliases?.length || undefined },
          { id: "threshold", label: tr("ccrl.tabs.threshold") },
        ]}
        value={tab}
        onChange={setTab}
        testid="ccrl-tab"
      />
      {tab === "lists" && twins.length > 0 && (
        <Warn>
          {tr("ccrl.twins1", { list: twins.join(", ") })}<b>{tr("ccrl.twins2")}</b>{tr("ccrl.twins3")}
        </Warn>
      )}
      {tab === "lists" && (
      <div className="grid gap-3 ccrl-grid">
        <div className="flex flex-col gap-3">
          <Panel title={tr("ccrl.lists")} noPad>
            {(lists ?? []).length === 0 && <Empty>{tr("ccrl.noList")}</Empty>}
            {(lists ?? []).map((l) => (
              <button key={l.id} className="w-full text-left px-3 py-2 flex justify-between items-center" style={{ background: cur?.id === l.id ? "var(--accent-bg)" : undefined, borderBottom: "1px solid var(--border)" }} onClick={() => setSel(l.id)}>
                <span>
                  <span className="font-medium">
                    {l.list} · {l.variant}
                  </span>
                  <span className="block muted text-[11px]">
                    {tr("ccrl.listLine", { count: l.entries.length, source: l.source === "manual import" ? tr("ccrl.manualSrc") : l.source.startsWith("bundled") ? tr("ccrl.bundledSrc", { date: l.source.match(/\(([^)]+)\)/)?.[1] ?? "" }) : tr("ccrl.siteSrc"), date: l.fetched_at.slice(0, 10) })}
                  </span>
                </span>
                <span
                  role="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label={tr("ccrl.deleteList")}
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
          <Panel title={tr("ccrl.fetchTitle")} noPad>
            <div className="flex gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <button className="btn btn-sm btn-primary" disabled={!!fetching} onClick={fetchAll} data-testid="ccrl-fetch-all">
                {fetching === "all" ? <Spinner size={12} /> : <CloudDownload size={13} />} {tr("ccrl.fetchAll")}
              </button>
              <button
                className="btn btn-sm"
                title={tr("ccrl.bundledTip")}
                onClick={async () => {
                  await call("ccrl_load_snapshot");
                  toast.success(tr("ccrl.bundledRestored"));
                  refresh();
                }}
                data-testid="ccrl-snapshot"
              >
                <PackageOpen size={13} /> {tr("ccrl.bundled")}
              </button>
            </div>
            {(sources ?? []).map((s) => (
              <button key={s.url} className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] hover:bg-[var(--hover)]" style={{ borderBottom: "1px solid var(--border)" }} onClick={() => fetchSrc(s)} title={s.url}>
                {fetching === s.url ? <Spinner size={12} /> : <CloudDownload size={13} />} {s.list} · {s.variant}
              </button>
            ))}
            <div className="px-3 py-2 muted text-[11px]">{tr("ccrl.fetchAbout")}</div>
          </Panel>
        </div>
        <Panel
          title={cur ? tr("ccrl.listTitle", { list: cur.list, variant: cur.variant }) : tr("ccrl.list")}
          noPad
          actions={
            <>
              <input className="input" style={{ width: 160 }} placeholder={tr("ccrl.search")} value={q} onChange={(e) => setQ(e.target.value)} />
              <Seg value={cpu} onChange={setCpu} options={[{ value: "1", label: "1CPU" }, { value: "4", label: "4CPU" }, { value: "8", label: "8CPU" }, { value: "all", label: tr("ccrl.all") }]} />
            </>
          }
        >
          {cur && (
            <div className="px-3 py-1.5 muted text-[11.5px] truncate" style={{ borderBottom: "1px solid var(--border)" }} title={cur.source} data-testid="ccrl-source">
              {tr("ccrl.source", { count: cur.entries.length, source: cur.source, date: cur.fetched_at.slice(0, 16).replace("T", " ") })}
            </div>
          )}
          <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 230px)" }}>
            <table className="tbl" data-testid="ccrl-table">
              <thead>
                <tr>
                  <th className="r">{tr("ccrl.rank")}</th>
                  <th>{tr("ccrl.engine")}</th>
                  <th className="r">{tr("ccrl.rating")}</th>
                  <th className="r">±</th>
                  <th className="r">{tr("ccrl.games")}</th>
                  <th className="r">{tr("ccrl.score")}</th>
                  <th>{tr("ccrl.library")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const inst = installed.get(norm(e.name)) ?? (aliasMap.get(norm(e.name)) ? installed.get(norm(aliasMap.get(norm(e.name))!)) : undefined);
                  return (
                    <tr key={`${e.rank}-${e.name}`} className="clickable" onClick={() => nav(`/engines?github=${encodeURIComponent(e.name)}&list=${encodeURIComponent(cur?.list ?? "Blitz")}`)} title={tr("ccrl.downloadTip")}>
                      <td className="r tnum muted">{e.rank}</td>
                      <td className="font-medium">{e.name}</td>
                      <td className="r tnum">{num(e.rating)}</td>
                      <td className="r tnum muted">{e.err_plus != null ? num(e.err_plus) : ""}</td>
                      <td className="r tnum muted">{e.games != null ? num(e.games) : ""}</td>
                      <td className="r tnum muted">{e.score != null ? `${e.score}%` : ""}</td>
                      <td>
                        {inst ? (
                          <span className="chip chip-win">{inst.display_name}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 muted text-[11.5px] row-get">
                            <Download size={12} /> {tr("ccrl.get")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      {tr("ccrl.noEntry")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
        </div>
      )}
      {tab === "suggest" && (
        <Panel title={cur ? `${tr("ccrl.suggestTitle")} · ${cur.list} ${cur.variant}` : tr("ccrl.suggestTitle")} className="max-w-[860px]">
          <div className="flex flex-col gap-2">
              <p className="muted text-[12px]">{tr("ccrl.suggestAbout")}</p>
              <div className="grid grid-cols-3 gap-2">
                <Field label={tr("ccrl.topN")}>
                  <input className="input tnum" type="number" value={top} onChange={(e) => setTop(+e.target.value)} />
                </Field>
                <Field label={tr("ccrl.threads")}>
                  <input className="input tnum" type="number" value={threads} onChange={(e) => setThreads(+e.target.value)} />
                </Field>
                <label className="flex items-end gap-1.5 pb-1.5">
                  <input type="checkbox" checked={onlyInst} onChange={(e) => setOnlyInst(e.target.checked)} /> {tr("ccrl.installedOnly")}
                </label>
              </div>
              <button className="btn" onClick={suggest} disabled={!cur}>
                {tr("ccrl.suggest", { cpu: cpu === "all" ? 1 : cpu })}
              </button>
              <div className="max-h-[560px] overflow-auto">
                {sugg.map((s) => (
                  <div key={s.list_name} className="flex justify-between py-1 text-[12px]" style={{ borderBottom: "1px solid var(--border)" }}>
                    <span className="truncate">
                      <span className="muted tnum mr-1.5">{s.rank}</span>
                      {s.list_name}
                      {s.note && <span className="chip chip-warn ml-1">{s.note}</span>}
                    </span>
                    <span className="flex gap-1.5 items-center shrink-0">
                      <span className="tnum">{num(s.rating)}</span>
                      {s.installed_name ? <span className="chip chip-win">{tr("ccrl.installed")}</span> : <span className="chip">{tr("ccrl.missing")}</span>}
                    </span>
                  </div>
                ))}
              </div>
          </div>
        </Panel>
      )}
      {tab === "match" && (
        <Panel title={cur ? `${tr("ccrl.matchTitle")} · ${cur.list} ${cur.variant}` : tr("ccrl.matchTitle")} className="max-w-[860px]">
          <div className="flex flex-col gap-2">
              <p className="muted text-[12px]">{tr("ccrl.matchAbout")}</p>
              <div className="flex gap-2">
                <input className="input" value={matchQ} onChange={(e) => setMatchQ(e.target.value)} placeholder={tr("ccrl.matchPlaceholder")} onKeyDown={(e) => e.key === "Enter" && match()} />
                <button className="btn" onClick={match} disabled={!matchQ}>
                  {tr("ccrl.match")}
                </button>
              </div>
              {cands.map((c) => (
                <div key={c.name} className="flex items-center justify-between text-[12px]">
                  <span>
                    {c.name} <span className="muted tnum">{(c.score * 100).toFixed(0)}%</span>
                  </span>
                  <button className="btn btn-sm" onClick={() => saveAlias(c.name)}>
                    <Link2 size={12} /> {tr("ccrl.confirm")}
                  </button>
                </div>
              ))}
              <div className="kpi-label mt-2">{tr("ccrl.aliases")}</div>
              <div className="max-h-[220px] overflow-auto">
                {(aliases ?? []).map(([a, c]) => (
                  <div key={a} className="flex justify-between text-[12px] py-0.5">
                    <span className="truncate">
                      {a} ↔ {c}
                    </span>
                    <button className="btn btn-ghost btn-icon btn-sm" aria-label={tr("ccrl.deleteAlias")} onClick={() => call("alias_delete", { alias: a }).then(refreshAliases)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
          </div>
        </Panel>
      )}
      {tab === "threshold" && (
        <Panel title={cur ? `${tr("ccrl.thresholdTitle")} · ${cur.list} ${cur.variant}` : tr("ccrl.thresholdTitle")} className="max-w-[860px]">
          <div className="flex flex-col gap-2">
              <p className="muted text-[12px]">{tr("ccrl.thresholdAbout")}</p>
              <Field label={tr("ccrl.tournament")}>
                <select className="select" value={tid} onChange={(e) => setTid(e.target.value)}>
                  <option value="">—</option>
                  {(ts ?? []).map((t) => (
                    <option key={t.record.id} value={t.record.id}>
                      {t.record.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr("ccrl.ranks")}>
                <input className="input" value={ranks} onChange={(e) => setRanks(e.target.value)} />
              </Field>
              <button className="btn" onClick={thresholds} disabled={!tid}>
                {tr("ccrl.compute")}
              </button>
              {thr.map((t) => (
                <div key={t.rank} className="text-[12px] py-1" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="flex justify-between">
                    <span>
                      {tr("ccrl.pass", { rank: t.rank, name: t.target_name, rating: num(t.target_rating) })}
                    </span>
                    <span className="tnum font-semibold">
                      {t.points_needed}/{t.games}
                    </span>
                  </div>
                  <div className="muted tnum">
                    {t.pct_needed.toFixed(1)}% {t.reachable ? "" : tr("ccrl.notReachableShort")}
                  </div>
                </div>
              ))}
          </div>
        </Panel>
      )}
      <ImportDialog open={imp} setOpen={setImp} onDone={refresh} />
    </div>
  );
}
