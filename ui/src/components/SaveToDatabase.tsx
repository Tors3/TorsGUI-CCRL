import { FolderPlus, Library } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { DbCollection } from "../bindings/DbCollection";
import type { DbImport } from "../bindings/DbImport";
import { useT } from "../i18n";
import { call } from "../lib/api";
import { Field, Modal, Spinner } from "./ui";

const LAST = "torsgui-db-save-folder";

/** "Club / 2025": the folder with its parents. */
export function folderPath(all: DbCollection[], c: DbCollection): string {
  const parts: string[] = [];
  let x: DbCollection | undefined = c;
  while (x) {
    parts.unshift(x.name);
    const p: number | null = x.parent;
    x = p == null ? undefined : all.find((y) => y.id === p);
  }
  return parts.join(" / ");
}

/**
 * Saves a game into a folder of the Database (Game analysis, Play vs engine): pick a folder or
 * create one; the last folder used is proposed next time.
 */
export function SaveToDatabaseButton({ getText, disabled, testid = "db-save" }: { getText: () => string | Promise<string>; disabled?: boolean; testid?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<DbCollection[]>();
  const [sel, setSel] = useState<number | "">("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setNewName("");
    call<DbCollection[]>("db_collections")
      .then((c) => {
        setAll(c);
        const last = Number(localStorage.getItem(LAST));
        setSel(c.some((x) => x.id === last) ? last : c[0]?.id ?? "");
      })
      .catch((e) => toast.error((e as Error).message));
  }, [open]);
  const save = async () => {
    setBusy(true);
    try {
      let folder = sel === "" ? null : sel;
      // a new folder, inside the one chosen (or at the top when there is none)
      if (newName.trim()) folder = await call<number>("db_collection_create", { name: newName.trim(), parent: folder });
      if (folder == null) return;
      const text = await getText();
      const r = await call<DbImport>("db_import", { collection: folder, text });
      try {
        localStorage.setItem(LAST, String(folder));
      } catch {
        /* private mode */
      }
      const name = newName.trim() || (all ? folderPath(all, all.find((c) => c.id === folder)!) : "");
      toast.success(r.added ? t("database.savedTo", { folder: name }) : t("database.nothingSaved"));
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sorted = (all ?? []).map((c) => ({ id: c.id, label: folderPath(all!, c) })).sort((a, b) => a.label.localeCompare(b.label));
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)} disabled={disabled} data-testid={testid}>
        <Library size={12} /> {t("database.saveToDb")}
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("database.saveToDbTitle")}
        width={460}
        footer={
          <button className="btn btn-primary" onClick={save} disabled={busy || (sel === "" && !newName.trim())} data-testid="db-save-ok">
            {busy ? <Spinner size={13} /> : null} {t("database.save")}
          </button>
        }
      >
        <div className="flex flex-col gap-3 text-[12.5px]">
          {!all ? (
            <Spinner />
          ) : (
            <>
              {sorted.length > 0 && (
                <Field label={t("database.saveFolder")}>
                  <select className="select" value={sel} onChange={(e) => setSel(e.target.value === "" ? "" : Number(e.target.value))} data-testid="db-save-folder">
                    {sorted.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label={sorted.length ? t("database.saveNewInside") : t("database.saveNewFolder")} hint={sorted.length ? t("database.saveNewHint") : undefined}>
                <div className="flex items-center gap-2">
                  <FolderPlus size={14} className="muted" />
                  <input className="input flex-1" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("database.namePlaceholder")} data-testid="db-save-new" />
                </div>
              </Field>
              <div className="muted">{t("database.saveAbout")}</div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
