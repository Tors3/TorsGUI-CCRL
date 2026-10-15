import { CheckCircle2, FolderSearch, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { FolderCandidate } from "../bindings/FolderCandidate";
import type { Settings } from "../bindings/Settings";
import { useT } from "../i18n";
import { call } from "../lib/api";
import { PathInput } from "./PathInput";
import { ErrorBox, Field, Modal, Spinner, Tip } from "./ui";

type ImportResult = { added: string[]; failed: { path: string; error: string }[] };

/**
 * Engines → Add engine → From a folder: every executable of the folder (and its subfolders) is
 * probed with UCI, the engines found are imported in one go, and the folder is remembered so
 * that *Refresh* imports the engines added to it later.
 */
export function FolderImportDialog({ open, setOpen, onDone }: { open: boolean; setOpen: (o: boolean) => void; onDone: () => void }) {
  const t = useT();
  const [dir, setDir] = useState("");
  const [found, setFound] = useState<FolderCandidate[]>();
  const [picked, setPicked] = useState<string[]>([]);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<"scan" | "import" | null>(null);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    if (!open) {
      setFound(undefined);
      setErr(undefined);
    }
  }, [open]);

  const scan = async () => {
    setBusy("scan");
    setErr(undefined);
    setFound(undefined);
    try {
      const c = await call<FolderCandidate[]>("engines_folder_scan", { dir: dir.trim() });
      setFound(c);
      setPicked(c.filter((x) => x.ok && !x.in_library && !x.duplicate).map((x) => x.path));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const doImport = async () => {
    setBusy("import");
    try {
      const r = await call<ImportResult>("engines_folder_import", { paths: picked, remember: remember ? dir.trim() : null });
      if (r.added.length) toast.success(t("engines.folder.imported", { count: r.added.length, names: r.added.join(", ") }));
      if (r.failed.length) toast.error(t("engines.folder.failed", { count: r.failed.length }));
      onDone();
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const engines = (found ?? []).filter((c) => c.ok || c.in_library);
  const others = (found ?? []).filter((c) => !c.ok && !c.in_library);
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t("engines.folder.title")}
      width={820}
      footer={
        <>
          <label className="flex items-center gap-1.5 text-[12.5px] mr-auto">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="folder-remember" /> {t("engines.folder.remember")}
          </label>
          <button className="btn btn-primary" disabled={!picked.length || busy != null} onClick={doImport} data-testid="folder-import">
            {busy === "import" ? <Spinner size={13} /> : null} {t("engines.folder.import", { count: picked.length })}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[12.5px]">
        <Field label={t("engines.folder.dir")} hint={t("engines.folder.dirHint")}>
          <div className="flex gap-2">
            <div className="flex-1">
              <PathInput kind="folder" value={dir} onChange={setDir} placeholder="C:\CCRL\engines" testid="folder-path" onEnter={scan} />
            </div>
            <button className="btn" onClick={scan} disabled={!dir.trim() || busy != null} data-testid="folder-scan">
              {busy === "scan" ? <Spinner size={13} /> : <FolderSearch size={13} />} {t("engines.folder.scan")}
            </button>
          </div>
        </Field>
        <div className="muted">{t("engines.folder.about")}</div>
        <ErrorBox error={err} />
        {busy === "scan" && <div className="muted">{t("engines.folder.scanning")}</div>}
        {found && (
          <>
            <div className="font-medium" data-testid="folder-summary">
              {t("engines.folder.summary", { files: found.length, engines: engines.length, fresh: found.filter((c) => c.ok && !c.in_library && !c.duplicate).length })}
            </div>
            {engines.length > 0 && (
              <div className="overflow-auto" style={{ maxHeight: 340 }}>
                <table className="tbl" data-testid="folder-list">
                  <thead>
                    <tr>
                      <th style={{ width: 1 }}>
                        <input
                          type="checkbox"
                          aria-label={t("engines.folder.all")}
                          checked={picked.length > 0 && picked.length === engines.filter((c) => !c.in_library).length}
                          onChange={(e) => setPicked(e.target.checked ? engines.filter((c) => !c.in_library).map((c) => c.path) : [])}
                        />
                      </th>
                      <th>{t("engines.folder.name")}</th>
                      <th>id name</th>
                      <th>{t("engines.folder.file")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {engines.map((c) => (
                      <tr key={c.path} style={c.in_library ? { opacity: 0.55 } : undefined}>
                        <td className="text-center">
                          {c.in_library ? (
                            <Tip content={t("engines.folder.inLibrary")}>
                              <CheckCircle2 size={14} style={{ color: "var(--win)" }} />
                            </Tip>
                          ) : (
                            <input type="checkbox" checked={picked.includes(c.path)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.path] : picked.filter((p) => p !== c.path))} aria-label={c.display_name} />
                          )}
                        </td>
                        <td className="font-medium">
                          {c.display_name}
                          {c.in_library && <span className="muted"> · {t("engines.folder.inLibrary")}</span>}
                          {c.duplicate && <span className="block muted text-[11px]" style={{ color: "var(--warn)" }}>{c.note.startsWith("same name") ? t("engines.folder.sameName") : t("engines.folder.otherBuild")}</span>}
                        </td>
                        <td className="mono muted">{c.id_name || "—"}</td>
                        <td className="mono muted text-[11.5px] truncate max-w-[260px]" title={c.path}>
                          {c.file}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {others.length > 0 && (
              <details>
                <summary className="muted cursor-pointer">{t("engines.folder.others", { count: others.length })}</summary>
                <div className="flex flex-col gap-0.5 mt-1 max-h-[120px] overflow-auto">
                  {others.map((c) => (
                    <div key={c.path} className="flex items-center gap-1.5 muted text-[11.5px]">
                      <XCircle size={11} /> <span className="mono">{c.file}</span> — {c.error}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Imports the new engines of the remembered folders (shown only when there is one). */
export function RefreshFoldersButton({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [folders, setFolders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call<Settings>("settings_get").then((s) => setFolders(s.engine_folders ?? [])).catch(() => {});
  }, []);
  if (!folders.length) return null;
  const run = async () => {
    setBusy(true);
    try {
      const r = await call<ImportResult & { folders: string[] }>("engines_folders_refresh");
      if (r.added.length) toast.success(t("engines.folder.imported", { count: r.added.length, names: r.added.join(", ") }));
      else toast.success(t("engines.folder.nothingNew"));
      if (r.failed.length) toast.error(t("engines.folder.failed", { count: r.failed.length }));
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tip content={t("engines.folder.refreshTip", { folders: folders.join(" · ") })}>
      <button className="btn" onClick={run} disabled={busy} data-testid="engines-folders-refresh">
        {busy ? <Spinner size={13} /> : <RefreshCw size={14} />} {t("engines.folder.refresh")}
      </button>
    </Tip>
  );
}
