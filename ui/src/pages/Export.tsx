import { AlertTriangle, CheckCircle2, Copy, FileArchive, FolderOpen, Info, RotateCcw, Save, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { Checklist } from "../bindings/Checklist";
import type { ExportOptions } from "../bindings/ExportOptions";
import type { ExportResult } from "../bindings/ExportResult";
import type { PostKind } from "../bindings/PostKind";
import type { Settings } from "../bindings/Settings";
import type { TournamentSummary } from "../bindings/TournamentSummary";
import { ErrorBox, Field, PageHeader, Panel, Seg, Spinner } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { HelpLink } from "../components/HelpLink";

const CHECK_ICON = {
  ok: <CheckCircle2 size={14} style={{ color: "var(--win)" }} />,
  info: <Info size={14} style={{ color: "var(--muted)" }} />,
  warn: <AlertTriangle size={14} style={{ color: "var(--warn)" }} />,
  fail: <XCircle size={14} style={{ color: "var(--loss)" }} />,
};

/** The checks a tester makes before sending results to CCRL, computed from the tournament. */
function CcrlChecklist({ id, stamp }: { id: string; stamp: number }) {
  const [c, setC] = useState<Checklist>();
  const [err, setErr] = useState<string>();
  useEffect(() => {
    setC(undefined);
    if (id) call<Checklist>("export_checklist", { id }).then(setC).catch((e) => setErr((e as Error).message));
  }, [id, stamp]);
  const fails = c?.items.filter((i) => i.status === "fail").length ?? 0;
  const warns = c?.items.filter((i) => i.status === "warn").length ?? 0;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          CCRL checklist
          {c && (
            <span className={`chip ${fails ? "chip-loss" : warns ? "chip-warn" : "chip-win"}`} data-testid="checklist-status">
              {fails ? `${fails} to fix` : warns ? `ready · ${warns} to check` : "ready to submit"}
            </span>
          )}
        </span>
      }
      actions={<HelpLink section="ccrl-submission-checklist" label="What each check means" />}
    >
      <ErrorBox error={err} />
      {!c ? (
        <Spinner />
      ) : (
        <div className="grid gap-x-6 gap-y-1.5 text-[12.5px]" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }} data-testid="checklist">
          {c.items.map((i) => (
            <div key={i.id} className="flex gap-2 items-start min-w-0" data-status={i.status}>
              <span className="mt-0.5 shrink-0">{CHECK_ICON[i.status]}</span>
              <span className="min-w-0">
                <span className="font-medium">{i.label}</span> <span className="muted">— {i.detail}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

const zipName = (base: string) => base.replace(/[\s[\]()]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") + ".zip";

export function ExportPage() {
  const [sp, setSp] = useSearchParams();
  const { data: ts } = usePoll<TournamentSummary[]>("tournaments_list", {}, 0);
  const { data: settings, refresh: refreshSettings } = usePoll<Settings>("settings_get", {}, 0);
  const id = sp.get("id") ?? "";
  const [opts, setOpts] = useState<ExportOptions>();
  const [res, setRes] = useState<ExportResult>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [copyOut, setCopyOut] = useState(true);
  const [kind, setKind] = useState<PostKind>(sp.get("post") ? "finished" : "finished");
  const [tpl, setTpl] = useState("");
  const [post, setPost] = useState("");
  const [stamp, setStamp] = useState(0);

  useEffect(() => {
    if (!id && ts?.length) setSp({ id: ts.find((t) => t.record.state === "completed")?.record.id ?? ts[0].record.id });
  }, [id, ts, setSp]);
  useEffect(() => {
    setRes(undefined);
    if (id) call<ExportOptions>("export_defaults", { id }).then(setOpts).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(() => {
    if (!settings) return;
    setTpl(kind === "finished" ? settings.post_template_finished : kind === "announcement" ? settings.post_template_announcement : settings.post_template_progress);
  }, [kind, settings]);
  useEffect(() => {
    if (!id || !tpl) return;
    const t = setTimeout(() => {
      call<{ text: string }>("forum_post", { id, kind, template: tpl, options: opts })
        .then((r) => setPost(r.text))
        .catch((e) => setPost(`(${e.message})`));
    }, 200);
    return () => clearTimeout(t);
    // the post follows the export form on the left
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind, tpl, JSON.stringify(opts)]);

  const run = async () => {
    if (!opts) return;
    setBusy(true);
    setErr(undefined);
    try {
      const r = await call<ExportResult>("export_run", { id, options: opts, copy_to_output: copyOut });
      setRes(r);
      toast.success(`${r.games} games exported`);
      setStamp((x) => x + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveTpl = async () => {
    if (!settings) return;
    const key = kind === "finished" ? "post_template_finished" : kind === "announcement" ? "post_template_announcement" : "post_template_progress";
    await call("settings_save", { settings: { ...settings, [key]: tpl } });
    toast.success("Template saved");
    refreshSettings();
  };
  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => opts && setOpts({ ...opts, [k]: v });
  // as names::ccrl_name, from the CCRL spelling when there is one
  const exportName = (n: string) => {
    const b = (opts?.ccrl_names[n]?.trim() || n).replace(/\s+\d+CPU$/, "");
    return `${b}${/64-bit$/.test(b) ? "" : " 64-bit"}${opts && opts.threads > 1 ? ` ${opts.threads}CPU` : ""}`;
  };
  const eventPreview = opts ? `${exportName(opts.seed)} - <Mon D>` : "";
  const base = opts ? `[${opts.tester} ${opts.date}] ${res?.event ?? eventPreview} (hash ${opts.hash_mb}MB) (book ${opts.book}) (egtb ${opts.egtb}-man)` : "";
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader help="export-and-post"
        title="Export & forum post"
        sub="CCRL submission (Gabor Szots' convention) and a short BBCode post"
        actions={
          <select className="select" style={{ width: 360 }} value={id} onChange={(e) => setSp({ id: e.target.value })} aria-label="Tournament">
            {(ts ?? []).map((t) => (
              <option key={t.record.id} value={t.record.id}>
                {t.record.name} ({t.record.state}, {t.record.done_games} games)
              </option>
            ))}
          </select>
        }
      />
      {id && <CcrlChecklist id={id} stamp={stamp} />}
      <div className="grid grid-cols-2 gap-3">
        <Panel title="CCRL export">
          {!opts ? (
            <Spinner />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Tester name">
                  <input className="input" value={opts.tester} onChange={(e) => set("tester", e.target.value)} placeholder="Francesco Torsello" />
                </Field>
                <Field label="Site (your location)">
                  <input className="input" value={opts.site} onChange={(e) => set("site", e.target.value)} placeholder="Milan" />
                </Field>
                <Field label="Submission date">
                  <input className="input mono" value={opts.date} onChange={(e) => set("date", e.target.value)} />
                </Field>
                <Field label="Seed (as in the PGN)">
                  <input className="input" value={opts.seed} onChange={(e) => set("seed", e.target.value)} />
                </Field>
                <Field label="Threads (NCPU suffix)">
                  <input className="input tnum" type="number" value={opts.threads} onChange={(e) => set("threads", +e.target.value)} />
                </Field>
                <Field label="Hash (MB)">
                  <input className="input tnum" type="number" value={opts.hash_mb} onChange={(e) => set("hash_mb", +e.target.value)} />
                </Field>
                <Field label="Book name">
                  <input className="input" value={opts.book} onChange={(e) => set("book", e.target.value)} />
                </Field>
                <Field label="EGTB pieces">
                  <input className="input tnum" type="number" value={opts.egtb} onChange={(e) => set("egtb", +e.target.value)} />
                </Field>
                <div className="flex flex-col justify-end gap-1 text-[12px]">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={opts.make_zip} onChange={(e) => set("make_zip", e.target.checked)} /> zip
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={copyOut} onChange={(e) => setCopyOut(e.target.checked)} /> copy to the output folder
                  </label>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="kpi-label">Names in the PGN (as CCRL writes them in its list)</div>
                <table className="tbl" data-testid="export-names">
                  <thead>
                    <tr>
                      <th>Played as</th>
                      <th>CCRL name</th>
                      <th>In the export</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opts.players.map((p) => {
                      const changed = (opts.ccrl_names[p]?.trim() || p) !== p;
                      return (
                        <tr key={p}>
                          <td className="muted">{p}</td>
                          <td>
                            <input
                              className="input"
                              style={{ minWidth: 180 }}
                              value={opts.ccrl_names[p] ?? p}
                              onChange={(e) => set("ccrl_names", { ...opts.ccrl_names, [p]: e.target.value })}
                              aria-label={`CCRL name of ${p}`}
                            />
                            <div className="muted text-[11px]">{opts.name_sources[p] ?? ""}</div>
                          </td>
                          <td className="mono text-[12px]">
                            {exportName(p)}
                            {changed && <span className="chip chip-accent ml-1.5">renamed</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="panel p-2.5 flex flex-col gap-1 text-[12px]" style={{ background: "var(--bg-2)" }}>
                <div>
                  <span className="kpi-label mr-2">File</span>
                  <span className="mono break-all">{base}.pgn</span>
                </div>
                {opts.make_zip && (
                  <div>
                    <span className="kpi-label mr-2">Zip</span>
                    <span className="mono break-all">{zipName(base)}</span>
                  </div>
                )}
                <div className="muted">
                  Every finished game once (duplicates dropped, first by GameEndTime), sorted by end time; only Event, Site, player names and Round change. TimeControl and all other tags stay as played.
                </div>
              </div>
              <ErrorBox error={err} />
              <div className="flex justify-end">
                <button className="btn btn-primary" onClick={run} disabled={busy || !opts.tester} data-testid="export-run">
                  {busy ? <Spinner /> : <FileArchive size={14} />} Build export
                </button>
              </div>
              {res && (
                <div className="flex flex-col gap-1 text-[12.5px]" data-testid="export-result">
                  <div>
                    <b>{res.games}</b> games · {res.duplicates_dropped} duplicates dropped · Event <span className="mono">{res.event}</span>
                  </div>
                  <div className="mono text-[11.5px] break-all">{res.pgn_path}</div>
                  {res.zip_path && <div className="mono text-[11.5px] break-all">{res.zip_path}</div>}
                  <div className="muted">Players: {res.players.join(", ")}</div>
                  <div>
                    <button className="btn btn-sm" data-testid="export-open-folder" onClick={() => call("open_folder", { path: res.zip_path ?? res.pgn_path }).catch((e) => toast.error((e as Error).message))}>
                      <FolderOpen size={13} /> Open folder
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>
        <Panel
          title="Forum post (BBCode)"
          actions={
            <Seg
              value={kind}
              onChange={setKind}
              options={[
                { value: "finished", label: "Finished" },
                { value: "announcement", label: "Announcement" },
                { value: "progress", label: "Progress" },
              ]}
            />
          }
        >
          <div className="flex flex-col gap-2">
            <Field label="Template" hint="{seed} {kind} {conditions} {result} {table} {closing} {games} {done} {opponents} {per_opp} {threads} {hash} {tc} {list} {book} {egtb} {engines} {eta} {openings}">
              <textarea className="textarea" rows={6} value={tpl} onChange={(e) => setTpl(e.target.value)} />
            </Field>
            <div className="flex gap-2 justify-end">
              <button
                className="btn btn-sm"
                onClick={() =>
                  call<{ template: string }>("forum_post", { id, kind })
                    .then(() => setTpl(""))
                    .then(() => refreshSettings())
                }
                title="Reload the saved template"
              >
                <RotateCcw size={12} /> Reload
              </button>
              <button className="btn btn-sm" onClick={saveTpl}>
                <Save size={12} /> Save as default
              </button>
            </div>
            <pre className="panel p-3 mono text-[12px] whitespace-pre-wrap min-h-[260px]" style={{ background: "var(--bg-2)" }} data-testid="forum-post">
              {post}
            </pre>
            <div className="flex justify-end">
              <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(post).then(() => toast.success("Post copied"))}>
                <Copy size={13} /> Copy
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
