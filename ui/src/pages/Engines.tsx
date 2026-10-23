import { CheckCircle2, ChevronDown, ChevronRight, Copy, FileText, FolderInput, FolderOpen, FolderPlus, Pencil, PackagePlus, RefreshCw, Search, Trash2, XCircle } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { AssetPolicy } from "../bindings/AssetPolicy";
import type { BundledEngine } from "../bindings/BundledEngine";
import type { CuteEngine } from "../bindings/CuteEngine";
import type { EngineEntry } from "../bindings/EngineEntry";
import type { Gpu } from "../bindings/Gpu";
import type { KnownRepo } from "../bindings/KnownRepo";
import type { Settings } from "../bindings/Settings";
import type { Release } from "../bindings/Release";
import type { RepoRef } from "../bindings/RepoRef";
import type { Selection } from "../bindings/Selection";
import { UciOptionsEditor } from "../components/UciOptions";
import { FolderImportDialog, RefreshFoldersButton } from "../components/FolderImport";
import { FolderColorMenu, FolderIcon, FolderNameDialog, useFolderColors } from "../components/Folders";
import { cmpNum, EloCell, matchesEngine, RATING_LISTS, SortTh, useEngineRatings, type RatingList, type SortDir } from "../components/EngineRatings";
import { ENGINE_FILTERS, PathInput } from "../components/PathInput";
import { Empty, ErrorBox, Field, Modal, PageHeader, PageTabs, Panel, Spinner, Tip, MenuButton, useTabParam } from "../components/ui";
import { useT } from "../i18n";
import { call, usePoll } from "../lib/api";

const ALL_FOLDERS = "\u0000all";
const NO_FOLDER = "\u0000none";

type ReleasesResp = { repo: RepoRef; latest_stable: string | null; releases: { release: Release; selection: Selection }[]; policy: AssetPolicy };

/** An engine to get, from a CCRL list row: its repository when known and the version listed. */
export type GithubTarget = { name: string; family: string; version: string; repo: KnownRepo | null; homepage: string | null; source: string };

/** The release whose tag carries the version ("v9.0.0", "sf_19", "Koivisto_9.0" for "9.0"). */
export function tagForVersion(tags: string[], version: string): string | undefined {
  const norm = (v: string) => (v.match(/\d+(?:[._]\d+)*/)?.[0] ?? "").replace(/_/g, ".").replace(/(\.0)+$/, "");
  const want = norm(version);
  if (!want) return undefined;
  return tags.find((t) => norm(t) === want);
}

/**
 * Installs an engine from its GitHub releases. `queue`: one of several engines installed in a
 * row (CCRL list, suggested opponents): the title says which, and *Skip* goes to the next.
 */
