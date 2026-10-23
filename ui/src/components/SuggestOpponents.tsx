import { Download, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { EngineEntry } from "../bindings/EngineEntry";
import type { Suggestion } from "../bindings/Suggestion";
import { useT } from "../i18n";
import { call } from "../lib/api";
import { num } from "../lib/format";
import { DownloadQueue } from "./DownloadQueue";
import { ErrorBox, Field, Modal, Spinner } from "./ui";

/**
 * New tournament → Suggest opponents: the engines of the CCRL list nearest the seed's
 * estimated rating; those in the library are picked at once, the missing ones are downloaded
 * one after the other from here (GitHub dialog) and picked as they are installed.
 */
export function SuggestOpponents(props: {
  open: boolean;
  setOpen: (o: boolean) => void;
  list: string;
  threads: number;
  /** The seeds: left out of the suggestions. */
  exclude: string[];
  defaultElo: number | null;
  /** The engines to make the opponents (library ids); `refresh` reloads the library. */
  onApply: (ids: number[]) => void;
  refresh: () => void;
}) {
  const t = useT();
  const { open, setOpen, list, threads, exclude, defaultElo, onApply, refresh } = props;
  const [elo, setElo] = useState("");
  const [count, setCount] = useState(30);
  const [missing, setMissing] = useState(true);
  const [spread, setSpread] = useState(150);
  const [gpu, setGpu] = useState(false);
  const [rows, setRows] = useState<Suggestion[]>();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [queue, setQueue] = useState<string[]>([]);
  useEffect(() => {
    if (open && !elo && defaultElo != null) setElo(String(Math.round(defaultElo)));
    // the seed's rating when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const find = async () => {
    const around = Number(elo);
    if (!elo.trim() || !Number.isFinite(around)) return setError(t("wizard.suggest.eloNeeded"));
    setBusy(true);
    setError(undefined);
    try {
      const s = await call<Suggestion[]>("ccrl_suggest", { list, cpus: threads, top: Math.max(1, count), threads, only_installed: !missing, exclude, around, spread, gpu });
      setRows(s);
      setPicked(s.map((x) => x.list_name));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const chosen = (rows ?? []).filter((r) => picked.includes(r.list_name));
  const have = chosen.filter((r) => r.installed_engine_id != null).map((r) => r.installed_engine_id!);
  const toGet = chosen.filter((r) => r.installed_engine_id == null).map((r) => r.list_name);
  const apply = (ids: number[]) => {
    onApply(ids);
    toast.success(t("wizard.suggest.applied", { count: ids.length }));
  };
  return (
    <>
      <Modal
        open={open && queue.length === 0}
        onOpenChange={setOpen}
        title={t("wizard.suggest.title")}
        width={820}
        footer={
          rows && rows.length > 0 ? (
            <>
              {toGet.length > 0 && (
                <button className="btn" onClick={() => setQueue(toGet)} data-testid="suggest-download">
                  <Download size={13} /> {t("wizard.suggest.download", { count: toGet.length })}
                </button>
              )}
              <button
                className="btn btn-primary"
                disabled={have.length === 0}
                onClick={() => {
                  apply(have);
                  setOpen(false);
                }}
                data-testid="suggest-use"
              >
                {t("wizard.suggest.use", { count: have.length })}
              </button>
            </>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3" data-testid="suggest-dialog">
          <p className="muted text-[12.5px]">{t("wizard.suggest.about", { list, threads })}</p>
          <div className="flex items-end gap-3 flex-wrap">
            <Field label={t("wizard.suggest.elo")} hint={defaultElo != null ? t("wizard.suggest.eloHint") : undefined}>
              <input className="input tnum" style={{ width: 110 }} type="number" value={elo} onChange={(e) => { setElo(e.target.value); setError(undefined); }} onKeyDown={(e) => e.key === "Enter" && find()} data-testid="suggest-elo" />
            </Field>
            <Field label={t("wizard.suggest.count")}>
              <input className="input tnum" style={{ width: 80 }} type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, +e.target.value))} data-testid="suggest-count" />
            </Field>
            <Field label={t("wizard.suggest.spread")} hint={t("wizard.suggest.spreadHint")}>
              <input className="input tnum" style={{ width: 80 }} type="number" min={0} step={10} value={spread} onChange={(e) => setSpread(Math.max(0, +e.target.value))} data-testid="suggest-spread" />
            </Field>
            <div className="flex flex-col gap-1 pb-1 text-[12.5px]">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} data-testid="suggest-missing" /> {t("wizard.suggest.missing")}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={gpu} onChange={(e) => setGpu(e.target.checked)} data-testid="suggest-gpu" /> {t("wizard.suggest.gpu")}
              </label>
            </div>
            <button className="btn btn-primary mb-0.5" onClick={find} disabled={busy} data-testid="suggest-find">
              {busy ? <Spinner size={12} /> : <Sparkles size={13} />} {t("wizard.suggest.find")}
            </button>
          </div>
          <ErrorBox error={error} />
          {rows && rows.length === 0 && <div className="muted text-[12.5px]">{t("wizard.suggest.none")}</div>}
          {rows && rows.length > 0 && (
            <div className="overflow-auto" style={{ maxHeight: "50vh" }}>
              <table className="tbl" data-testid="suggest-table">
                <thead>
                  <tr>
                    <th style={{ width: 1 }}>
                      <input type="checkbox" checked={picked.length === rows.length} onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.list_name) : [])} />
                    </th>
                    <th className="r">#</th>
                    <th>CCRL {list}</th>
                    <th className="r">Elo</th>
                    <th className="r">{t("wizard.suggest.diff")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const d = Math.round(r.rating - Number(elo));
                    return (
                      <tr key={r.list_name} data-name={r.list_name}>
                        <td>
                          <input type="checkbox" checked={picked.includes(r.list_name)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.list_name] : picked.filter((x) => x !== r.list_name))} aria-label={r.list_name} />
                        </td>
                        <td className="r tnum muted">{r.rank}</td>
                        <td className="font-medium">
                          {r.list_name}
                          {r.note && <span className="muted text-[11px] ml-1.5">{r.note}</span>}
                        </td>
                        <td className="r tnum">{num(r.rating)}</td>
                        <td className="r tnum" style={{ color: d > 0 ? "var(--loss)" : d < 0 ? "var(--win)" : undefined }}>
                          {d > 0 ? `+${d}` : d}
                        </td>
                        <td>{r.installed_engine_id != null ? <span className="chip chip-win">{t("wizard.suggest.inLibrary")}</span> : <span className="chip chip-warn">{t("wizard.suggest.toGet")}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>
      <DownloadQueue
        names={queue}
        list={list}
        onEngine={() => refresh()}
        onFinish={(got: EngineEntry[]) => {
          setQueue([]);
          // the engines that were there, and the ones installed now
          const ids = [...have, ...got.map((e) => e.id).filter((x): x is number => x != null)];
          if (ids.length) apply(ids);
          refresh();
          setOpen(false);
          setRows(undefined);
        }}
      />
    </>
  );
}
