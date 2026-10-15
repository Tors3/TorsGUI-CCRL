import { FileCode2, Folder, FolderInput, FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cpuLabel } from "../lib/cpu";
import { toast } from "sonner";
import type { TournamentSummary } from "../bindings/TournamentSummary";
import { TournamentActions } from "../components/TournamentActions";
import { Empty, ErrorBox, Field, MenuButton, Modal, PageHeader, PageTabs, Panel, ProgressBar, Seg, Spinner, StateChip } from "../components/ui";
import { TournamentFileDialog } from "../components/TournamentFileDialog";
import { call, usePoll } from "../lib/api";
import { duration } from "../lib/format";
import { useT, type Key } from "../i18n";

type Importable = { name: string; dir: string; results: string | null; imported: boolean };

export function ImportDialog({ open, setOpen, onDone }: { open: boolean; setOpen: (o: boolean) => void; onDone: () => void }) {
  const [root, setRoot] = useState(() => localStorage.getItem("torsgui-import-root") ?? "");
  const [items, setItems] = useState<Importable[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const tr = useT();
  const scan = async () => {
    setError(undefined);
    try {
      localStorage.setItem("torsgui-import-root", root);
      setItems(await call<Importable[]>("import_scan", { root }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const imp = async (it: Importable) => {
    setBusy(it.name);
    try {
      const r = await call<{ name: string; done_games: number; expected_games: number; state: string }>("import_legacy", { dir: it.dir, results: it.results });
      toast.success(tr("tournaments.legacy.done", { name: r.name, done: r.done_games, expected: r.expected_games, state: r.state }));
      await scan();
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open={open} onOpenChange={setOpen} title={tr("tournaments.legacy.title")} width={760}>
      <div className="flex flex-col gap-3">
        <p className="muted text-[12.5px]">
          {tr("tournaments.legacy.about1")}<span className="mono">CCRL_ScirptsTests</span>{tr("tournaments.legacy.about2")}<span className="mono">tournaments/&lt;name&gt;/config</span>{tr("tournaments.legacy.about3")}<span className="mono">scripts/gauntlet.bat</span>{tr("tournaments.legacy.about4")}<span className="mono">pgn/</span>{tr("tournaments.legacy.about5")}<span className="mono">results/gauntlets/&lt;name&gt;/all_games.pgn</span>{tr("tournaments.legacy.about6")}
        </p>
        <div className="flex gap-2">
          <input className="input" value={root} onChange={(e) => setRoot(e.target.value)} placeholder="C:\Users\...\CCRL_ScirptsTests" aria-label={tr("tournaments.legacy.folder")} />
          <button className="btn" onClick={scan}>
            {tr("tournaments.legacy.scan")}
          </button>
        </div>
        <ErrorBox error={error} />
        <table className="tbl">
          <tbody>
            {items.map((it) => (
              <tr key={it.name}>
                <td className="mono">{it.name}</td>
                <td className="muted text-[12px]">{it.results ? tr("tournaments.legacy.withPgn") : tr("tournaments.legacy.configOnly")}</td>
                <td className="r">
                  {it.imported ? (
                    <span className="chip chip-accent">{tr("tournaments.imported")}</span>
                  ) : (
                    <button className="btn btn-sm" onClick={() => imp(it)} disabled={!!busy}>
                      {busy === it.name ? <Spinner /> : <FolderInput size={13} />} {tr("tournaments.legacy.import")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

const ALL = "\u0000all";
const NONE = "\u0000none";

/** The folders of the tournaments, by name. */
export function tournamentFolders(list: { record: { folder: string | null } }[]): string[] {
  return Array.from(new Set(list.map((t) => t.record.folder).filter((f): f is string => !!f))).sort((a, b) => a.localeCompare(b));
}

/** Asks a folder name (new folder, rename). */
function FolderNameDialog({ open, title, initial, onOk, onClose }: { open: boolean; title: string; initial: string; onOk: (name: string) => void; onClose: () => void }) {
  const tr = useT();
  const [name, setName] = useState(initial);
  useEffect(() => setName(initial), [initial, open]);
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      width={420}
      footer={
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onOk(name.trim())} data-testid="folder-name-ok">
          {tr("tournaments.folders.ok")}
        </button>
      }
    >
      <input className="input w-full" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && onOk(name.trim())} placeholder={tr("tournaments.folders.placeholder")} data-testid="folder-name" />
    </Modal>
  );
}

export function Tournaments() {
  const { data, error, refresh } = usePoll<TournamentSummary[]>("tournaments_list", {}, 4000);
  const nav = useNavigate();
  const [filter, setFilter] = useState<"all" | "active" | "done">("all");
  const [imp, setImp] = useState(false);
  const [tfile, setTfile] = useState(false);
  const tr = useT();
  // folders: a tab for each, plus all and "no folder"
  const [folder, setFolder] = useState<string>(() => localStorage.getItem("torsgui-tournament-folder") ?? ALL);
  const [picked, setPicked] = useState<string[]>([]);
  const [naming, setNaming] = useState<null | { mode: "new" | "rename"; initial: string }>(null);
  const folders = tournamentFolders(data ?? []);
  const shownFolder = folder !== ALL && folder !== NONE && !folders.includes(folder) ? ALL : folder;
  useEffect(() => {
    try {
      localStorage.setItem("torsgui-tournament-folder", shownFolder);
    } catch {
      /* private mode */
    }
  }, [shownFolder]);
  const inFolder = (t: TournamentSummary) => shownFolder === ALL || (shownFolder === NONE ? !t.record.folder : t.record.folder === shownFolder);
  const rows = (data ?? []).filter(inFolder).filter((t) =>
    filter === "all" ? true : filter === "active" ? ["running", "queued", "paused", "draft", "stopped"].includes(t.record.state) : ["completed", "incomplete", "failed"].includes(t.record.state),
  );
  const moveTo = async (target: string | null) => {
    try {
      await call("tournaments_set_folder", { ids: picked, folder: target });
      toast.success(target ? tr("tournaments.folders.moved", { count: picked.length, folder: target }) : tr("tournaments.folders.movedOut", { count: picked.length }));
      setPicked([]);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const named = async (name: string) => {
    const n = naming;
    setNaming(null);
    if (!n) return;
    if (n.mode === "new") {
      if (picked.length) await moveTo(name);
      setFolder(name);
    } else {
      try {
        await call("tournament_folder_rename", { from: n.initial, to: name });
        setFolder(name);
        refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  };
  const removeFolder = async (f: string) => {
    if (!confirm(tr("tournaments.folders.confirmDelete", { folder: f }))) return;
    await call("tournament_folder_rename", { from: f, to: "" });
    setFolder(ALL);
    refresh();
  };
  const count = (f: string) => (data ?? []).filter((t) => (f === ALL ? true : f === NONE ? !t.record.folder : t.record.folder === f)).length;
  const del = async (t: TournamentSummary) => {
    if (!confirm(tr("tournaments.confirmDelete", { name: t.record.name }))) return;
    try {
      await call("tournament_delete", { id: t.record.id });
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader help="create-a-gauntlet"
        title={tr("tournaments.title")}
        sub={tr("tournaments.sub")}
        actions={
          <>
            <Seg value={filter} onChange={setFilter} options={[{ value: "all", label: tr("tournaments.filter.all") }, { value: "active", label: tr("tournaments.filter.active") }, { value: "done", label: tr("tournaments.filter.done") }]} />
            <button className="btn" onClick={() => setImp(true)} title={tr("tournaments.importOldTip")}>
              <FolderInput size={14} /> {tr("tournaments.importOld")}
            </button>
            <button className="btn" onClick={() => setTfile(true)} data-testid="tfile-open">
              <FileCode2 size={14} /> {tr("tournaments.importFile")}
            </button>
            <button className="btn btn-primary" onClick={() => nav("/tournaments/new")}>
              <Plus size={14} /> {tr("tournaments.newTournament")}
            </button>
          </>
        }
      />
      <ErrorBox error={error} />
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <PageTabs
            tabs={[
              { id: ALL, label: tr("tournaments.folders.all"), badge: count(ALL) },
              ...folders.map((f) => ({ id: f, label: <span className="inline-flex items-center gap-1"><Folder size={12} /> {f}</span>, badge: count(f) })),
              { id: NONE, label: tr("tournaments.folders.none"), badge: count(NONE), hidden: folders.length === 0 },
            ]}
            value={shownFolder}
            onChange={setFolder}
            testid="tfolder"
          />
        </div>
        <div className="flex gap-1.5 items-center">
          {shownFolder !== ALL && shownFolder !== NONE && (
            <>
              <button className="btn btn-sm btn-ghost" onClick={() => setNaming({ mode: "rename", initial: shownFolder })} title={tr("tournaments.folders.rename")} data-testid="folder-rename">
                <Pencil size={12} /> {tr("tournaments.folders.rename")}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => removeFolder(shownFolder)} title={tr("tournaments.folders.deleteTip")} data-testid="folder-delete">
                <Trash2 size={12} /> {tr("tournaments.folders.delete")}
              </button>
            </>
          )}
          <button className="btn btn-sm" onClick={() => setNaming({ mode: "new", initial: "" })} title={tr("tournaments.folders.newTip")} data-testid="folder-new">
            <FolderPlus size={13} /> {tr("tournaments.folders.new")}
          </button>
        </div>
      </div>
      {picked.length > 0 && (
        <div className="flex items-center gap-2 text-[12.5px] px-3 py-2 rounded-md" style={{ background: "var(--accent-bg)" }} data-testid="tournaments-selection">
          <span className="font-medium">{tr("tournaments.folders.selected", { count: picked.length })}</span>
          <MenuButton
            testid="folder-move"
            label={
              <>
                <Folder size={13} /> {tr("tournaments.folders.moveTo")}
              </>
            }
            items={[
              ...folders.map((f) => ({ icon: <Folder size={13} />, label: f, onSelect: () => moveTo(f), testid: `move-to-${f}` })),
              { icon: <FolderPlus size={13} />, label: tr("tournaments.folders.newEllipsis"), onSelect: () => setNaming({ mode: "new", initial: "" }), testid: "move-to-new" },
              { icon: <FolderInput size={13} />, label: tr("tournaments.folders.out"), onSelect: () => moveTo(null), hidden: !picked.some((id) => (data ?? []).find((t) => t.record.id === id)?.record.folder), testid: "move-out" },
            ]}
          />
          <button className="btn btn-sm btn-ghost ml-auto" onClick={() => setPicked([])}>
            {tr("tournaments.folders.clear")}
          </button>
        </div>
      )}
      <Panel noPad>
        {rows.length === 0 ? (
          <Empty>{tr("tournaments.empty")}</Empty>
        ) : (
          <table className="tbl" data-testid="tournaments-table">
            <thead>
              <tr>
                <th style={{ width: 1 }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={tr("tournaments.folders.selectAll")}
                    checked={rows.length > 0 && rows.every((t) => picked.includes(t.record.id))}
                    onChange={(e) => setPicked(e.target.checked ? rows.map((t) => t.record.id) : [])}
                  />
                </th>
                <th>{tr("tournaments.col.name")}</th>
                <th>{tr("tournaments.col.type")}</th>
                <th>{tr("tournaments.col.state")}</th>
                <th style={{ width: 200 }}>{tr("tournaments.col.progress")}</th>
                <th>{tr("tournaments.col.seed")}</th>
                <th>{tr("tournaments.col.tc")}</th>
                <th className="r">{tr("tournaments.col.threads")}</th>
                <th className="r">{tr("tournaments.col.eta")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.record.id} className="clickable" onClick={() => nav(`/tournaments/${encodeURIComponent(t.record.id)}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={picked.includes(t.record.id)}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, t.record.id] : picked.filter((x) => x !== t.record.id))}
                      aria-label={t.record.name}
                      data-testid="tournament-pick"
                    />
                  </td>
                  <td className="font-medium max-w-[320px] truncate">
                    {t.record.name}
                    {shownFolder === ALL && t.record.folder && (
                      <span className="chip ml-2 inline-flex items-center gap-1">
                        <Folder size={10} /> {t.record.folder}
                      </span>
                    )}
                    {t.record.imported && <span className="chip ml-2">{tr("tournaments.imported")}</span>}
                  </td>
                  <td className="muted">{tr(`tournament.kind.${t.record.config.kind}` as Key)}</td>
                  <td>
                    <StateChip state={t.record.state} alive={t.runner_alive} />
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <ProgressBar value={t.progress.done} max={t.progress.expected} tone={t.record.state === "running" ? "win" : "accent"} />
                      </div>
                      <span className="tnum text-[12px] muted w-[74px] text-right">
                        {t.progress.done}/{t.progress.expected}
                      </span>
                    </div>
                  </td>
                  <td className="tnum">{t.score_line ?? "—"}</td>
                  <td className="mono">{t.record.config.tc}</td>
                  <td className="r tnum">{cpuLabel(t.record.config.participants, t.record.config.threads).replace(/CPU/g, "")}</td>
                  <td className="r tnum">{t.record.state === "running" ? duration(t.progress.eta_s) : "—"}</td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <TournamentActions t={t} onDone={refresh} compact />
                      {!(t.record.state === "running" && t.runner_alive) && (
                        <button className="btn btn-ghost btn-icon btn-sm" aria-label={tr("tournaments.deleteLabel")} onClick={() => del(t)}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <FolderNameDialog open={!!naming} title={naming?.mode === "rename" ? tr("tournaments.folders.renameTitle") : tr("tournaments.folders.newTitle")} initial={naming?.initial ?? ""} onOk={named} onClose={() => setNaming(null)} />
      <ImportDialog open={imp} setOpen={setImp} onDone={refresh} />
      <TournamentFileDialog open={tfile} setOpen={setTfile} onDone={refresh} />
    </div>
  );
}

export { Field };
