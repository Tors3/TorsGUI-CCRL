import { CheckCircle2, Copy, FileText, FolderOpen, Pencil, PackagePlus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { AssetPolicy } from "../bindings/AssetPolicy";
import type { EngineEntry } from "../bindings/EngineEntry";
import type { Settings } from "../bindings/Settings";
import type { Release } from "../bindings/Release";
import type { RepoRef } from "../bindings/RepoRef";
import type { Selection } from "../bindings/Selection";
import { Empty, ErrorBox, Field, Modal, PageHeader, Panel, Spinner, Tip } from "../components/ui";
import { call, usePoll } from "../lib/api";

type ReleasesResp = { repo: RepoRef; latest_stable: string | null; releases: { release: Release; selection: Selection }[]; policy: AssetPolicy };

function GithubDialog({ open, setOpen, onDone }: { open: boolean; setOpen: (o: boolean) => void; onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [data, setData] = useState<ReleasesResp>();
  const [tag, setTag] = useState<string>();
  const [asset, setAsset] = useState<string>();
  const [busy, setBusy] = useState<"list" | "install" | null>(null);
  const [error, setError] = useState<string>();
  const [personal, setPersonal] = useState<{ allow: boolean; prefer: boolean } | null>(null);
  useEffect(() => {
    if (open && !personal) call<Settings>("settings_get").then((s) => setPersonal({ allow: s.allow_avx512, prefer: s.prefer_avx512 })).catch(() => setPersonal({ allow: false, prefer: false }));
  }, [open, personal]);
  const policyArgs = { allow_avx512: personal?.allow ?? false, prefer_avx512: personal?.prefer ?? false };
  useEffect(() => {
    if (data) list();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal?.allow, personal?.prefer]);
  const list = async () => {
    setBusy("list");
    setError(undefined);
    try {
      const d = await call<ReleasesResp>("github_releases", { url, ...policyArgs });
      setData(d);
      const t = d.repo.tag ?? d.latest_stable ?? d.releases[0]?.release.tag;
      setTag(t ?? undefined);
      setAsset(d.releases.find((r) => r.release.tag === t)?.selection.chosen ?? undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const cur = data?.releases.find((r) => r.release.tag === tag);
  const install = async () => {
    setBusy("install");
    setError(undefined);
    try {
      const r = await call<{ engine: EngineEntry; verify: { ok: boolean; error: string | null } }>("github_install", { url, tag, asset, ...policyArgs });
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
        <div className="flex gap-2">
          <input className="input" placeholder="https://github.com/owner/repo  or  owner/repo  or a release URL" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && list()} data-testid="github-url" />
          <button className="btn" onClick={list} disabled={!url || !!busy}>
            {busy === "list" ? <Spinner /> : <PackagePlus size={14} />} List releases
          </button>
        </div>
        <p className="muted text-[12px]">
          Official releases only. TorsGUI proposes a build and explains why; <b>click another row to choose it yourself</b>. CCRL rule: the Windows <b>AVX2</b> build (x86-64-v3 counts as AVX2); never AVX-512, VNNI or x86-64-v4; bmi2 or generic builds are taken but flagged; never 32-bit; nothing is compiled. When the API is rate-limited TorsGUI falls back to the <span className="mono">releases/latest</span> redirect and the HTML asset listing.
        </p>
        <div className="flex items-center gap-4 text-[12.5px] rounded-md px-3 py-2" style={{ background: "var(--bg-2)" }}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={personal?.allow ?? false} onChange={(e) => setPersonal({ allow: e.target.checked, prefer: e.target.checked && (personal?.prefer ?? false) })} data-testid="gh-allow-avx512" />
            Allow AVX-512 builds <span className="chip chip-personal">personal, not CCRL</span>
          </label>
          <label className="flex items-center gap-2" style={{ opacity: personal?.allow ? 1 : 0.5 }}>
            <input type="checkbox" disabled={!personal?.allow} checked={personal?.prefer ?? false} onChange={(e) => setPersonal({ allow: true, prefer: e.target.checked })} /> Prefer them
            {data?.policy && personal?.allow && <span className="muted">(this CPU: AVX-512 {data.policy.cpu_avx512 ? "yes" : "no"}, VNNI {data.policy.cpu_vnni ? "yes" : "no"})</span>}
          </label>
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
                            {v.build} {v.accepted && !v.ccrl_ok && <span className="chip chip-personal">not CCRL</span>}
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
  const [opts, setOpts] = useState("");
  const [draft, setDraft] = useState<EngineEntry | null>(null);
  if (e && (!draft || draft.id !== e.id)) {
    setDraft(e);
    setOpts(Object.entries(e.default_options).map(([k, v]) => `${k}=${v}`).join("\n"));
  }
  if (!e || !draft) return null;
  const save = async () => {
    const default_options = Object.fromEntries(opts.split("\n").map((l) => l.split("=")).filter((p) => p.length >= 2 && p[0].trim()).map(([k, ...v]) => [k.trim(), v.join("=").trim()]));
    try {
      await call("engine_save", { engine: { ...draft, default_options } });
      toast.success("Saved");
      onDone();
      setE(null);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const set = (k: keyof EngineEntry, v: unknown) => setDraft({ ...draft, [k]: v } as EngineEntry);
  return (
    <Modal open onOpenChange={(o) => !o && setE(null)} title={`Edit ${e.display_name}`} width={720} footer={<button className="btn btn-primary" onClick={save}>Save</button>}>
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
        <Field label="Options sent in tournaments (key=value per line)" className="col-span-2" hint="Threads and Hash are set from the tournament. Ponder=false and OwnBook=false are added automatically when the engine exposes them.">
          <textarea className="textarea" rows={4} value={opts} onChange={(x) => setOpts(x.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="textarea" rows={4} value={draft.notes} onChange={(x) => set("notes", x.target.value)} />
        </Field>
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

export function Engines() {
  const { data, error, refresh } = usePoll<EngineEntry[]>("engines_list", {}, 0);
  const [gh, setGh] = useState(false);
  const [edit, setEdit] = useState<EngineEntry | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [local, setLocal] = useState(false);
  const [localPath, setLocalPath] = useState("");
  const [imp, setImp] = useState(false);
  const [impPath, setImpPath] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const engines = data ?? [];
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
            <button className="btn" onClick={() => setImp(true)}>
              Import REPORT.md
            </button>
            <button className="btn" onClick={() => setLocal(true)}>
              <FolderOpen size={14} /> Add local file
            </button>
            <button className="btn btn-primary" onClick={() => setGh(true)}>
              <PackagePlus size={14} /> Add from GitHub
            </button>
          </>
        }
      />
      <ErrorBox error={error} />
      <Panel noPad>
        {engines.length === 0 ? (
          <Empty>The library is empty. Add engines from their official GitHub releases, from a local file, or rebuild the library from an existing REPORT.md.</Empty>
        ) : (
          <div className="overflow-auto">
            <table className="tbl" data-testid="engines-table">
              <thead>
                <tr>
                  <th>Engine</th>
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
                {engines.map((e) => (
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
                    <td className="mono">{e.build || "—"}</td>
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
                          <span key={f} className={`chip ${f.startsWith("AVX-512 build: personal") ? "chip-personal" : "chip-warn"}`} title={f}>
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
      <GithubDialog open={gh} setOpen={setGh} onDone={refresh} />
      <EditDialog e={edit} setE={setEdit} onDone={refresh} />
      <Modal open={local} onOpenChange={setLocal} title="Add a local engine" footer={<button className="btn btn-primary" onClick={addLocal} disabled={!localPath}>Add &amp; verify</button>}>
        <Field label="Executable path" hint="The engine is verified (uci → isready → go depth 12) and its options are recorded.">
          <input className="input mono" value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="C:\CCRL\engines\Engine_1.0\engine-avx2.exe" />
        </Field>
      </Modal>
      <Modal open={imp} onOpenChange={setImp} title="Rebuild the library from REPORT.md" footer={<button className="btn btn-primary" onClick={importReport} disabled={!impPath}>Import</button>}>
        <Field label="engines folder containing REPORT.md and uci_options/" hint="Metadata only (release, asset, build, sha256, id name, UCI options, used or not): point each entry to its binary afterwards, or reinstall it from GitHub.">
          <input className="input mono" value={impPath} onChange={(e) => setImpPath(e.target.value)} placeholder="…/CCRL_ScirptsTests/engines" />
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
