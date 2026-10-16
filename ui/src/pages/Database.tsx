import { ChevronDown, ChevronRight, Copy, Download, Folder, FolderOpen, FolderPlus, Library, Microscope, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { DbCollection } from "../bindings/DbCollection";
import type { DbGame } from "../bindings/DbGame";
import type { DbImport } from "../bindings/DbImport";
import type { DbPosition } from "../bindings/DbPosition";
import { Board } from "../components/Board";
import { BoardSettingsButton } from "../components/BoardSettings";
import { GameViewer, type GameRef } from "../components/GameViewer";
import { PathInput } from "../components/PathInput";
import { Empty, ErrorBox, Field, MenuButton, Modal, PageHeader, PageTabs, Panel, Spinner } from "../components/ui";
import { FolderColorMenu, FolderIcon, useFolderColors } from "../components/Folders";
import { useT } from "../i18n";
import { call } from "../lib/api";

const LAST = "torsgui-db-folder";

/** Opens a position or a game in Game analysis. */
function analyse(nav: (to: string) => void, text: string) {
  try {
    sessionStorage.setItem("torsgui-analysis-text", text);
  } catch {
    /* private mode */
  }
  nav("/analysis?from=play");
}

/** A name for a folder (new, rename). */
function NameDialog({ open, title, initial, onOk, onClose }: { open: boolean; title: string; initial: string; onOk: (n: string) => void; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(initial);
  useEffect(() => setName(initial), [initial, open]);
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={title} width={420} footer={<button className="btn btn-primary" disabled={!name.trim()} onClick={() => onOk(name.trim())} data-testid="db-name-ok">{t("database.ok")}</button>}>
      <input className="input w-full" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && onOk(name.trim())} placeholder={t("database.namePlaceholder")} data-testid="db-name" />
    </Modal>
  );
}

/** The folder tree: folders with their subfolders, folded or open. */
function Tree({ all, parent, depth, sel, setSel, open, toggle, colorOf }: { all: DbCollection[]; parent: bigint | number | null; depth: number; sel?: number; setSel: (id: number) => void; open: number[]; toggle: (id: number) => void; colorOf: (id: number) => string | undefined }) {
  const kids = all.filter((c) => (c.parent ?? null) === parent);
  // games and positions of a folder with its subfolders
  const total = (id: number): number => {
    const c = all.find((x) => Number(x.id) === id);
    return (c ? c.games + c.positions : 0) + all.filter((x) => x.parent != null && Number(x.parent) === id).reduce((n, x) => n + total(Number(x.id)), 0);
  };
  return (
    <>
      {kids.map((c) => {
        const id = Number(c.id);
        const sub = all.some((x) => x.parent != null && Number(x.parent) === id);
        const isOpen = open.includes(id);
        return (
          <div key={id}>
            <div className="flex items-center text-[12.5px] rounded" style={{ paddingLeft: 4 + depth * 14, background: sel === id ? "var(--accent-bg)" : undefined }}>
              <button className="btn-icon w-4 h-6 flex items-center justify-center muted" onClick={() => sub && toggle(id)} aria-label={c.name} style={{ visibility: sub ? "visible" : "hidden" }}>
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              <button className="flex-1 text-left flex items-center gap-1.5 py-1 pr-2 min-w-0" onClick={() => setSel(id)} data-testid="db-folder">
                {colorOf(id) ? <FolderIcon size={13} open={sel === id} color={colorOf(id)} /> : sel === id ? <FolderOpen size={13} style={{ color: "var(--accent)" }} /> : <Folder size={13} className="muted" />}
                <span className={`truncate ${sel === id ? "font-medium" : ""}`}>{c.name}</span>
                {total(id) > 0 && <span className="muted text-[11px] ml-auto tnum">{total(id)}</span>}
              </button>
            </div>
            {sub && isOpen && <Tree all={all} parent={c.id} depth={depth + 1} sel={sel} setSel={setSel} open={open} toggle={toggle} colorOf={colorOf} />}
          </div>
        );
      })}
    </>
  );
}