export function GithubDialog({ open, setOpen, onDone, target, queue }: { open: boolean; setOpen: (o: boolean) => void; onDone: (e?: EngineEntry) => void; target?: GithubTarget | null; queue?: { n: number; total: number; onSkip: () => void } }) {
  const [url, setUrl] = useState("");
  const [versionNote, setVersionNote] = useState<string>();
  const [data, setData] = useState<ReleasesResp>();
  const [tag, setTag] = useState<string>();
  const [asset, setAsset] = useState<string>();
  const [busy, setBusy] = useState<"list" | "install" | null>(null);
  const [error, setError] = useState<string>();
  const tr = useT();
  // AVX2 only, or the AVX-512 build when this CPU runs it (CCRL accepts both)
  const [avx2Only, setAvx2Only] = useState<boolean | null>(null);
  useEffect(() => {
    if (open && avx2Only == null) call<Settings>("settings_get").then((s) => setAvx2Only(s.avx2_only)).catch(() => setAvx2Only(false));
  }, [open, avx2Only]);
  const policyArgs = { avx2_only: avx2Only ?? false };
  useEffect(() => {
    if (data) list();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avx2Only]);
  const [known, setKnown] = useState<KnownRepo[]>();
  const [kq, setKq] = useState("");
  useEffect(() => {
    if (open && !known) call<KnownRepo[]>("known_repos").then(setKnown).catch(() => setKnown([]));
  }, [open, known]);
  const list = async (u: string = url, version?: string) => {
    setBusy("list");
    setError(undefined);
    setVersionNote(undefined);
    try {
      const d = await call<ReleasesResp>("github_releases", { url: u, ...policyArgs });
      setData(d);
      const wanted = version ? tagForVersion(d.releases.map((r) => r.release.tag), version) : undefined;
      if (version && !wanted) setVersionNote(tr("engines.gh.noTag", { version }));
      const t = wanted ?? d.repo.tag ?? d.latest_stable ?? d.releases[0]?.release.tag;
      setTag(t ?? undefined);
      setAsset(d.releases.find((r) => r.release.tag === t)?.selection.chosen ?? undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  // opened from a CCRL list: the engine's repository and the version of the list
  useEffect(() => {
    if (!open || !target) return;
    if (target.repo) {
      setUrl(target.repo.repo);
      list(target.repo.repo, target.version);
    } else {
      setUrl("");
      setData(undefined);
      setError(undefined);
      setKq(target.family);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);
  const cur = data?.releases.find((r) => r.release.tag === tag);
  const install = async () => {
    setBusy("install");
    setError(undefined);
    try {
      const r = await call<{ engine: EngineEntry; verify: { ok: boolean; error: string | null } }>("github_install", { url, tag, asset, ...policyArgs });
      // a repository given by hand for an engine of the lists: remembered for the next time
      if (target && !target.repo && url.trim()) call("engine_link_set", { family: target.family, repo: url.trim() }).catch(() => {});
      toast[r.verify.ok ? "success" : "warning"](`${r.engine.display_name}: ${r.engine.verify_status}`);
      onDone(r.engine);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={queue ? `${tr("engines.gh.title")} · ${tr("engines.gh.queueOf", { n: queue.n, total: queue.total })}` : tr("engines.gh.title")}
      width={860}
      footer={
        <>
          <button className="btn" onClick={() => setOpen(false)} data-testid="github-cancel">
            {queue ? tr("engines.gh.queueStop") : tr("app.common.cancel")}
          </button>
          {queue && (
            <button className="btn" onClick={queue.onSkip} disabled={!!busy} data-testid="github-skip">
              {tr("engines.gh.queueSkip")}
            </button>
          )}
          <button className="btn btn-primary" disabled={!asset || !!busy} onClick={install}>
            {busy === "install" ? <Spinner /> : null} {tr("engines.gh.install")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {target && (
          <div className="text-[12.5px]" data-testid="github-target">
            {tr("engines.gh.fromList")}<b>{target.name}</b>
            {target.repo ? (
              <span className="muted">
                {tr("engines.gh.repository", { repo: target.repo.repo })}
                {target.version ? tr("engines.gh.version", { version: target.version }) : ""}
                {target.source && target.source !== "TorsGUI's list" ? ` · ${target.source}` : ""}
              </span>
            ) : target.homepage ? (
              <span>
                {tr("engines.gh.notGithub")}
                <a className="link" href={target.homepage} target="_blank" rel="noreferrer" data-testid="github-homepage">
                  {tr("engines.gh.itsSite")}
                </a>{" "}
                <span className="muted">({target.homepage})</span>{tr("engines.gh.thenLocal1")}<i>{tr("engines.gh.thenLocal2")}</i>.
              </span>
            ) : (
              <span style={{ color: "var(--warn)" }}>
                {tr("engines.gh.noRepo", { family: target.family, source: target.source ? ` (${target.source})` : "" })}
              </span>
            )}
            {versionNote && <div className="muted">{versionNote}</div>}
          </div>
        )}
        <div className="flex gap-2">
          <input className="input" placeholder={tr("engines.gh.urlPlaceholder")} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && list()} data-testid="github-url" />
          <button className="btn" onClick={() => list()} disabled={!url || !!busy}>
            {busy === "list" ? <Spinner /> : <PackagePlus size={14} />} {tr("engines.gh.list")}
          </button>
        </div>
        {known && known.length > 0 && (
          <details className="rounded-md" style={{ background: "var(--bg-2)" }} open={!data} data-testid="known-repos">
            <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-medium">
              {tr("engines.gh.known", { count: known.length })} <span className="muted font-normal">{tr("engines.gh.knownClick")}</span>
            </summary>
            <div className="px-3 pb-3 flex flex-col gap-2">
              <input className="input" placeholder={tr("engines.gh.filter")} value={kq} onChange={(e) => setKq(e.target.value)} data-testid="known-filter" />
              <div className="grid gap-1.5 overflow-auto max-h-[220px]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
                {known
                  .filter((k) => !kq || `${k.name} ${k.repo}`.toLowerCase().includes(kq.toLowerCase()))
                  .sort((a, b) => (b.blitz?.[1] ?? 0) - (a.blitz?.[1] ?? 0))
                  .map((k) => (
                    <button
                      key={k.repo}
                      className="text-left rounded px-2 py-1 border hover:bg-[var(--hover)]"
                      style={{ borderColor: url === k.repo ? "var(--accent)" : "var(--border)" }}
                      title={`${k.repo}${k.tested_tag ? ` · ${tr("engines.gh.tested", { tag: k.tested_tag, asset: k.tested_asset ?? "" })}` : ""}${k.notes ? `\n${k.notes}` : ""}`}
                      onClick={() => {
                        setUrl(k.repo);
                        list(k.repo);
                      }}
                      data-testid={`known-${k.name}`}
                    >
                      <div className="flex items-center justify-between gap-1 text-[12.5px]">
                        <span className="font-medium truncate">{k.name}</span>
                        <span className="flex gap-1 shrink-0">
                          {k.installed && <span className="chip chip-win">{tr("engines.gh.inLibrary")}</span>}
                          {k.tested_tag && <span className="chip">{tr("engines.gh.testedChip", { tag: k.tested_tag })}</span>}
                        </span>
                      </div>
                      <div className="muted text-[11px] truncate mono">{k.repo}</div>
                      {k.blitz && <div className="muted text-[11px] truncate">Blitz {k.blitz[1]} · {k.blitz[0]}</div>}
                    </button>
                  ))}
              </div>
            </div>
          </details>
        )}
        <p className="muted text-[12px]">
          {tr("engines.gh.policy1")}<b>{tr("engines.gh.policy2")}</b>{tr("engines.gh.policy3")}<b>{tr("engines.gh.policy4")}</b>{tr("engines.gh.policy5")}<span className="mono">releases/latest</span>{tr("engines.gh.policy6")}
        </p>
        <div className="flex items-center gap-4 text-[12.5px] rounded-md px-3 py-2" style={{ background: "var(--bg-2)" }}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={avx2Only ?? false} onChange={(e) => setAvx2Only(e.target.checked)} data-testid="gh-avx2-only" />
            {tr("engines.gh.avx2Only")}
          </label>
          <span className="muted">
            {avx2Only ? tr("engines.gh.avx2OnlyOn") : tr("engines.gh.avx2OnlyOff")}
            {data?.policy && tr("engines.gh.thisCpu", { avx512: tr(data.policy.cpu_avx512 ? "app.common.yes" : "app.common.no"), vnni: tr(data.policy.cpu_vnni ? "app.common.yes" : "app.common.no") })}
          </span>
        </div>
        <ErrorBox error={error} />
        {data && (
          <div className="grid gap-3" style={{ gridTemplateColumns: "220px 1fr" }}>
            <div className="panel overflow-auto max-h-[380px]">
              {data.releases.map((r) => (
                <button key={r.release.tag} className="w-full text-left px-2.5 py-1.5 flex justify-between items-center" style={{ background: r.release.tag === tag ? "var(--accent-bg)" : undefined, borderBottom: "1px solid var(--border)" }} onClick={() => { setTag(r.release.tag); setAsset(r.selection.chosen ?? undefined); }}>
                  <span className="mono">{r.release.tag}</span>
                  <span className="flex gap-1">
                    {r.release.tag === data.latest_stable && <span className="chip chip-win">{tr("engines.gh.latestStable")}</span>}
                    {r.release.prerelease && <span className="chip chip-warn">{tr("engines.gh.pre")}</span>}
                  </span>
                </button>
              ))}
            </div>
            {cur && (
              <div className="flex flex-col gap-2 min-w-0">
                <div className={`rounded-md px-3 py-2 text-[12.5px]`} style={{ background: cur.selection.flagged ? "var(--warn-bg)" : "var(--win-bg)", color: cur.selection.flagged ? "var(--warn)" : "var(--win)" }}>
                  <b>{tr("engines.gh.proposed")}</b> {cur.selection.reason}
                </div>
                {asset && asset !== cur.selection.chosen && <div className="text-[12px]" style={{ color: "var(--accent-2)" }}>{tr("engines.gh.youChose1")}<span className="mono">{asset}</span>{tr("engines.gh.youChose2")}</div>}
                <div className="panel overflow-auto max-h-[320px]">
                  <table className="tbl">
                    <tbody>
                      {cur.selection.verdicts.map((v) => (
                        <tr key={v.name} className={v.accepted ? "clickable" : ""} onClick={() => v.accepted && setAsset(v.name)}>
                          <td>{v.accepted ? <input type="radio" checked={asset === v.name} readOnly aria-label={v.name} /> : <XCircle size={14} className="l" />}</td>
                          <td className="mono">{v.name}</td>
                          <td className="mono muted">
                            {v.build}
                          </td>
                          <td className="text-[12px]" style={{ color: v.accepted ? (!v.ccrl_ok ? "#b48cff" : v.flagged ? "var(--warn)" : "var(--win)") : "var(--muted)" }}>
                            {v.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {cur.selection.extra.length > 0 && <div className="text-[12px] muted">{tr("engines.gh.networks", { list: cur.selection.extra.join(", ") })}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function EditDialog({ e, setE, onDone }: { e: EngineEntry | null; setE: (e: EngineEntry | null) => void; onDone: () => void }) {
  const [opts, setOpts] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<EngineEntry | null>(null);
  const tr = useT();
  if (e && (!draft || draft.id !== e.id)) {
    setDraft(e);
    setOpts({ ...e.default_options });
  }
  if (!e || !draft) return null;
  const save = async () => {
    try {
      await call("engine_save", { engine: { ...draft, default_options: opts } });
      toast.success(tr("engines.edit.saved"));
      onDone();
      setE(null);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const set = (k: keyof EngineEntry, v: unknown) => setDraft({ ...draft, [k]: v } as EngineEntry);
  return (
    <Modal open onOpenChange={(o) => !o && setE(null)} title={tr("engines.edit.title", { name: e.display_name })} width={900} footer={<button className="btn btn-primary" onClick={save}>{tr("app.common.save")}</button>}>
      <div className="grid grid-cols-3 gap-3">
        <Field label={tr("engines.edit.displayName")} hint="<Engine> <version>">
          <input className="input" value={draft.display_name} onChange={(x) => set("display_name", x.target.value)} />
        </Field>
        <Field label={tr("engines.page.engine")}>
          <input className="input" value={draft.engine} onChange={(x) => set("engine", x.target.value)} />
        </Field>
        <Field label={tr("engines.edit.version")}>
          <input className="input" value={draft.version} onChange={(x) => set("version", x.target.value)} />
        </Field>
        <Field label={tr("engines.edit.executable")} className="col-span-2">
          <input className="input mono" value={draft.path} onChange={(x) => set("path", x.target.value)} />
        </Field>
        <Field label={tr("engines.edit.dir")}>
          <input className="input mono" value={draft.dir} onChange={(x) => set("dir", x.target.value)} />
        </Field>
        <Field label={tr("engines.edit.args")} className="col-span-3" hint={tr("engines.edit.argsHint")}>
          <input className="input mono" value={draft.args} onChange={(x) => set("args", x.target.value)} placeholder="--weights=nets/my.pb.gz" />
        </Field>
        <Field label={tr("engines.edit.notes")} className="col-span-3">
          <textarea className="textarea" rows={2} value={draft.notes} onChange={(x) => set("notes", x.target.value)} />
        </Field>
        <div className="col-span-3 flex flex-col gap-1">
          <div className="kpi-label">{tr("engines.edit.options")}</div>
          <UciOptionsEditor key={draft.id ?? 0} options={draft.options} values={opts} onChange={setOpts} engineId={draft.id} dir={draft.dir} />
        </div>
        <div className="col-span-2 muted text-[12px]">
          {tr("engines.edit.exportName")}<span className="mono">{/\b64-bit$/i.test(draft.display_name.trim()) ? draft.display_name.trim() : `${draft.display_name.trim()} 64-bit`}</span> (+ <span className="mono">NCPU</span>{tr("engines.edit.exportCpu")}
        </div>
      </div>
    </Modal>
  );
}

type CuteRow = CuteEngine & { in_library: boolean };

/** Engines from Cute Chess: its engines.json, found automatically or given by path or pasted. */
function CuteChessDialog({ open, setOpen, onDone }: { open: boolean; setOpen: (o: boolean) => void; onDone: () => void }) {
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [paste, setPaste] = useState(false);
  const [rows, setRows] = useState<CuteRow[] | null>(null);
  const [source, setSource] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<"scan" | "import" | null>(null);
  const [error, setError] = useState<string>();
  const tr = useT();
  const req = () => (paste ? { text } : { path });
  const scan = async (auto = false) => {
    setBusy("scan");
    setError(undefined);
    try {
      const r = await call<{ source: string; engines: CuteRow[] }>("cutechess_scan", auto ? {} : req());
      setRows(r.engines);
      setSource(r.source);
      if (auto) setPath(r.source);
      setPicked(r.engines.filter((e) => e.protocol === "uci" && !e.in_library).map((e) => e.name));
    } catch (e) {
      setRows(null);
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const run = async () => {
    setBusy("import");
    try {
      const r = await call<{ added: { name: string; status: string }[]; skipped: string[] }>("cutechess_import", { ...(paste ? { text } : { path: source }), names: picked });
      toast.success(tr("engines.cute.imported", { count: r.added.length }) + (r.skipped.length ? tr("engines.cute.skipped", { count: r.skipped.length }) : ""));
      if (r.skipped.length) toast.message(r.skipped.join(" · "));
      onDone();
      setOpen(false);
      setRows(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={tr("engines.cute.title")}
      width={1000}
      footer={
        <button className="btn btn-primary" onClick={run} disabled={!rows || !picked.length || busy != null} data-testid="cute-import">
          {busy === "import" ? <Spinner size={12} /> : <PackagePlus size={14} />} {tr("engines.cute.import", { count: picked.length })}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="muted text-[12.5px]">
          {tr("engines.cute.about1")}<span className="mono">engines.json</span>{tr("engines.cute.about2")}
        </div>
        {!paste ? (
          <div className="flex gap-2 items-end">
            <Field label={tr("engines.cute.file")} className="flex-1">
              <PathInput kind="file" value={path} onChange={setPath} filters={[{ name: tr("engines.cute.filter"), extensions: ["json"] }]} placeholder="C:\Users\you\AppData\Local\cutechess\engines.json" testid="cute-path" />
            </Field>
            <button className="btn" onClick={() => scan(true)} disabled={busy != null} data-testid="cute-find">
              <Search size={13} /> {tr("engines.cute.find")}
            </button>
            <button className="btn btn-primary" onClick={() => scan()} disabled={!path || busy != null} data-testid="cute-read">
              {busy === "scan" ? <Spinner size={12} /> : <FileText size={13} />} {tr("engines.cute.read")}
            </button>
          </div>
        ) : (
          <div className="flex gap-2 items-end">
            <Field label={tr("engines.cute.content")} className="flex-1">
              <textarea className="textarea mono" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder='[{"name": "Stockfish 17", "command": "stockfish.exe", ...}]' />
            </Field>
            <button className="btn btn-primary" onClick={() => scan()} disabled={!text.trim() || busy != null}>
              {busy === "scan" ? <Spinner size={12} /> : <FileText size={13} />} {tr("engines.cute.read")}
            </button>
          </div>
        )}
        <button className="btn btn-ghost btn-sm self-start" onClick={() => setPaste(!paste)}>
          {paste ? tr("engines.cute.giveFile") : tr("engines.cute.paste")}
        </button>
        <ErrorBox error={error} />
        {rows && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="muted">
                {tr("engines.cute.found", { count: rows.length })}<span className="mono">{source}</span>
              </span>
              <button className="btn btn-sm ml-auto" onClick={() => setPicked(rows.filter((e) => e.protocol === "uci").map((e) => e.name))}>
                {tr("engines.cute.all")}
              </button>
              <button className="btn btn-sm" onClick={() => setPicked([])}>
                {tr("engines.cute.none")}
              </button>
            </div>
            <div className="overflow-auto" style={{ maxHeight: 380 }}>
              <table className="tbl" data-testid="cute-list">
                <thead>
                  <tr>
                    <th />
                    <th>{tr("engines.page.engine")}</th>
                    <th>{tr("engines.cute.exe")}</th>
                    <th>{tr("engines.cute.options")}</th>
                    <th>{tr("engines.cute.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.name}>
                      <td>
                        <input type="checkbox" disabled={e.protocol !== "uci"} checked={picked.includes(e.name)} onChange={() => setPicked(picked.includes(e.name) ? picked.filter((x) => x !== e.name) : [...picked, e.name])} aria-label={`import ${e.name}`} />
                      </td>
                      <td className="font-medium">{e.name}</td>
                      <td className="mono text-[11.5px] truncate max-w-[300px]" title={e.exe}>
                        {e.exe}
                        {e.args && <span className="muted"> {e.args}</span>}
                      </td>
                      <td className="mono text-[11.5px] truncate max-w-[220px]" title={Object.entries(e.options).map(([k, v]) => `${k}=${v}`).join("\n")}>
                        {Object.keys(e.options).length ? Object.entries(e.options).map(([k, v]) => `${k}=${v}`).join(", ") : <span className="muted">—</span>}
                      </td>
                      <td>
                        {e.in_library ? (
                          <span className="chip">{tr("engines.cute.inLibrary")}</span>
                        ) : e.protocol !== "uci" ? (
                          <span className="chip chip-loss" title={e.note}>{e.protocol}</span>
                        ) : e.exists ? (
                          <span className="chip chip-win">{tr("engines.cute.foundChip")}</span>
                        ) : (
                          <Tip content={tr("engines.cute.notFoundTip", { note: e.note })}>
                            <span className="chip chip-warn">{tr("engines.cute.notFound")}</span>
                          </Tip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function Engines() {
  const { data, error, refresh } = usePoll<EngineEntry[]>("engines_list", {}, 0);
  const [gh, setGh] = useState(false);
  const [ghTarget, setGhTarget] = useState<GithubTarget | null>(null);
  const [params, setParams] = useSearchParams();
  // from CCRL Lists: /engines?github=<name in the list>
  useEffect(() => {
    const name = params.get("github");
    if (!name) return;
    const id = toast.loading(t("engines.looking", { name }));
    call<GithubTarget>("ccrl_repo_for", { name, list: params.get("list") ?? "Blitz" })
      .then((t) => {
        toast.dismiss(id);
        setGhTarget(t);
        setGh(true);
      })
      .catch((e) => toast.error(e.message, { id }));
    const next = new URLSearchParams(params);
    next.delete("github");
    next.delete("list");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const [edit, setEdit] = useState<EngineEntry | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [local, setLocal] = useState(false);
  const [localPath, setLocalPath] = useState("");
  const [imp, setImp] = useState(false);
  const [cute, setCute] = useState(false);
  const [folder, setFolder] = useState(false);
  const [impPath, setImpPath] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const engines = data ?? [];
  const { ratings, fetchedAt, refresh: refreshRatings } = useEngineRatings();
  const t = useT();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<["name" | RatingList, SortDir]>(["name", "asc"]);
  // active engines first: the ones being tested; inactive ones stay in the library
  const [group, setGroup] = useTabParam(["active", "inactive", "gpu", "all"] as const, "active");
  const activeN = engines.filter((e) => !e.inactive).length;
  const gpuN = engines.filter((e) => e.gpu).length;
  const inGroup = (e: EngineEntry) => group === "all" || (group === "gpu" ? e.gpu : (group === "active") === !e.inactive);
  // folders: made in the All tab; another tab shows a folder holding at least two of its engines
  const [efolder, setEfolder] = useState<string>(() => {
    try {
      return localStorage.getItem("torsgui-engine-folder") ?? ALL_FOLDERS;
    } catch {
      return ALL_FOLDERS;
    }
  });
  const [picked, setPicked] = useState<number[]>([]);
  const [naming, setNaming] = useState<null | { mode: "new" | "rename"; initial: string }>(null);
  const { colorOf, nameOf, setColor } = useFolderColors();
  const allFolders = Array.from(new Set(engines.map((e) => e.folder).filter((f): f is string => !!f))).sort((a, b) => a.localeCompare(b));
  const folderCount = (f: string) => engines.filter((e) => inGroup(e) && (f === ALL_FOLDERS || (f === NO_FOLDER ? !e.folder : e.folder === f))).length;
  const folders = group === "all" ? allFolders : allFolders.filter((f) => folderCount(f) >= 2);
  const shownFolder = efolder === ALL_FOLDERS || (efolder === NO_FOLDER && folders.length > 0) || folders.includes(efolder) ? efolder : ALL_FOLDERS;
  useEffect(() => {
    try {
      localStorage.setItem("torsgui-engine-folder", shownFolder);
    } catch {
      /* private mode */
    }
  }, [shownFolder]);
  const inFolder = (e: EngineEntry) => shownFolder === ALL_FOLDERS || (shownFolder === NO_FOLDER ? !e.folder : e.folder === shownFolder);
  const moveTo = async (target: string | null) => {
    try {
      await call("engines_set_folder", { ids: picked, folder: target });
      toast.success(target ? t("engines.folders.moved", { count: picked.length, folder: target }) : t("engines.folders.movedOut", { count: picked.length }));
      setPicked([]);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const named = async (name: string) => {
    const n = naming;
    setNaming(null);
    if (!n) return;
    if (n.mode === "new") {
      if (picked.length) await moveTo(name);
      setEfolder(name);
    } else {
      try {
        await call("engine_folder_rename", { from: n.initial, to: name });
        setEfolder(name);
        refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    }
  };
  const removeFolder = async (f: string) => {
    if (!confirm(t("engines.folders.confirmDelete", { folder: f }))) return;
    await call("engine_folder_rename", { from: f, to: "" });
    setEfolder(ALL_FOLDERS);
    refresh();
  };
  const [cards, setCards] = useState<Gpu[]>();
  useEffect(() => {
    if (group === "gpu" && !cards) call<Gpu[]>("gpus").then(setCards).catch(() => setCards([]));
  }, [group, cards]);
  const setGpu = async (e: EngineEntry, gpu: boolean) => {
    try {
      await call<number>("engines_set_gpu", { ids: [e.id!], gpu });
      refresh();
      toast.success(t(gpu ? "engines.gpu.set" : "engines.gpu.unset", { name: e.display_name }), { action: { label: t("engines.undo"), onClick: () => call("engines_set_gpu", { ids: [e.id!], gpu: !gpu }).then(() => refresh()) } });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const setActive = async (ids: number[], active: boolean, name?: string) => {
    try {
      const n = await call<number>("engines_set_active", { ids, active });
      refresh();
      const msg = name ? t(active ? "engines.setActive" : "engines.setInactive", { name }) : t("engines.changed", { count: n });
      toast.success(msg, { action: { label: t("engines.undo"), onClick: () => call("engines_set_active", { ids, active: !active }).then(() => refresh()) } });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    refreshRatings();
  }, [data, refreshRatings]);
  const shown = engines
    .filter((e) => inGroup(e) && inFolder(e) && matchesEngine(e, q))
    .sort((a, b) =>
      sort[0] === "name"
        ? (sort[1] === "asc" ? 1 : -1) * a.display_name.localeCompare(b.display_name, undefined, { numeric: true, sensitivity: "base" })
        : cmpNum(ratings.get(a.id!)?.[sort[0]]?.rating, ratings.get(b.id!)?.[sort[0]]?.rating, sort[1]),
    );
  // engines in bands of 100 Elo of a CCRL list (the one sorted by, else Blitz), folded at first
  const [byElo, setByElo] = useState(() => {
    try {
      return localStorage.getItem("torsgui-engines-by-elo") === "1";
    } catch {
      return false;
    }
  });
  const [openBands, setOpenBands] = useState<string[]>([]);
  const bandList: RatingList = sort[0] === "name" ? "Blitz" : sort[0];
  const bands = (() => {
    const m = new Map<string, { key: string; label: string; top: number; engines: EngineEntry[] }>();
    for (const e of shown) {
      const r = ratings.get(e.id!)?.[bandList]?.rating;
      const top = r == null ? -1 : Math.floor(r / 100) * 100;
      const key = r == null ? "none" : String(top);
      const label = r == null ? t("engines.bands.none", { list: bandList }) : t("engines.bands.band", { list: bandList, from: top, to: top + 99 });
      if (!m.has(key)) m.set(key, { key, label, top, engines: [] });
      m.get(key)!.engines.push(e);
    }
    return [...m.values()].sort((a, b) => b.top - a.top);
  })();
  const toggleByElo = (on: boolean) => {
    setByElo(on);
    try {
      localStorage.setItem("torsgui-engines-by-elo", on ? "1" : "0");
    } catch {
      /* private mode */
    }
  };
  const syncCcrl = async () => {
    setSyncing(true);
    try {
      const r = await call<{ done: unknown[]; failed: unknown[] }>("ccrl_fetch_all");
      if (r.done.length) toast.success(t("engines.page.listsUpdated", { count: r.done.length }) + (r.failed.length ? t("engines.page.notReachable", { count: r.failed.length }) : ""));
      else toast.error(t("engines.page.offline"));
      refreshRatings();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };
  const { data: bl } = usePoll<{ engines: BundledEngine[] }>("bundled_list", {}, 0);
  const bundled = (bl?.engines ?? []).filter((b) => b.present && b.role !== "bench");
  const verify = async (e: EngineEntry) => {
    setBusy(e.id);
    try {
      const r = await call<{ engine: EngineEntry }>("engine_verify", { id: e.id });
      toast[r.engine.verify_status === "ok" ? "success" : "error"](`${e.display_name}: ${r.engine.verify_detail}`);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const del = async (e: EngineEntry) => {
    if (!confirm(t("engines.page.confirmRemove", { name: e.display_name }))) return;
    await call("engine_delete", { id: e.id });
    refresh();
  };
  const addLocal = async () => {
    try {
      const e = await call<EngineEntry>("engine_add_local", { path: localPath });
      toast.success(`${e.display_name}: ${e.verify_status}`);
      setLocal(false);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const importReport = async () => {
    try {
      const base = impPath.replace(/[\\/]REPORT\.md$/i, "");
      const r = await call<{ added: number }>("engines_import_report", { report: `${base}/REPORT.md`, uci_dir: `${base}/uci_options` });
      toast.success(t("engines.page.reportAdded", { count: r.added }));
      setImp(false);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const row = (e: EngineEntry) => (
    <tr key={e.id} style={e.inactive ? { opacity: 0.6 } : undefined}>
      <td className="text-center">
        <input
          type="checkbox"
          checked={picked.includes(e.id!)}
          onChange={(ev) => setPicked(ev.target.checked ? [...picked, e.id!] : picked.filter((x) => x !== e.id))}
          aria-label={`${t("engines.folders.pickCol")}: ${e.display_name}`}
          data-testid={`engine-pick-${e.id}`}
        />
      </td>
      <td className="text-center">
        <input type="checkbox" checked={!e.inactive} onChange={() => setActive([e.id!], !!e.inactive, e.display_name)} aria-label={`${t("engines.activeCol")}: ${e.display_name}`} data-testid={`engine-active-${e.id}`} />
      </td>
      <td className="text-center">
        <input type="checkbox" checked={!!e.gpu} onChange={() => setGpu(e, !e.gpu)} aria-label={`GPU: ${e.display_name}`} data-testid={`engine-gpu-${e.id}`} />
      </td>
      <td className="font-medium">
        {e.release_url ? (
          <a href={e.release_url} target="_blank" rel="noreferrer" className="hover:underline">
            {e.display_name}
          </a>
        ) : (
          e.display_name
        )}
        {e.chess960 && (
          <span className="chip chip-accent ml-1.5" title={t("engines.page.chess960Tip")}>
            960
          </span>
        )}
        {e.gpu && (
          <span className="chip chip-warn ml-1.5" title={t("engines.gpu.chipTip")}>
            GPU
          </span>
        )}
        {shownFolder === ALL_FOLDERS && e.folder && (
          <span className="chip ml-1.5 inline-flex items-center gap-1" data-testid="engine-folder-chip">
            <FolderIcon size={10} color={colorOf("engines", e.folder)} /> {e.folder}
          </span>
        )}
        <div className="mono muted text-[11px] truncate max-w-[260px]" title={e.asset}>
          {e.asset}
        </div>
      </td>
      {RATING_LISTS.map((l) => (
        <td key={l} className="r" data-testid={`elo-${l}-${e.id}`}>
          <EloCell r={ratings.get(e.id!)?.[l]} />
        </td>
      ))}
      <td className="mono truncate max-w-[180px]" title={e.build}>{e.build || "—"}</td>
      <td className="mono muted">{e.uci_id || "—"}</td>
      <td className="r tnum">{e.threads_max ?? "—"}</td>
      <td>{e.has_syzygy ? t("app.common.yes") : <span className="muted">{t("app.common.no")}</span>}</td>
      <td>
        <Tip content={e.verify_detail || t("engines.page.notVerified")}>
          <span className={`chip ${e.verify_status === "ok" ? "chip-win" : e.verify_status === "failed" ? "chip-loss" : ""}`}>
            {e.verify_status === "ok" ? <CheckCircle2 size={11} /> : null}
            {e.verify_status || t("engines.page.unverified")}
          </span>
        </Tip>
      </td>
      <td className="max-w-[260px]">
        <div className="flex flex-wrap gap-1">
          {e.flags.map((f) => (
            <span key={f} className="chip chip-warn" title={f}>
              {f.length > 34 ? f.slice(0, 32) + "…" : f}
            </span>
          ))}
        </div>
      </td>
      <td className="mono muted" title={e.sha256}>
        {e.sha256 ? e.sha256.slice(0, 12) + "…" : "—"}
      </td>
      <td className="r">
        <div className="flex justify-end gap-1">
          <button className="btn btn-sm" onClick={() => verify(e)} disabled={!e.path || busy === e.id} title={t("engines.page.verifyTip")}>
            {busy === e.id ? <Spinner size={12} /> : <RefreshCw size={12} />} {t("engines.page.verify")}
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" aria-label={t("engines.page.edit")} onClick={() => setEdit(e)}>
            <Pencil size={13} />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" aria-label={t("engines.page.remove")} onClick={() => del(e)}>
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
  const verified = engines.filter((e) => e.verify_status === "ok").length;
  const flagged = engines.filter((e) => e.flags.length).length;
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader help="engines"
        title={t("engines.page.title")}
        sub={t("engines.page.sub", { count: engines.length, verified, flagged })}
        actions={
          <>
            <RefreshFoldersButton onDone={refresh} />
            <button className="btn" onClick={() => call<string>("engines_report").then(setReport)}>
              <FileText size={14} /> {t("engines.page.report")}
            </button>
            <MenuButton
              primary
              testid="engines-add"
              label={
                <>
                  <PackagePlus size={14} /> {t("engines.page.add")}
                </>
              }
              items={[
                { icon: <PackagePlus size={14} />, label: t("engines.page.fromGithub"), hint: t("engines.page.fromGithubHint"), onSelect: () => setGh(true), testid: "engines-github" },
                { icon: <FolderOpen size={14} />, label: t("engines.page.folder"), hint: t("engines.page.folderHint"), onSelect: () => setFolder(true), testid: "engines-folder" },
                { icon: <FolderOpen size={14} />, label: t("engines.page.local"), hint: t("engines.page.localHint"), onSelect: () => setLocal(true), testid: "engines-local" },
                { icon: <FolderOpen size={14} />, label: t("engines.page.cute"), hint: t("engines.page.cuteHint"), onSelect: () => setCute(true), testid: "engines-cutechess" },
                {
                  icon: <PackagePlus size={14} />,
                  label: t("engines.page.bundled"),
                  hint: bundled.map((b) => `${b.engine} ${b.version}`).join(", "),
                  hidden: bundled.length === 0,
                  testid: "engines-bundled",
                  onSelect: () =>
                    call<{ added: string[] }>("bundled_install")
                      .then((r) => {
                        toast.success(r.added.length ? t("engines.page.added", { names: r.added.join(", ") }) : t("engines.page.already"));
                        refresh();
                      })
                      .catch((e) => toast.error(e.message)),
                },
                { icon: <FileText size={14} />, label: t("engines.page.rebuild"), hint: t("engines.page.rebuildHint"), onSelect: () => setImp(true), testid: "engines-report-import" },
              ]}
            />
          </>
        }
      />
      <ErrorBox error={error} />
      <PageTabs
        tabs={[
          { id: "active", label: t("engines.tabs.active"), badge: activeN },
          { id: "inactive", label: t("engines.tabs.inactive"), badge: engines.length - activeN },
          { id: "gpu", label: t("engines.tabs.gpu"), badge: gpuN },
          { id: "all", label: t("engines.tabs.all"), badge: engines.length },
        ]}
        value={group}
        onChange={setGroup}
        testid="engines-group"
      />
      {group === "gpu" && (
        <Panel title={t("engines.gpu.cards")}>
          <div className="flex flex-col gap-1.5 text-[12.5px]" data-testid="gpu-cards">
            {!cards ? (
              <Spinner size={12} />
            ) : cards.length === 0 ? (
              <span className="muted">{t("engines.gpu.noCards")}</span>
            ) : (
              cards.map((c) => (
                <div key={c.index} className="flex items-center gap-2">
                  <span className="chip">{t("engines.gpu.card", { n: c.index })}</span>
                  <span className="font-medium">{c.name}</span>
                  {c.memory_mb > 0 && <span className="muted tnum">{(c.memory_mb / 1024).toFixed(c.memory_mb >= 10240 ? 0 : 1)} GB</span>}
                </div>
              ))
            )}
            <div className="muted text-[12px]">{t("engines.gpu.about")}</div>
          </div>
        </Panel>
      )}
      {(folders.length > 0 || group === "all") && (
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <PageTabs
              tabs={[
                { id: ALL_FOLDERS, label: t("engines.folders.all"), badge: folderCount(ALL_FOLDERS) },
                ...folders.map((f) => ({ id: f, label: <span className="inline-flex items-center gap-1"><FolderIcon color={colorOf("engines", f)} /> {f}</span>, badge: folderCount(f) })),
                { id: NO_FOLDER, label: t("engines.folders.none"), badge: folderCount(NO_FOLDER), hidden: folders.length === 0 },
              ]}
              value={shownFolder}
              onChange={setEfolder}
              testid="efolder"
            />
          </div>
          {group === "all" && (
            <div className="flex gap-1.5 items-center">
              {shownFolder !== ALL_FOLDERS && shownFolder !== NO_FOLDER && (
                <>
                  <FolderColorMenu value={nameOf("engines", shownFolder)} onChange={(c) => setColor("engines", shownFolder, c)} />
                  <button className="btn btn-sm btn-ghost" onClick={() => setNaming({ mode: "rename", initial: shownFolder })} data-testid="efolder-rename">
                    <Pencil size={12} /> {t("engines.folders.rename")}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => removeFolder(shownFolder)} title={t("engines.folders.deleteTip")} data-testid="efolder-delete">
                    <Trash2 size={12} /> {t("engines.folders.delete")}
                  </button>
                </>
              )}
              <button className="btn btn-sm" onClick={() => setNaming({ mode: "new", initial: "" })} title={t("engines.folders.newTip")} data-testid="efolder-new">
                <FolderPlus size={13} /> {t("engines.folders.new")}
              </button>
            </div>
          )}
        </div>
      )}
      {group === "active" && allFolders.length > folders.length && (
        <div className="muted text-[12px] -mt-1.5" data-testid="efolder-active-about">
          {t("engines.folders.activeAbout")}
        </div>
      )}
      {picked.length > 0 && (
        <div className="flex items-center gap-2 text-[12.5px] px-3 py-2 rounded-md" style={{ background: "var(--accent-bg)" }} data-testid="engines-selection">
          <span className="font-medium">{t("engines.folders.selected", { count: picked.length })}</span>
          <MenuButton
            testid="efolder-move"
            label={
              <>
                <FolderIcon size={13} /> {t("engines.folders.moveTo")}
              </>
            }
            items={[
              ...allFolders.map((f) => ({ icon: <FolderIcon size={13} color={colorOf("engines", f)} />, label: f, onSelect: () => moveTo(f), testid: `emove-to-${f}` })),
              { icon: <FolderPlus size={13} />, label: t("engines.folders.new") + "…", onSelect: () => setNaming({ mode: "new", initial: "" }), testid: "emove-to-new" },
              { icon: <FolderInput size={13} />, label: t("engines.folders.out"), onSelect: () => moveTo(null), hidden: !picked.some((id) => engines.find((e) => e.id === id)?.folder), testid: "emove-out" },
            ]}
          />
          <button className="btn btn-sm btn-ghost ml-auto" onClick={() => setPicked([])}>
            {t("engines.folders.clear")}
          </button>
        </div>
      )}
      <Panel
        noPad
        title={q ? t("engines.page.shownOf", { shown: shown.length, total: engines.length }) : t("engines.page.library")}
        actions={
          <>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 muted" />
              <input className="input" style={{ width: 240, paddingLeft: 26 }} placeholder={t("engines.page.search")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="engines-search" />
            </div>
            {(group === "active" || group === "inactive") && shown.length > 0 && (
              <button className="btn btn-sm" onClick={() => setActive(shown.map((e) => e.id!), group === "inactive")} data-testid="engines-move-shown">
                {t(group === "inactive" ? "engines.allActiveShown" : "engines.allInactiveShown")}
              </button>
            )}
            <label className="flex items-center gap-1.5 text-[12.5px] whitespace-nowrap" title={t("engines.bands.tip")}>
              <input type="checkbox" checked={byElo} onChange={(e) => toggleByElo(e.target.checked)} data-testid="engines-by-elo" /> {t("engines.bands.toggle")}
            </label>
            <Tip content={t("engines.page.ratingsTip", { latest: fetchedAt ? t("engines.page.latest", { date: fetchedAt.slice(0, 10) }) : "" })}>
              <button className="btn btn-sm" onClick={syncCcrl} disabled={syncing} data-testid="engines-ccrl-sync">
                {syncing ? <Spinner size={12} /> : <RefreshCw size={12} />} {t("engines.page.updateRatings")}
              </button>
            </Tip>
          </>
        }
      >
        {engines.length === 0 ? (
          <Empty>{t("engines.page.empty")}</Empty>
        ) : (
          // the list scrolls inside the window, so its horizontal scrollbar is always on screen
          <div className="overflow-auto" style={{ maxHeight: `calc(100vh - ${folders.length > 0 || group === "all" ? 335 : 285}px)`, minHeight: 240 }}>
            <table className="tbl" data-testid="engines-table">
              <thead>
                <tr>
                  <th style={{ width: 1 }}>
                    <input
                      type="checkbox"
                      aria-label={t("engines.folders.selectAll")}
                      title={t("engines.folders.pickTip")}
                      checked={shown.length > 0 && shown.every((e) => picked.includes(e.id!))}
                      onChange={(ev) => setPicked(ev.target.checked ? shown.map((e) => e.id!) : [])}
                      data-testid="engines-pick-all"
                    />
                  </th>
                  <th style={{ width: 1 }}>
                    <Tip content={t("engines.activeTip")}>
                      <span>{t("engines.activeCol")}</span>
                    </Tip>
                  </th>
                  <th style={{ width: 1 }}>
                    <Tip content={t("engines.gpu.colTip")}>
                      <span>GPU</span>
                    </Tip>
                  </th>
                  <SortTh k="name" sort={sort} setSort={setSort} first="asc">
                    {t("engines.page.engine")}
                  </SortTh>
                  {RATING_LISTS.map((l) => (
                    <SortTh key={l} k={l} sort={sort} setSort={setSort} right>
                      CCRL {l}
                    </SortTh>
                  ))}
                  <th>{t("engines.page.build")}</th>
                  <th>{t("engines.page.idName")}</th>
                  <th className="r">{t("engines.page.threadsMax")}</th>
                  <th>{t("engines.page.syzygy")}</th>
                  <th>{t("engines.page.verified")}</th>
                  <th>{t("engines.page.flags")}</th>
                  <th>SHA256</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={16} className="muted" data-testid="engines-empty-group">
                      {q ? t("engines.page.noMatch", { q }) : group === "active" ? t("engines.noneActive") : group === "gpu" ? t("engines.gpu.none") : t("engines.noneInactive")}
                    </td>
                  </tr>
                )}
                {byElo
                  ? bands.map((b) => {
                      const open = openBands.includes(b.key);
                      return (
                        <Fragment key={b.key}>
                          <tr className="clickable" onClick={() => setOpenBands(open ? openBands.filter((x) => x !== b.key) : [...openBands, b.key])} data-testid="elo-band">
                            <td colSpan={16} className="font-medium" style={{ background: "var(--bg-2)" }}>
                              <span className="inline-flex items-center gap-1.5">
                                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                {b.label} <span className="chip">{b.engines.length}</span>
                              </span>
                            </td>
                          </tr>
                          {open && b.engines.map(row)}
                        </Fragment>
                      );
                    })
                  : shown.map(row)}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <GithubDialog
        open={gh}
        setOpen={(o) => {
          setGh(o);
          if (!o) setGhTarget(null);
        }}
        onDone={refresh}
        target={ghTarget}
      />
      <EditDialog e={edit} setE={setEdit} onDone={refresh} />
      <FolderNameDialog
        open={!!naming}
        title={naming?.mode === "rename" ? t("engines.folders.renameTitle") : t("engines.folders.newTitle")}
        initial={naming?.initial ?? ""}
        placeholder={t("engines.folders.placeholder")}
        okLabel={t("engines.folders.ok")}
        onOk={named}
        onClose={() => setNaming(null)}
      />
      <CuteChessDialog open={cute} setOpen={setCute} onDone={refresh} />
      <FolderImportDialog open={folder} setOpen={setFolder} onDone={refresh} />
      <Modal open={local} onOpenChange={setLocal} title={t("engines.local.title")} footer={<button className="btn btn-primary" onClick={addLocal} disabled={!localPath}>{t("engines.local.add")}</button>}>
        <Field label={t("engines.local.path")} hint={t("engines.local.pathHint")}>
          <PathInput kind="file" value={localPath} onChange={setLocalPath} filters={ENGINE_FILTERS} placeholder="C:\CCRL\engines\Engine_1.0\engine-avx2.exe" testid="local-path" />
        </Field>
      </Modal>
      <Modal open={imp} onOpenChange={setImp} title={t("engines.rebuild.title")} footer={<button className="btn btn-primary" onClick={importReport} disabled={!impPath}>{t("engines.rebuild.import")}</button>}>
        <Field label={t("engines.rebuild.folder")} hint={t("engines.rebuild.folderHint")}>
          <PathInput kind="folder" value={impPath} onChange={setImpPath} placeholder="…/CCRL_ScirptsTests/engines" />
        </Field>
      </Modal>
      <Modal
        open={report != null}
        onOpenChange={(o) => !o && setReport(null)}
        title={t("engines.rebuild.reportTitle")}
        width={1000}
        footer={
          <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(report ?? "").then(() => toast.success(t("engines.rebuild.copied")))}>
            <Copy size={13} /> {t("engines.rebuild.copy")}
          </button>
        }
      >
        <pre className="mono text-[11px] whitespace-pre-wrap max-h-[65vh] overflow-auto">{report}</pre>
      </Modal>
    </div>
  );
}
