import { BookOpen, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { BundledBook } from "../bindings/BundledBook";
import type { Settings } from "../bindings/Settings";
import { call, usePoll } from "../lib/api";
import { num } from "../lib/format";
import { Spinner } from "./ui";

type BooksResp = { dir: string | null; books: BundledBook[] };

/** Installs the opening books shipped with TorsGUI into the books folder. */
export function InstallBooksButton({ onDone, label }: { onDone?: () => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-primary"
      disabled={busy}
      data-testid="books-install"
      onClick={async () => {
        setBusy(true);
        try {
          const r = await call<{ installed: string[]; default_book: string; default_set: boolean }>("books_install");
          toast.success(`${r.installed.length} opening books installed${r.default_set ? ` · default: ${r.default_book.split(/[\\/]/).pop()}` : ""}`);
          onDone?.();
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner /> : <BookOpen size={13} />} {label ?? "Install the CCRL opening books"}
    </button>
  );
}

/** The bundled books with their description; install them, pick the default. */
export function OpeningBooksPanel({ settings, onSettings }: { settings: Settings; onSettings: () => void }) {
  const { data, refresh } = usePoll<BooksResp>("books_bundled", {}, 0);
  const books = data?.books ?? [];
  if (!data?.dir) return <div className="muted text-[12.5px]">This installation has no bundled books.</div>;
  const setDefault = async (file: string) => {
    const path = `${settings.books_dir.replace(/[\\/]+$/, "")}${settings.books_dir.includes("\\") ? "\\" : "/"}${file}`;
    await call("settings_save", { settings: { ...settings, default_book: path } });
    toast.success(`Default book: ${file}`);
    onSettings();
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <InstallBooksButton
          onDone={() => {
            refresh();
            onSettings();
          }}
          label={books.every((b) => b.installed) ? "Reinstall the books" : "Install all the books"}
        />
        <span className="muted text-[12px]">
          into <span className="mono">{settings.books_dir}</span> · PGN books are used by fastchess, CGB books are for other GUIs
        </span>
      </div>
      <div className="overflow-auto max-h-[300px]">
        <table className="tbl" data-testid="books-table">
          <thead>
            <tr>
              <th>Book</th>
              <th>File</th>
              <th className="r">Positions</th>
              <th>Description</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {books.map((b) => {
              const isDefault = settings.default_book.replace(/\\/g, "/").endsWith("/" + b.file);
              return (
                <tr key={b.file} data-book={b.file} data-installed={b.installed ? "yes" : "no"}>
                  <td className="font-medium">
                    {b.name}
                    {b.author && <div className="muted text-[11px]">{b.author}{b.terms ? ` · ${b.terms}` : ""}</div>}
                  </td>
                  <td className="mono">
                    {b.file} {b.installed && <Check size={12} className="inline" style={{ color: "var(--win)" }} />}
                  </td>
                  <td className="r tnum">{b.positions != null ? num(b.positions) : "—"}</td>
                  <td className="text-[12px] muted max-w-[420px]">{b.description}</td>
                  <td className="r">
                    {b.fastchess &&
                      (isDefault ? (
                        <span className="chip chip-win">default</span>
                      ) : (
                        <button className="btn btn-sm" disabled={!b.installed} onClick={() => setDefault(b.file)}>
                          Use as default
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