/** Import games: a PGN file, a folder of PGN files, or pasted PGN. */
function ImportDialog({ open, setOpen, folder, onDone }: { open: boolean; setOpen: (o: boolean) => void; folder?: DbCollection; onDone: () => void }) {
  const t = useT();
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!folder) return;
    setBusy(true);
    try {
      const r = await call<DbImport>("db_import", { collection: folder.id, path: path.trim(), text });
      toast.success(t("database.imported", { count: r.added, folder: folder.name }));
      setPath("");
      setText("");
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t("database.importTitle", { folder: folder?.name ?? "" })}
      width={640}
      footer={
        <button className="btn btn-primary" disabled={busy || (!path.trim() && !text.trim())} onClick={run} data-testid="db-import-run">
          {busy ? <Spinner size={13} /> : <Upload size={13} />} {t("database.import")}
        </button>
      }
    >
      <div className="flex flex-col gap-3 text-[12.5px]">
        <Field label={t("database.importFile")} hint={t("database.importFileHint")}>
          <div className="flex flex-col gap-1.5">
            <PathInput kind="file" value={path} onChange={setPath} filters={[{ name: "PGN", extensions: ["pgn"] }]} placeholder="C:\Chess\my-games.pgn" testid="db-import-path" />
            <PathInput kind="folder" value={path} onChange={setPath} placeholder={t("database.importFolderPlaceholder")} />
          </div>
        </Field>
        <Field label={t("database.importPaste")}>
          <textarea className="input mono text-[11.5px]" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'[White "Me"]\n[Black "A friend"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0'} data-testid="db-import-text" />
        </Field>
        <div className="muted">{t("database.importAbout")}</div>
      </div>
    </Modal>
  );
}

/** Add positions: FEN or EPD lines. */
function PositionsDialog({ open, setOpen, folder, onDone }: { open: boolean; setOpen: (o: boolean) => void; folder?: DbCollection; onDone: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const run = async () => {
    if (!folder) return;
    try {
      const r = await call<{ added: number; errors: string[] }>("db_positions_add", { collection: folder.id, text });
      toast.success(t("database.posAdded", { count: r.added }));
      if (r.errors.length) toast.error(r.errors.slice(0, 3).join(" · "));
      setText("");
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Modal open={open} onOpenChange={setOpen} title={t("database.posAddTitle", { folder: folder?.name ?? "" })} width={640} footer={<button className="btn btn-primary" disabled={!text.trim()} onClick={run} data-testid="db-pos-run">{t("database.posAdd")}</button>}>
      <div className="flex flex-col gap-2 text-[12.5px]">
        <textarea className="input mono text-[11.5px]" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3\n6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - bm Rd8#; id "back rank"; c0 "mate in 1";'} data-testid="db-pos-text" />
        <div className="muted">{t("database.posAbout")}</div>
      </div>
    </Modal>
  );
}

/** Title and note of a position. */
function PositionEdit({ p, onClose, onDone }: { p: DbPosition | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    setTitle(p?.title ?? "");
    setNote(p?.note ?? "");
  }, [p]);
  const save = async () => {
    if (!p) return;
    await call("db_position_update", { id: p.id, title, note });
    onClose();
    onDone();
  };
  return (
    <Modal open={!!p} onOpenChange={(o) => !o && onClose()} title={t("database.posEdit")} width={460} footer={<button className="btn btn-primary" onClick={save}>{t("database.save")}</button>}>
      <div className="flex flex-col gap-2 text-[12.5px]">
        <Field label={t("database.posTitle")}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("database.posNote")}>
          <textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="mono muted text-[11px] break-all">{p?.fen}</div>
      </div>
    </Modal>
  );
}

/**
 * Database: your own games (engine or human) and positions, in folders and subfolders.
 * Games are imported from PGN and kept in TorsGUI; open them in the viewer or in Game analysis.
 */
