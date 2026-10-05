import { Copy, FileCode2, Inbox, ListPlus, Play, Save } from "lucide-react";
import { PathInput } from "./PathInput";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { FileImport } from "../bindings/FileImport";
import type { TournamentRecord } from "../bindings/TournamentRecord";
import type { WizardPreview } from "../bindings/WizardPreview";
import { call } from "../lib/api";
import { duration } from "../lib/format";
import { ErrorBox, Modal, Spinner, Warn } from "./ui";

type Parsed = { import: FileImport; preview: WizardPreview };
type InboxFile = { name: string; path: string; modified: string; text: string };

const HOW_TONE: Record<string, string> = { exact: "chip-win", "latest version": "chip-warn", approximate: "chip-warn", "not found": "chip-loss" };

/**
 * Import a tournament file (TOML/JSON written by hand or by an assistant): TorsGUI shows
 * what it understood, then saves it as a draft, queues it or starts it.
 */
export function TournamentFileDialog({ open, setOpen, onDone }: { open: boolean; setOpen: (o: boolean) => void; onDone?: () => void }) {
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Parsed>();
  const [error, setError] = useState<string>();
  const [inbox, setInbox] = useState<{ dir: string; files: InboxFile[] }>();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  useEffect(() => {
    if (open) call<{ dir: string; files: InboxFile[] }>("tfile_inbox").then(setInbox).catch(() => {});
  }, [open]);
  useEffect(() => {
    if (!text.trim()) {
      setParsed(undefined);
      setError(undefined);
      return;
    }
    const t = setTimeout(() => {
      call<Parsed>("tfile_parse", { text })
        .then((p) => {
          setParsed(p);
          setError(undefined);
        })
        .catch((e) => {
          setParsed(undefined);
          setError((e as Error).message);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [text]);
  const load = async () => {
    try {
      setText(await call<string>("tfile_read", { path }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const run = async (action: "draft" | "queue" | "start") => {
    setBusy(action);
    try {
      const r = await call<TournamentRecord>("tfile_import", { text, action });
      toast.success(`${r.name}: ${action === "draft" ? "saved as draft" : action === "queue" ? "added to the queue" : "started"} (${r.expected_games} games)`);
      setOpen(false);
      setText("");
      onDone?.();
      nav(`/tournaments/${encodeURIComponent(r.id)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const showTemplate = async () => setTemplate(await call<string>("tfile_template"));
  const imp = parsed?.import;
  const pv = parsed?.preview;
  const c = imp?.config;
  const errors = [...(imp?.errors ?? []), ...(pv?.errors ?? [])];
  const warnings = [...(imp?.warnings ?? []), ...(pv?.warnings ?? [])];
  const ok = !!c && errors.length === 0;
  const primary = imp?.after_import ?? "queue";
  return (
    <>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Import a tournament file"
        width={1180}
        footer={
          <>
            <button className="btn mr-auto" onClick={showTemplate} data-testid="tfile-template">
              <FileCode2 size={14} /> Template for Claude
            </button>
            <button className={`btn ${primary === "draft" ? "btn-primary" : ""}`} disabled={!ok || !!busy} onClick={() => run("draft")}>
              {busy === "draft" ? <Spinner /> : <Save size={14} />} Save as draft
            </button>
            <button className={`btn ${primary === "queue" ? "btn-primary" : ""}`} disabled={!ok || !!busy} onClick={() => run("queue")} data-testid="tfile-queue">
              {busy === "queue" ? <Spinner /> : <ListPlus size={14} />} Add to queue
            </button>
            <button className={`btn ${primary === "start" ? "btn-primary" : ""}`} disabled={!ok || !!busy} onClick={() => run("start")}>
              {busy === "start" ? <Spinner /> : <Play size={14} />} Start now
            </button>
          </>
        }
      >
        <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
          <div className="flex flex-col gap-2 min-w-0">
            {inbox && inbox.files.length > 0 && (
              <div className="panel p-2">
                <div className="kpi-label mb-1 flex items-center gap-1">
                  <Inbox size={11} /> Inbox <span className="mono normal-case tracking-normal">{inbox.dir}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {inbox.files.map((f) => (
                    <button key={f.path} className="btn btn-sm" onClick={() => setText(f.text)} title={`${f.path} · ${f.modified}`}>
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <PathInput kind="file" className="flex-1" placeholder="Path of a .toml file (or paste it below)" value={path} onChange={setPath} onEnter={load} filters={[{ name: "Tournament files", extensions: ["toml"] }]} testid="tfile-path" />
              <button className="btn" onClick={load} disabled={!path}>
                Load
              </button>
            </div>
            <textarea
              className="textarea mono text-[12px]"
              style={{ minHeight: 420 }}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'seed = "Triumviratus 7.0"\nopponents = ["Stockfish 19", "Obsidian 16.0"]\nthreads = 8\ngames_per_opponent = 30'}
              spellCheck={false}
              data-testid="tfile-text"
            />
            <div className="muted text-[11.5px]">
              Ask Claude for a tournament (&quot;a Blitz gauntlet of Triumviratus 7.0 8CPU against 15 engines of its level&quot;) and give it the <b>template</b>: it lists the rules and the engines of your library. Paste the answer here, or save it as a .toml file in the inbox folder.
            </div>
          </div>
          <div className="flex flex-col gap-2 min-w-0" data-testid="tfile-result">
            <ErrorBox error={error} />
            {!parsed && !error && <div className="muted text-[12.5px] py-8 text-center">Paste or load a tournament file to see what TorsGUI understands.</div>}
            {c && (
              <>
                <div className="panel p-3 flex flex-col gap-1.5">
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-[12.5px] muted">{c.event}</div>
                  <div className="grid grid-cols-4 gap-2 text-[12.5px] mt-1 tnum">
                    <div>
                      <div className="kpi-label">Games</div>
                      <span data-testid="tfile-total">{pv?.total_games ?? "—"}</span>
                    </div>
                    <div>
                      <div className="kpi-label">TC</div>
                      {c.tc}
                    </div>
                    <div>
                      <div className="kpi-label">Threads / hash</div>
                      {c.threads} / {c.hash_mb} MB
                    </div>
                    <div>
                      <div className="kpi-label">ETA</div>
                      {pv ? duration(pv.eta_s) : "—"}
                    </div>
                    <div>
                      <div className="kpi-label">Kind</div>
                      {c.kind.replace("_", " ")}
                      {c.variant === "chess960" && <span className="chip chip-accent ml-1">960</span>}
                    </div>
                    <div>
                      <div className="kpi-label">Per opponent</div>
                      {c.games_per_pairing} ({c.passes} pass{c.passes > 1 ? "es" : ""})
                    </div>
                    <div>
                      <div className="kpi-label">Nodes × lanes</div>
                      {c.nodes.length} × {c.lanes_per_node}
                    </div>
                    <div>
                      <div className="kpi-label">Book</div>
                      <span className="truncate block" title={c.book}>
                        {c.book.split(/[\\/]/).pop() || "—"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="panel overflow-auto max-h-[260px]">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>In the file</th>
                        <th>Engine</th>
                        <th>Match</th>
                        <th className="r">Rating</th>
                      </tr>
                    </thead>
                    <tbody>
                      {imp!.engines.map((e) => {
                        const p = c.participants.find((x) => x.name === e.name);
                        return (
                          <tr key={e.input + e.role}>
                            <td className="mono">
                              {e.input} {e.role === "seed" && <span className="chip chip-accent">seed</span>}
                            </td>
                            <td>{e.name ?? <span className="muted">{e.alternatives.length ? `did you mean ${e.alternatives.join(", ")}?` : "—"}</span>}</td>
                            <td>
                              <span className={`chip ${HOW_TONE[e.how] ?? ""}`}>{e.how}</span>
                            </td>
                            <td className="r tnum">{p?.rating != null ? `${Math.round(p.rating)}${p.rating_estimated ? " est." : ""}` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {errors.length > 0 && (
              <div className="rounded-md px-3 py-2 text-[12.5px] flex flex-col gap-1" style={{ background: "var(--loss-bg)", color: "var(--loss)" }} data-testid="tfile-errors">
                {errors.map((e, i) => (
                  <div key={i}>• {e}</div>
                ))}
              </div>
            )}
            {warnings.map((w, i) => (
              <Warn key={i}>{w}</Warn>
            ))}
            {imp?.notes && <div className="muted text-[12px] italic">{imp.notes}</div>}
          </div>
        </div>
      </Modal>
      <Modal
        open={template != null}
        onOpenChange={(o) => !o && setTemplate(null)}
        title="Tournament file template"
        width={880}
        footer={
          <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(template ?? "").then(() => toast.success("Template copied: paste it to Claude with your request"))}>
            <Copy size={13} /> Copy
          </button>
        }
      >
        <pre className="mono text-[11.5px] whitespace-pre-wrap max-h-[65vh] overflow-auto">{template}</pre>
      </Modal>
    </>
  );
}

/** "Save as file" of an existing tournament. */
export function ExportTournamentFile({ id }: { id: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <>
      <button className="btn" onClick={() => call<string>("tfile_export", { id }).then(setText)} title="The tournament as a TorsGUI tournament file (reuse it, or give it to Claude as an example)">
        <FileCode2 size={14} /> As file
      </button>
      <Modal
        open={text != null}
        onOpenChange={(o) => !o && setText(null)}
        title="Tournament file"
        width={760}
        footer={
          <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(text ?? "").then(() => toast.success("Copied"))}>
            <Copy size={13} /> Copy
          </button>
        }
      >
        <pre className="mono text-[12px] whitespace-pre-wrap max-h-[65vh] overflow-auto">{text}</pre>
      </Modal>
    </>
  );
}
