import { FileCode2, FolderInput, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { cpuLabel } from "../lib/cpu";
import { toast } from "sonner";
import type { TournamentSummary } from "../bindings/TournamentSummary";
import { TournamentActions } from "../components/TournamentActions";
import { Empty, ErrorBox, Field, Modal, PageHeader, Panel, ProgressBar, Seg, Spinner, StateChip } from "../components/ui";
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

export function Tournaments() {
  const { data, error, refresh } = usePoll<TournamentSummary[]>("tournaments_list", {}, 4000);
  const nav = useNavigate();
  const [filter, setFilter] = useState<"all" | "active" | "done">("all");
  const [imp, setImp] = useState(false);
  const [tfile, setTfile] = useState(false);
  const tr = useT();
  const rows = (data ?? []).filter((t) =>
    filter === "all" ? true : filter === "active" ? ["running", "queued", "paused", "draft", "stopped"].includes(t.record.state) : ["completed", "incomplete", "failed"].includes(t.record.state),
  );
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
      <Panel noPad>
        {rows.length === 0 ? (
          <Empty>{tr("tournaments.empty")}</Empty>
        ) : (
          <table className="tbl" data-testid="tournaments-table">
            <thead>
              <tr>
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
                  <td className="font-medium max-w-[320px] truncate">
                    {t.record.name}
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
      <ImportDialog open={imp} setOpen={setImp} onDone={refresh} />
      <TournamentFileDialog open={tfile} setOpen={setTfile} onDone={refresh} />
    </div>
  );
}

export { Field };