export function DatabasePage() {
  const t = useT();
  const nav = useNavigate();
  const [all, setAll] = useState<DbCollection[]>();
  const [err, setErr] = useState<string>();
  const [sel, setSelState] = useState<number | undefined>(() => {
    const v = Number(localStorage.getItem(LAST));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  });
  const setSel = (id: number) => {
    setSelState(id);
    setPicked([]);
    try {
      localStorage.setItem(LAST, String(id));
    } catch {
      /* private mode */
    }
  };
  const [open, setOpen] = useState<number[]>([]);
  const [tab, setTab] = useState<"games" | "positions">("games");
  const [sub, setSub] = useState(true);
  const [q, setQ] = useState("");
  const [games, setGames] = useState<{ games: DbGame[]; total: number }>();
  const [positions, setPositions] = useState<DbPosition[]>();
  const [picked, setPicked] = useState<number[]>([]);
  const [naming, setNaming] = useState<null | { mode: "new" | "sub" | "rename"; initial: string }>(null);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DbPosition | null>(null);
  const [game, setGame] = useState<GameRef | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((x) => x + 1);

  useEffect(() => {
    call<DbCollection[]>("db_collections")
      .then((c) => {
        setAll(c);
        if (c.length && (sel == null || !c.some((x) => Number(x.id) === sel))) setSel(Number(c.find((x) => x.parent == null)?.id ?? c[0].id));
      })
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  const folder = all?.find((c) => Number(c.id) === sel);
  const { colorOf, nameOf, setColor } = useFolderColors();
  // the path of the selected folder: its parents are open in the tree
  const path = useMemo(() => {
    const out: DbCollection[] = [];
    let c = folder;
    while (c) {
      out.unshift(c);
      const p: number | null = c.parent;
      c = p == null ? undefined : all?.find((x) => Number(x.id) === Number(p));
    }
    return out;
  }, [folder, all]);
  useEffect(() => {
    const parents = path.slice(0, -1).map((c) => Number(c.id));
    if (parents.some((p) => !open.includes(p))) setOpen(Array.from(new Set([...open, ...parents])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => {
    if (sel == null) return;
    const h = setTimeout(() => {
      call<{ games: DbGame[]; total: number }>("db_games", { collection: sel, sub, q }).then(setGames).catch((e) => setErr((e as Error).message));
    }, 200);
    return () => clearTimeout(h);
  }, [sel, sub, q, tick]);
  useEffect(() => {
    if (sel == null) return;
    call<DbPosition[]>("db_positions", { collection: sel, sub }).then(setPositions).catch((e) => setErr((e as Error).message));
  }, [sel, sub, tick]);

  const named = async (name: string) => {
    const n = naming;
    setNaming(null);
    if (!n) return;
    try {
      if (n.mode === "rename" && folder) await call("db_collection_rename", { id: folder.id, name });
      else {
        const id = await call<number>("db_collection_create", { name, parent: n.mode === "sub" ? folder?.id : null });
        setSel(Number(id));
      }
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const removeFolder = async () => {
    if (!folder) return;
    if (!confirm(t("database.confirmDelete", { folder: folder.name }))) return;
    await call("db_collection_delete", { id: folder.id });
    setSelState(undefined);
    refresh();
  };
  const exportPgn = async () => {
    if (!folder) return;
    try {
      const r = await call<{ path: string }>("db_export", { collection: folder.id, sub });
      toast.success(t("database.exported", { path: r.path }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const moveTo = async (target: DbCollection) => {
    const cmd = tab === "games" ? "db_games_move" : "db_positions_move";
    await call(cmd, { ids: picked, collection: target.id });
    toast.success(t("database.moved", { count: picked.length, folder: target.name }));
    setPicked([]);
    refresh();
  };
  const removePicked = async () => {
    if (!confirm(t(tab === "games" ? "database.confirmDeleteGames" : "database.confirmDeletePositions", { count: picked.length }))) return;
    await call(tab === "games" ? "db_games_delete" : "db_positions_delete", { ids: picked });
    setPicked([]);
    refresh();
  };
  const analyseGame = async (id: number) => analyse(nav, await call<string>("db_game_pgn", { id }));
  const pathLabel = (c: DbCollection) => {
    const parts: string[] = [];
    let x: DbCollection | undefined = c;
    while (x) {
      parts.unshift(x.name);
      const p: number | null = x.parent;
      x = p == null ? undefined : all?.find((y) => Number(y.id) === Number(p));
    }
    return parts.join(" / ");
  };
  const list = tab === "games" ? games?.games.map((g) => Number(g.id)) ?? [] : positions?.map((p) => Number(p.id)) ?? [];
  const moveTargets = (all ?? []).filter((c) => Number(c.id) !== sel).sort((a, b) => pathLabel(a).localeCompare(pathLabel(b)));

  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader
        title={t("database.title")}
        sub={t("database.sub")}
        actions={
          <>
            <BoardSettingsButton />
            <button className="btn btn-primary" onClick={() => setNaming({ mode: "new", initial: "" })} data-testid="db-new-folder">
              <FolderPlus size={14} /> {t("database.newFolder")}
            </button>
          </>
        }
      />
      <ErrorBox error={err} />
      {all && all.length === 0 ? (
        <Panel>
          <Empty icon={<Library size={22} />}>
            <div className="flex flex-col items-center gap-2">
              <span>{t("database.empty")}</span>
              <button className="btn btn-primary" onClick={() => setNaming({ mode: "new", initial: "" })}>
                <FolderPlus size={14} /> {t("database.newFolder")}
              </button>
            </div>
          </Empty>
        </Panel>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "260px minmax(0, 1fr)" }}>
          <Panel noPad title={t("database.folders")}>
            <div className="p-1.5 overflow-auto" style={{ maxHeight: "calc(100vh - 220px)" }} data-testid="db-tree">
              {!all ? <Spinner /> : <Tree all={all} parent={null} depth={0} sel={sel} setSel={setSel} open={open} toggle={(id) => setOpen(open.includes(id) ? open.filter((x) => x !== id) : [...open, id])} colorOf={(id) => colorOf("database", id)} />}
            </div>
          </Panel>
          <div className="flex flex-col gap-3 min-w-0">
            {folder && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-[13px] font-medium flex items-center gap-1 min-w-0" data-testid="db-path">
                    {path.map((c, i) => (
                      <span key={Number(c.id)} className="flex items-center gap-1">
                        {i > 0 && <ChevronRight size={12} className="muted" />}
                        <button className={i === path.length - 1 ? "" : "muted hover:underline"} onClick={() => setSel(Number(c.id))}>
                          {c.name}
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5 ml-auto">
                    <FolderColorMenu value={nameOf("database", Number(folder.id))} onChange={(c) => setColor("database", Number(folder.id), c)} testid="db-folder-color" />
                    <button className="btn btn-sm" onClick={() => setNaming({ mode: "sub", initial: "" })} data-testid="db-new-sub">
                      <FolderPlus size={12} /> {t("database.newSub")}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setNaming({ mode: "rename", initial: folder.name })}>
                      <Pencil size={12} /> {t("database.rename")}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={removeFolder} data-testid="db-delete-folder">
                      <Trash2 size={12} /> {t("database.deleteFolder")}
                    </button>
                  </div>
                </div>
                <PageTabs
                  tabs={[
                    { id: "games", label: t("database.games"), badge: games?.total ?? "…" },
                    { id: "positions", label: t("database.positions"), badge: positions?.length ?? "…" },
                  ]}
                  value={tab}
                  onChange={(v) => {
                    setTab(v);
                    setPicked([]);
                  }}
                  testid="db-tab"
                />
                <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                  {tab === "games" && (
                    <div className="relative">
                      <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 muted" />
                      <input className="input" style={{ width: 260, paddingLeft: 26 }} placeholder={t("database.search")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="db-search" />
                    </div>
                  )}
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={sub} onChange={(e) => setSub(e.target.checked)} /> {t("database.withSub")}
                  </label>
                  <div className="flex gap-1.5 ml-auto">
                    {tab === "games" ? (
                      <>
                        <button className="btn btn-sm btn-primary" onClick={() => setImporting(true)} data-testid="db-import">
                          <Upload size={12} /> {t("database.importGames")}
                        </button>
                        <button className="btn btn-sm" onClick={exportPgn} disabled={!games?.total}>
                          <Download size={12} /> {t("database.exportPgn")}
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)} data-testid="db-add-positions">
                        <Plus size={12} /> {t("database.posAdd")}
                      </button>
                    )}
                  </div>
                </div>
                {picked.length > 0 && (
                  <div className="flex items-center gap-2 text-[12.5px] px-3 py-2 rounded-md" style={{ background: "var(--accent-bg)" }} data-testid="db-selection">
                    <span className="font-medium">{t("database.selected", { count: picked.length })}</span>
                    {moveTargets.length > 0 && (
                      <MenuButton
                        label={
                          <>
                            <Folder size={13} /> {t("database.moveTo")}
                          </>
                        }
                        items={moveTargets.map((c) => ({ icon: <Folder size={13} />, label: pathLabel(c), onSelect: () => moveTo(c) }))}
                      />
                    )}
                    <button className="btn btn-sm" onClick={removePicked}>
                      <Trash2 size={12} /> {t("database.delete")}
                    </button>
                    <button className="btn btn-sm btn-ghost ml-auto" onClick={() => setPicked([])}>
                      {t("database.clear")}
                    </button>
                  </div>
                )}
                {tab === "games" ? (
                  <Panel noPad>
                    {!games ? (
                      <Spinner />
                    ) : games.games.length === 0 ? (
                      <Empty>{q ? t("database.noMatch") : t("database.noGames")}</Empty>
                    ) : (
                      <>
                        <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 330px)" }}>
                          <table className="tbl" data-testid="db-games">
                            <thead>
                              <tr>
                                <th style={{ width: 1 }}>
                                  <input type="checkbox" aria-label={t("database.selectAll")} checked={list.length > 0 && list.every((id) => picked.includes(id))} onChange={(e) => setPicked(e.target.checked ? list : [])} />
                                </th>
                                <th>{t("database.white")}</th>
                                <th className="r">Elo</th>
                                <th>{t("database.black")}</th>
                                <th className="r">Elo</th>
                                <th>{t("database.result")}</th>
                                <th>{t("database.date")}</th>
                                <th>{t("database.event")}</th>
                                <th>{t("database.opening")}</th>
                                <th className="r">{t("database.moves")}</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {games.games.map((g) => {
                                const id = Number(g.id);
                                return (
                                  <tr key={id} className="clickable" onClick={() => setGame({ source: `db:${id}`, index: 0, title: `${g.white} – ${g.black}` })}>
                                    <td onClick={(e) => e.stopPropagation()}>
                                      <input type="checkbox" checked={picked.includes(id)} onChange={(e) => setPicked(e.target.checked ? [...picked, id] : picked.filter((x) => x !== id))} aria-label={`${g.white} – ${g.black}`} />
                                    </td>
                                    <td className={g.result === "1-0" ? "font-medium" : ""}>{g.white || "?"}</td>
                                    <td className="r tnum muted">{g.white_elo ?? ""}</td>
                                    <td className={g.result === "0-1" ? "font-medium" : ""}>{g.black || "?"}</td>
                                    <td className="r tnum muted">{g.black_elo ?? ""}</td>
                                    <td className="mono">{g.result}</td>
                                    <td className="tnum muted">{g.date.replace(/\.\?\?/g, "")}</td>
                                    <td className="truncate max-w-[200px]" title={g.site}>{g.event}</td>
                                    <td className="truncate max-w-[220px]">
                                      {g.eco && <span className="mono muted mr-1">{g.eco}</span>}
                                      {g.opening}
                                    </td>
                                    <td className="r tnum muted">{Math.ceil(g.plies / 2)}</td>
                                    <td onClick={(e) => e.stopPropagation()}>
                                      <button className="btn btn-ghost btn-icon btn-sm" title={t("database.analyse")} aria-label={t("database.analyse")} onClick={() => analyseGame(id)}>
                                        <Microscope size={13} />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {games.games.length < games.total && <div className="muted text-[11.5px] px-3 py-2">{t("database.limited", { shown: games.games.length, total: games.total })}</div>}
                      </>
                    )}
                  </Panel>
                ) : !positions ? (
                  <Spinner />
                ) : positions.length === 0 ? (
                  <Panel>
                    <Empty>{t("database.noPositions")}</Empty>
                  </Panel>
                ) : (
                  <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }} data-testid="db-positions">
                    {positions.map((p) => {
                      const id = Number(p.id);
                      return (
                        <div key={id} className="panel p-2 flex flex-col gap-1.5" style={picked.includes(id) ? { boxShadow: "0 0 0 2px var(--accent)" } : undefined}>
                          <div className="cursor-pointer" onClick={() => analyse(nav, p.fen)} title={t("database.analyse")}>
                            <Board fen={p.fen} orientation={p.fen.split(" ")[1] === "b" ? "black" : "white"} mini />
                          </div>
                          <div className="flex items-start gap-1.5 text-[12px]">
                            <input type="checkbox" className="mt-0.5" checked={picked.includes(id)} onChange={(e) => setPicked(e.target.checked ? [...picked, id] : picked.filter((x) => x !== id))} aria-label={p.title || p.fen} />
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate">{p.title || <span className="muted">{p.fen.split(" ")[1] === "b" ? t("database.blackToMove") : t("database.whiteToMove")}</span>}</div>
                              {p.note && <div className="muted text-[11px] line-clamp-2">{p.note}</div>}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <button className="btn btn-sm flex-1 justify-center" onClick={() => analyse(nav, p.fen)}>
                              <Microscope size={12} /> {t("database.analyse")}
                            </button>
                            <button className="btn btn-sm btn-icon" title={t("database.copyFen")} aria-label={t("database.copyFen")} onClick={() => navigator.clipboard.writeText(p.fen).then(() => toast.success(t("database.fenCopied")))}>
                              <Copy size={12} />
                            </button>
                            <button className="btn btn-sm btn-icon" title={t("database.posEdit")} aria-label={t("database.posEdit")} onClick={() => setEditing(p)}>
                              <Pencil size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <NameDialog
        open={!!naming}
        title={naming?.mode === "rename" ? t("database.renameTitle") : naming?.mode === "sub" ? t("database.newSubTitle", { folder: folder?.name ?? "" }) : t("database.newFolderTitle")}
        initial={naming?.initial ?? ""}
        onOk={named}
        onClose={() => setNaming(null)}
      />
      <ImportDialog open={importing} setOpen={setImporting} folder={folder} onDone={refresh} />
      <PositionsDialog open={adding} setOpen={setAdding} folder={folder} onDone={refresh} />
      <PositionEdit p={editing} onClose={() => setEditing(null)} onDone={refresh} />
      <GameViewer game={game} onClose={() => setGame(null)} />
    </div>
  );
}
