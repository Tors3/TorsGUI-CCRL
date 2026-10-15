import { FileText, FolderPlus, Swords, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ArchiveSource } from "../bindings/ArchiveSource";
import type { GameRow } from "../bindings/GameRow";
import type { Settings } from "../bindings/Settings";
import { BoardSettingsButton } from "../components/BoardSettings";
import { GameViewer, type GameRef } from "../components/GameViewer";
import { GamesTable } from "../components/GamesTable";
import { Empty, ErrorBox, Modal, PageHeader, Panel, StateChip } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { useT } from "../i18n";

/** The game archive: every tournament's games plus PGN files or folders the user adds. */
export function Games() {
  const { data: sources, error, refresh } = usePoll<ArchiveSource[]>("archive_sources", {}, 0);
  const [sel, setSel] = useState<ArchiveSource | null>(null);
  const [rows, setRows] = useState<GameRow[]>();
  const [rowsErr, setRowsErr] = useState<string>();
  const [game, setGame] = useState<GameRef | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const t = useT();
  useEffect(() => {
    if (!sel && sources?.length) setSel(sources[0]);
  }, [sources, sel]);
  useEffect(() => {
    setRows(undefined);
    setRowsErr(undefined);
    if (!sel) return;
    const p = sel.kind === "tournament" ? call<GameRow[]>("games_list", { id: sel.id }) : call<GameRow[]>("archive_games", { source: sel.path });
    p.then(setRows).catch((e) => setRowsErr((e as Error).message));
  }, [sel]);
  const editArchive = async (f: (paths: string[]) => string[]) => {
    const s = await call<Settings>("settings_get");
    await call("settings_save", { settings: { ...s, archive_paths: f(s.archive_paths) } });
    refresh();
  };
  const add = async () => {
    try {
      await editArchive((p) => Array.from(new Set([...p, path.trim()])));
      toast.success(t("games.added"));
      setAdding(false);
      setPath("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const list = (sources ?? []).filter((s) => !q || s.label.toLowerCase().includes(q.toLowerCase()));
  const tournaments = list.filter((s) => s.kind === "tournament");
  const files = list.filter((s) => s.kind === "file");
  const total = (sources ?? []).reduce((a, s) => a + s.games, 0);
  const item = (s: ArchiveSource) => (
    <button
      key={s.kind + s.id}
      className="w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 group"
      style={{ background: sel?.id === s.id ? "var(--accent-bg)" : undefined, borderBottom: "1px solid var(--border)" }}
      onClick={() => setSel(s)}
      data-testid="archive-source"
    >
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium" title={s.path}>
          {s.label}
        </span>
        <span className="block muted text-[11px] tnum">
          {t("games.count", { games: s.games })}{s.files > 1 ? t("games.files", { count: s.files }) : ""}
        </span>
      </span>
      {s.state ? (
        <StateChip state={s.state} />
      ) : (
        <span
          role="button"
          className="btn btn-ghost btn-icon btn-sm opacity-0 group-hover:opacity-100"
          aria-label={t("games.removeLabel")}
          onClick={(e) => {
            e.stopPropagation();
            editArchive((p) => p.filter((x) => x !== s.path && !s.path.startsWith(x.replace(/[\\/]+$/, "") + "/") && !s.path.startsWith(x.replace(/[\\/]+$/, "") + "\\")));
            if (sel?.id === s.id) setSel(null);
          }}
        >
          <Trash2 size={12} />
        </span>
      )}
    </button>
  );
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader help="games-viewer-and-board"
        title={t("games.title")}
        sub={t("games.sub", { sources: sources?.length ?? 0, games: total })}
        actions={
          <>
            <BoardSettingsButton />
            <button className="btn" onClick={() => setAdding(true)}>
              <FolderPlus size={14} /> {t("games.add")}
            </button>
          </>
        }
      />
      <ErrorBox error={error} />
      {sources && sources.length === 0 ? (
        <Panel>
          <Empty icon={<Swords size={22} />}>{t("games.empty")}</Empty>
        </Panel>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "280px minmax(0, 1fr)" }}>
          <Panel noPad title={t("games.sources")} actions={<input className="input" style={{ width: 130 }} placeholder={t("games.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("games.searchLabel")} />}>
            <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
              {tournaments.length > 0 && <div className="kpi-label px-2.5 pt-2 pb-1">{t("games.tournaments")}</div>}
              {tournaments.map(item)}
              {files.length > 0 && (
                <div className="kpi-label px-2.5 pt-3 pb-1 flex items-center gap-1">
                  <FileText size={11} /> {t("games.pgnFiles")}
                </div>
              )}
              {files.map(item)}
            </div>
          </Panel>
          <div className="min-w-0">
            <ErrorBox error={rowsErr} />
            {sel && <GamesTable rows={rows} onOpen={setGame} title={sel.label} maxHeight="calc(100vh - 230px)" />}
          </div>
        </div>
      )}
      <GameViewer game={game} onClose={() => setGame(null)} />
      <Modal open={adding} onOpenChange={setAdding} title={t("games.addTitle")} footer={<button className="btn btn-primary" onClick={add} disabled={!path.trim()}>{t("games.addBtn")}</button>}>
        <p className="muted text-[12.5px] mb-2">{t("games.addAbout")}</p>
        <input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\CCRL\CCRL_ScirptsTests\tournaments\Triumviratus_7.0_8CPU\pgn" data-testid="archive-path" />
      </Modal>
    </div>
  );
}
