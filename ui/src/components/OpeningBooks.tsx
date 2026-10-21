import { BookOpen, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { BundledBook } from "../bindings/BundledBook";
import type { Settings } from "../bindings/Settings";
import { call, usePoll } from "../lib/api";
import { num } from "../lib/format";
import { Modal, PageTabs, Spinner } from "./ui";
import { useT, type Key } from "../i18n";

type BooksResp = { dir: string | null; books: BundledBook[] };

/** The groups of the book pickers, in their order: the bundled books, then the user's. */
export const BOOK_GROUPS = ["avt", "avt-eq", "gm", "other", "mine"] as const;
export type BookGroup = (typeof BOOK_GROUPS)[number];
const GROUP_LABEL: Record<BookGroup, Key> = { avt: "ui.bookGroups.avt", "avt-eq": "ui.bookGroups.avtEq", gm: "ui.bookGroups.gm", other: "ui.bookGroups.other", mine: "ui.bookGroups.mine" };
const groupOf = (g: string | null | undefined): BookGroup => (BOOK_GROUPS as readonly string[]).includes(g ?? "") ? (g as BookGroup) : "mine";
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
/** Books in group order, by name within a group. */
function sorted<B>(books: B[], group: (b: B) => string | null | undefined, name: (b: B) => string): B[] {
  return [...books].sort((a, b) => BOOK_GROUPS.indexOf(groupOf(group(a))) - BOOK_GROUPS.indexOf(groupOf(group(b))) || byName(name(a), name(b)));
}

/** A book of the books folder (`books_list`). */
export type InstalledBook = { path: string; name: string; positions: number; default: boolean; group?: string; title?: string | null; description?: string | null; note?: string | null };

/** Picks a book of the books folder: a button opening the books in tabs by group. */
export function BookPicker({ books, value, onPick }: { books: InstalledBook[]; value: string; onPick: (path: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const groups = BOOK_GROUPS.filter((g) => books.some((b) => groupOf(b.group) === g));
  const current = books.find((b) => b.path === value);
  const [tab, setTab] = useState<BookGroup>("avt");
  const shown = sorted(
    books.filter((b) => groupOf(b.group) === tab),
    (b) => b.group,
    (b) => b.title ?? b.name,
  );
  return (
    <>
      <button
        type="button"
        className="btn shrink-0 max-w-[260px]"
        onClick={() => {
          setTab(current ? groupOf(current.group) : (groups[0] ?? "avt"));
          setOpen(true);
        }}
        title={t("wizard.cond.installedBooks")}
        data-testid="book-pick"
      >
        <BookOpen size={13} className="shrink-0" /> <span className="truncate">{current ? (current.title ?? current.name) : t("wizard.cond.installedBooksPick")}</span>
      </button>
      <Modal open={open} onOpenChange={setOpen} title={t("wizard.cond.installedBooks")} width={760}>
        <PageTabs tabs={groups.map((g) => ({ id: g, label: t(GROUP_LABEL[g]), badge: books.filter((b) => groupOf(b.group) === g).length }))} value={tab} onChange={setTab} testid="book-group" />
        {tab === "avt-eq" && <div className="muted text-[12px] -mt-1.5 mb-2">{t("ui.bookGroups.eqAbout")}</div>}
        <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
          <table className="tbl" data-testid="book-pick-table">
            <tbody>
              {shown.map((b) => (
                <tr
                  key={b.path}
                  className="clickable"
                  onClick={() => {
                    onPick(b.path);
                    setOpen(false);
                  }}
                  data-book={b.name}
                >
                  <td className="font-medium">
                    {b.title ?? b.name}
                    {b.note && <span className="chip chip-accent ml-1.5" title={t("ui.bookGroups.noteTip")}>{b.note}</span>}
                    <div className="mono muted text-[11px]">{b.name}</div>
                  </td>
                  <td className="r tnum">{num(b.positions)}</td>
                  <td className="text-[12px] muted" style={{ whiteSpace: "normal", minWidth: 240, maxWidth: 380 }}>{b.description}</td>
                  <td className="r whitespace-nowrap">
                    {b.default && <span className="chip chip-win">{t("help.books.isDefault")}</span>}
                    {b.path === value && <Check size={13} className="inline ml-1.5" style={{ color: "var(--accent)" }} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </>
  );
}

/** Installs the opening books shipped with TorsGUI into the books folder. */
export function InstallBooksButton({ onDone, label }: { onDone?: () => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const t = useT();
  return (
    <button
      className="btn btn-primary"
      disabled={busy}
      data-testid="books-install"
      onClick={async () => {
        setBusy(true);
        try {
          const r = await call<{ installed: string[]; default_book: string; default_set: boolean }>("books_install");
          toast.success(t("help.books.installed", { count: r.installed.length }) + (r.default_set ? t("help.books.defaultSet", { file: r.default_book.split(/[\\/]/).pop() ?? "" }) : ""));
          onDone?.();
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner /> : <BookOpen size={13} />} {label ?? t("help.books.install")}
    </button>
  );
}

/** The bundled books with their description; install them, pick the default. */
export function OpeningBooksPanel({ settings, onSettings }: { settings: Settings; onSettings: () => void }) {
  const { data, refresh } = usePoll<BooksResp>("books_bundled", {}, 0);
  const all = data?.books ?? [];
  const t = useT();
  const [tab, setTab] = useState<"all" | BookGroup>("all");
  const groups = BOOK_GROUPS.filter((g) => all.some((b) => groupOf(b.group) === g));
  const books = sorted(
    all.filter((b) => tab === "all" || groupOf(b.group) === tab),
    (b) => b.group,
    (b) => b.name,
  );
  if (!data?.dir) return <div className="muted text-[12.5px]">{t("help.books.none")}</div>;
  const setDefault = async (file: string) => {
    const path = `${settings.books_dir.replace(/[\\/]+$/, "")}${settings.books_dir.includes("\\") ? "\\" : "/"}${file}`;
    await call("settings_save", { settings: { ...settings, default_book: path } });
    toast.success(t("help.books.defaultBook", { file }));
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
          label={all.every((b) => b.installed) ? t("help.books.reinstall") : t("help.books.installAll")}
        />
        <span className="muted text-[12px]">
          {t("help.books.into")}<span className="mono">{settings.books_dir}</span>{t("help.books.about")}
        </span>
      </div>
      <PageTabs
        tabs={[{ id: "all" as const, label: t("ui.bookGroups.all"), badge: all.length }, ...groups.map((g) => ({ id: g, label: t(GROUP_LABEL[g]), badge: all.filter((b) => groupOf(b.group) === g).length }))]}
        value={tab}
        onChange={setTab}
        testid="books-group"
      />
      {tab === "avt-eq" && <div className="muted text-[12px] -mt-1.5">{t("ui.bookGroups.eqAbout")}</div>}
      <div className="overflow-auto max-h-[300px]">
        <table className="tbl" data-testid="books-table">
          <thead>
            <tr>
              <th>{t("help.books.book")}</th>
              <th>{t("help.books.fileCol")}</th>
              <th className="r">{t("help.books.positions")}</th>
              <th>{t("help.books.description")}</th>
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
                    {b.note && <span className="chip chip-accent ml-1.5" title={t("ui.bookGroups.noteTip")}>{b.note}</span>}
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
                        <span className="chip chip-win">{t("help.books.isDefault")}</span>
                      ) : (
                        <button className="btn btn-sm" disabled={!b.installed} onClick={() => setDefault(b.file)}>
                          {t("help.books.useDefault")}
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
