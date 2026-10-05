import { CheckCircle2, Copy, FileText, FolderOpen, Pencil, PackagePlus, RefreshCw, Search, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { AssetPolicy } from "../bindings/AssetPolicy";
import type { BundledEngine } from "../bindings/BundledEngine";
import type { CuteEngine } from "../bindings/CuteEngine";
import type { EngineEntry } from "../bindings/EngineEntry";
import type { KnownRepo } from "../bindings/KnownRepo";
import type { Settings } from "../bindings/Settings";
import type { Release } from "../bindings/Release";
import type { RepoRef } from "../bindings/RepoRef";
import type { Selection } from "../bindings/Selection";
import { UciOptionsEditor } from "../components/UciOptions";
import { cmpNum, EloCell, matchesEngine, RATING_LISTS, SortTh, useEngineRatings, type RatingList, type SortDir } from "../components/EngineRatings";
import { ENGINE_FILTERS, PathInput } from "../components/PathInput";
import { Empty, ErrorBox, Field, Modal, PageHeader, Panel, Spinner, Tip, MenuButton } from "../components/ui";
import { call, usePoll } from "../lib/api";

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

function GithubDialog({ open, setOpen, onDone, target }: { open: boolean; setOpen: (o: boolean) => void; onDone: () => void; target?: GithubTarget | null }) {
  const [url, setUrl] = useState("");
  const [versionNote, setVersionNote] = useState<string>();
  const [data, setData] = useState<ReleasesResp>();
  const [tag, setTag] = useState<string>();
  const [asset, setAsset] = useState<string>();
  const [busy, setBusy] = useState<"list" | "install" | null>(null);
  const [error, setError] = useState<string>();
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
      if (version && !wanted) setVersionNote(`No release tagged ${version} found: the latest is proposed.`);
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
      onDone();
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
      title="Add engine from GitHub"
      width={860}
      footer={
        <>
          <button className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!asset || !!busy} onClick={install}>
            {busy === "install" ? <Spinner /> : null} Download, extract &amp; verify
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {target && (
          <div className="text-[12.5px]" data-testid="github-target">
            From the CCRL list: <b>{target.name}</b>
            {target.repo ? (
              <span className="muted">
                {" "}
                · repository {target.repo.repo}
                {target.version ? ` · version ${target.version}` : ""}
                {target.source && target.source !== "TorsGUI's list" ? ` · ${target.source}` : ""}
              </span>
            ) : target.homepage ? (
              <span>
                {" "}
                · not on GitHub: get it from{" "}
                <a className="link" href={target.homepage} target="_blank" rel="noreferrer" data-testid="github-homepage">
                  its site
                </a>{" "}
                <span className="muted">({target.homepage})</span>, then <i>Add engine → Local file</i>.
              </span>
            ) : (
              <span style={{ color: "var(--warn)" }}>
                {" "}
                · no repository known for {target.family} yet{target.source ? ` (${target.source})` : ""}: paste its GitHub address (owner/repo) below; TorsGUI remembers it.
              </span>
            )}
            {versionNote && <div className="muted">{versionNote}</div>}
          </div>
        )}
        <div className="flex gap-2">
          <input className="input" placeholder="https://github.com/owner/repo  or  owner/repo  or a release URL" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && list()} data-testid="github-url" />
          <button className="btn" onClick={() => list()} disabled={!url || !!busy}>
            {busy === "list" ? <Spinner /> : <PackagePlus size={14} />} List releases
          </button>
        </div>
        {known && known.length > 0 && (
          <details className="rounded-md" style={{ background: "var(--bg-2)" }} open={!data} data-testid="known-repos">
            <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-medium">
              Known engines ({known.length} public repositories) <span className="muted font-normal">· click one to list its releases</span>
            </summary>
            <div className="px-3 pb-3 flex flex-col gap-2">
              <input className="input" placeholder="Filter engines" value={kq} onChange={(e) => setKq(e.target.value)} data-testid="known-filter" />
              <div className="grid gap-1.5 overflow-auto max-h-[220px]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
                {known
                  .filter((k) => !kq || `${k.name} ${k.repo}`.toLowerCase().includes(kq.toLowerCase()))
                  .sort((a, b) => (b.blitz?.[1] ?? 0) - (a.blitz?.[1] ?? 0))
                  .map((k) => (
                    <button
                      key={k.repo}
                      className="text-left rounded px-2 py-1 border hover:bg-[var(--hover)]"
                      style={{ borderColor: url === k.repo ? "var(--accent)" : "var(--border)" }}
                      title={`${k.repo}${k.tested_tag ? ` · tested: ${k.tested_tag} ${k.tested_asset ?? ""}` : ""}${k.notes ? `\n${k.notes}` : ""}`}
                      onClick={() => {
                        setUrl(k.repo);
                        list(k.repo);
                      }}
                      data-testid={`known-${k.name}`}
                    >
                      <div className="flex items-center justify-between gap-1 text-[12.5px]">
                        <span className="font-medium truncate">{k.name}</span>
                        <span className="flex gap-1 shrink-0">
                          {k.installed && <span className="chip chip-win">in library</span>}
                          {k.tested_tag && <span className="chip">tested {k.tested_tag}</span>}
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
          Official releases only. TorsGUI proposes a build and explains why; <b>click another row to choose it yourself</b>. CCRL tests <b>AVX2 or AVX-512</b> builds: TorsGUI takes the AVX-512 (VNNI first) build when this CPU runs it, else the AVX2 one (x86-64-v3 counts as AVX2, x86-64-v4 as AVX-512); bmi2 or generic builds are taken but flagged; never 32-bit; nothing is compiled. When the API is rate-limited TorsGUI falls back to the <span className="mono">releases/latest</span> redirect and the HTML asset listing.
        </p>
        <div className="flex items-center gap-4 text-[12.5px] rounded-md px-3 py-2" style={{ background: "var(--bg-2)" }}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={avx2Only ?? false} onChange={(e) => setAvx2Only(e.target.checked)} data-testid="gh-avx2-only" />
            AVX2 only
          </label>
          <span className="muted">
            {avx2Only ? "the AVX2 build, even on an AVX-512 CPU" : "the AVX-512 build when this CPU runs it, else AVX2 — CCRL accepts both"}
            {data?.policy && <> · this CPU: AVX-512 {data.policy.cpu_avx512 ? "yes" : "no"}, VNNI {data.policy.cpu_vnni ? "yes" : "no"}</>}
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
                    {r.release.tag === data.latest_stable && <span className="chip chip-win">latest stable</span>}
                    {r.release.prerelease && <span className="chip chip-warn">pre</span>}
                  </span>
                </button>
              ))}
            </div>
            {cur && (
              <div className="flex flex-col gap-2 min-w-0">
                <div className={`rounded-md px-3 py-2 text-[12.5px]`} style={{ background: cur.selection.flagged ? "var(--warn-bg)" : "var(--win-bg)", color: cur.selection.flagged ? "var(--warn)" : "var(--win)" }}>
                  <b>Proposed:</b> {cur.selection.reason}
                </div>
                {asset && asset !== cur.selection.chosen && <div className="text-[12px]" style={{ color: "var(--accent-2)" }}>You chose <span className="mono">{asset}</span> instead of the proposed build.</div>}
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
                {cur.selection.extra.length > 0 && <div className="text-[12px] muted">Networks shipped separately (downloaded too): {cur.selection.extra.join(", ")}</div>}
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
  if (e && (!draft || draft.id !== e.id)) {
    setDraft(e);
    setOpts({ ...e.default_options });
  }
  if (!e || !draft) return null;
  const save = async () => {
    try {
      await call("engine_save", { engine: { ...draft, default_options: opts } });
      toast.success("Saved: new tournaments use these options (a tournament already created keeps its own: change them in its Configuration tab)");
      onDone();
      setE(null);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const set = (k: keyof EngineEntry, v: unknown) => setDraft({ ...draft, [k]: v } as EngineEntry);
  return (
    <Modal open onOpenChange={(o) => !o && setE(null)} title={`Edit ${e.display_name}`} width={900} footer={<button className="btn btn-primary" onClick={save}>Save</button>}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Display name (CCRL style)" hint="<Engine> <version>">
          <input className="input" value={draft.display_name} onChange={(x) => set("display_name", x.target.value)} />
        </Field>
        <Field label="Engine">
          <input className="input" value={draft.engine} onChange={(x) => set("engine", x.target.value)} />
        </Field>
        <Field label="Version">
          <input className="input" value={draft.version} onChange={(x) => set("version", x.target.value)} />
        </Field>
        <Field label="Executable" className="col-span-2">
          <input className="input mono" value={draft.path} onChange={(x) => set("path", x.target.value)} />
        </Field>
        <Field label="Working dir">
          <input className="input mono" value={draft.dir} onChange={(x) => set("dir", x.target.value)} />
        </Field>
        <Field label="Arguments" className="col-span-3" hint="command-line arguments of the engine (most engines need none)">
          <input className="input mono" value={draft.args} onChange={(x) => set("args", x.target.value)} placeholder="--weights=nets/my.pb.gz" />
        </Field>
        <Field label="Notes" className="col-span-3">
          <textarea className="textarea" rows={2} value={draft.notes} onChange={(x) => set("notes", x.target.value)} />
        </Field>
        <div className="col-span-3 flex flex-col gap-1">
          <div className="kpi-label">UCI options sent in new tournaments (network file, contempt, …)</div>
          <UciOptionsEditor key={draft.id ?? 0} options={draft.options} values={opts} onChange={setOpts} engineId={draft.id} dir={draft.dir} />
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.used} onChange={(x) => set("used", x.target.checked)} /> Used in tournaments
        </label>
        <div className="col-span-2 muted text-[12px]">
          Export name: <span className="mono">{draft.display_name} 64-bit</span> (+ <span className="mono">NCPU</span> when threads &gt; 1)
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
      toast.success(`${r.added.length} engines imported from Cute Chess${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}`);
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
      title="Import engines from Cute Chess"
      width={1000}
      footer={
        <button className="btn btn-primary" onClick={run} disabled={!rows || !picked.length || busy != null} data-testid="cute-import">
          {busy === "import" ? <Spinner size={12} /> : <PackagePlus size={14} />} Import {picked.length} engine{picked.length === 1 ? "" : "s"}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="muted text-[12.5px]">
          Cute Chess keeps its engines in <span className="mono">engines.json</span>. Each engine is imported with its folder, arguments and the UCI options changed in Cute
          Chess, then verified (uci → isready → go). Threads and Hash come from the tournament.
        </div>
        {!paste ? (
          <div className="flex gap-2 items-end">
            <Field label="engines.json (file or folder)" className="flex-1">
              <PathInput kind="file" value={path} onChange={setPath} filters={[{ name: "Cute Chess engines", extensions: ["json"] }]} placeholder="C:\Users\you\AppData\Local\cutechess\engines.json" testid="cute-path" />
            </Field>
            <button className="btn" onClick={() => scan(true)} disabled={busy != null} data-testid="cute-find">
              <Search size={13} /> Find it
            </button>
            <button className="btn btn-primary" onClick={() => scan()} disabled={!path || busy != null} data-testid="cute-read">
              {busy === "scan" ? <Spinner size={12} /> : <FileText size={13} />} Read
            </button>
          </div>
        ) : (
          <div className="flex gap-2 items-end">
            <Field label="Content of engines.json" className="flex-1">
              <textarea className="textarea mono" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder='[{"name": "Stockfish 17", "command": "stockfish.exe", ...}]' />
            </Field>
            <button className="btn btn-primary" onClick={() => scan()} disabled={!text.trim() || busy != null}>
              {busy === "scan" ? <Spinner size={12} /> : <FileText size={13} />} Read
            </button>
          </div>
        )}
        <button className="btn btn-ghost btn-sm self-start" onClick={() => setPaste(!paste)}>
          {paste ? "Give the file instead" : "Or paste the content of the file"}
        </button>
        <ErrorBox error={error} />
        {rows && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="muted">
                {rows.length} engines in <span className="mono">{source}</span>
              </span>
              <button className="btn btn-sm ml-auto" onClick={() => setPicked(rows.filter((e) => e.protocol === "uci").map((e) => e.name))}>
                All
              </button>
              <button className="btn btn-sm" onClick={() => setPicked([])}>
                None
              </button>
            </div>
            <div className="overflow-auto" style={{ maxHeight: 380 }}>
              <table className="tbl" data-testid="cute-list">
                <thead>
                  <tr>
                    <th />
                    <th>Engine</th>
                    <th>Executable</th>
                    <th>Options from Cute Chess</th>
                    <th>Status</th>
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
                          <span className="chip">in the library</span>
                        ) : e.protocol !== "uci" ? (
                          <span className="chip chip-loss" title={e.note}>{e.protocol}</span>
                        ) : e.exists ? (
                          <span className="chip chip-win">found</span>
                        ) : (
                          <Tip content={`${e.note}. It is added without verification: set the executable in Edit.`}>
                            <span className="chip chip-warn">not found</span>
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
    const id = toast.loading(`Looking for ${name}…`);
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
  const [impPath, setImpPath] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const engines = data ?? [];
  const { ratings, fetchedAt, refresh: refreshRatings } = useEngineRatings();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<["name" | RatingList, SortDir]>(["name", "asc"]);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    refreshRatings();
  }, [data, refreshRatings]);
  const shown = engines
    .filter((e) => matchesEngine(e, q))
    .sort((a, b) =>
      sort[0] === "name"
        ? (sort[1] === "asc" ? 1 : -1) * a.display_name.localeCompare(b.display_name, undefined, { numeric: true, sensitivity: "base" })
        : cmpNum(ratings.get(a.id!)?.[sort[0]]?.rating, ratings.get(b.id!)?.[sort[0]]?.rating, sort[1]),
    );
  const syncCcrl = async () => {
    setSyncing(true);
    try {
      const r = await call<{ done: unknown[]; failed: unknown[] }>("ccrl_fetch_all");
      if (r.done.length) toast.success(`CCRL lists updated (${r.done.length})${r.failed.length ? `, ${r.failed.length} not reachable` : ""}`);
      else toast.error("computerchess.org.uk is not reachable: the lists in CCRL lists stay in use (bundled or imported)");
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
    if (!confirm(`Remove ${e.display_name} from the library? Files are not deleted.`)) return;
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
      toast.success(`${r.added} engines added from REPORT.md (metadata only)`);
      setImp(false);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const verified = engines.filter((e) => e.verify_status === "ok").length;
  const flagged = engines.filter((e) => e.flags.length).length;
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader help="engines"
        title="Engines"
        sub={`${engines.length} engines · ${verified} verified · ${flagged} flagged`}
        actions={
          <>
            <button className="btn" onClick={() => call<string>("engines_report").then(setReport)}>
              <FileText size={14} /> Report
            </button>
            <MenuButton
              primary
              testid="engines-add"
              label={
                <>
                  <PackagePlus size={14} /> Add engine
                </>
              }
              items={[
                { icon: <PackagePlus size={14} />, label: "From GitHub", hint: "official releases, CCRL build rules", onSelect: () => setGh(true), testid: "engines-github" },
                { icon: <FolderOpen size={14} />, label: "Local file", hint: "an executable on this computer", onSelect: () => setLocal(true), testid: "engines-local" },
                { icon: <FolderOpen size={14} />, label: "Import from Cute Chess", hint: "engines.json: folders, arguments, options", onSelect: () => setCute(true), testid: "engines-cutechess" },
                {
                  icon: <PackagePlus size={14} />,
                  label: "Bundled engines",
                  hint: bundled.map((b) => `${b.engine} ${b.version}`).join(", "),
                  hidden: bundled.length === 0,
                  testid: "engines-bundled",
                  onSelect: () =>
                    call<{ added: string[] }>("bundled_install")
                      .then((r) => {
                        toast.success(r.added.length ? `Added: ${r.added.join(", ")}` : "Already in the library");
                        refresh();
                      })
                      .catch((e) => toast.error(e.message)),
                },
                { icon: <FileText size={14} />, label: "Rebuild from REPORT.md", hint: "the engines report of the old scripts", onSelect: () => setImp(true), testid: "engines-report-import" },
              ]}
            />
          </>
        }
      />
      <ErrorBox error={error} />
      <Panel
        noPad
        title={q ? `${shown.length} of ${engines.length} engines` : "Library"}
        actions={
          <>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 muted" />
              <input className="input" style={{ width: 240, paddingLeft: 26 }} placeholder="Search engines, authors, builds" value={q} onChange={(e) => setQ(e.target.value)} data-testid="engines-search" />
            </div>
            <Tip content={`CCRL ratings come from the lists in CCRL lists${fetchedAt ? ` (latest: ${fetchedAt.slice(0, 10)})` : ""}. Update downloads them again; ≈ means this version is not in the list yet and the latest listed version is shown.`}>
              <button className="btn btn-sm" onClick={syncCcrl} disabled={syncing} data-testid="engines-ccrl-sync">
                {syncing ? <Spinner size={12} /> : <RefreshCw size={12} />} Update CCRL ratings
              </button>
            </Tip>
          </>
        }
      >
        {engines.length === 0 ? (
          <Empty>The library is empty. Add engines from their official GitHub releases, from a local file, or rebuild the library from an existing REPORT.md.</Empty>
        ) : (
          <div className="overflow-auto">
            <table className="tbl" data-testid="engines-table">
              <thead>
                <tr>
                  <SortTh k="name" sort={sort} setSort={setSort} first="asc">
                    Engine
                  </SortTh>
                  {RATING_LISTS.map((l) => (
                    <SortTh key={l} k={l} sort={sort} setSort={setSort} right>
                      CCRL {l}
                    </SortTh>
                  ))}
                  <th>Build</th>
                  <th>id name</th>
                  <th className="r">Threads max</th>
                  <th>Syzygy</th>
                  <th>Verified</th>
                  <th>Flags</th>
                  <th>SHA256</th>
                  <th>Used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={13} className="muted">
                      No engine matches “{q}”.
                    </td>
                  </tr>
                )}
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium">
                      {e.release_url ? (
                        <a href={e.release_url} target="_blank" rel="noreferrer" className="hover:underline">
                          {e.display_name}
                        </a>
                      ) : (
                        e.display_name
                      )}
                      {e.chess960 && (
                        <span className="chip chip-accent ml-1.5" title="declares UCI_Chess960: can play Fischer Random">
                          960
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
                    <td>{e.has_syzygy ? "yes" : <span className="muted">no</span>}</td>
                    <td>
                      <Tip content={e.verify_detail || "not verified yet"}>
                        <span className={`chip ${e.verify_status === "ok" ? "chip-win" : e.verify_status === "failed" ? "chip-loss" : ""}`}>
                          {e.verify_status === "ok" ? <CheckCircle2 size={11} /> : null}
                          {e.verify_status || "unverified"}
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
                    <td>{e.used ? "yes" : <span className="muted">no</span>}</td>
                    <td className="r">
                      <div className="flex justify-end gap-1">
                        <button className="btn btn-sm" onClick={() => verify(e)} disabled={!e.path || busy === e.id} title="uci → isready → go depth 12">
                          {busy === e.id ? <Spinner size={12} /> : <RefreshCw size={12} />} Verify
                        </button>
                        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Edit" onClick={() => setEdit(e)}>
                          <Pencil size={13} />
                        </button>
                        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove" onClick={() => del(e)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
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
      <CuteChessDialog open={cute} setOpen={setCute} onDone={refresh} />
      <Modal open={local} onOpenChange={setLocal} title="Add a local engine" footer={<button className="btn btn-primary" onClick={addLocal} disabled={!localPath}>Add &amp; verify</button>}>
        <Field label="Executable path" hint="The engine is verified (uci → isready → go depth 12) and its options are recorded.">
          <PathInput kind="file" value={localPath} onChange={setLocalPath} filters={ENGINE_FILTERS} placeholder="C:\CCRL\engines\Engine_1.0\engine-avx2.exe" testid="local-path" />
        </Field>
      </Modal>
      <Modal open={imp} onOpenChange={setImp} title="Rebuild the library from REPORT.md" footer={<button className="btn btn-primary" onClick={importReport} disabled={!impPath}>Import</button>}>
        <Field label="engines folder containing REPORT.md and uci_options/" hint="Metadata only (release, asset, build, sha256, id name, UCI options, used or not): point each entry to its binary afterwards, or reinstall it from GitHub.">
          <PathInput kind="folder" value={impPath} onChange={setImpPath} placeholder="…/CCRL_ScirptsTests/engines" />
        </Field>
      </Modal>
      <Modal
        open={report != null}
        onOpenChange={(o) => !o && setReport(null)}
        title="Engine report (REPORT.md)"
        width={1000}
        footer={
          <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(report ?? "").then(() => toast.success("Copied"))}>
            <Copy size={13} /> Copy markdown
          </button>
        }
      >
        <pre className="mono text-[11px] whitespace-pre-wrap max-h-[65vh] overflow-auto">{report}</pre>
      </Modal>
    </div>
  );
}
