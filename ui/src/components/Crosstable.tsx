import { Copy, FileCode2, FileText, Grid3x3 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Crosstable as CT } from "../bindings/Crosstable";
import type { CtCell } from "../bindings/CtCell";
import { useT } from "../i18n";
import { call } from "../lib/api";
import { Empty, ErrorBox, Panel, Spinner } from "./ui";

/** Where the games come from: a tournament (its id) or a PGN file of the archive (its path). */
export type CrosstableSource = { kind: "tournament" | "file"; id: string };

const pts = (p: number) => (Number.isInteger(p) ? String(p) : p.toFixed(1));

function cellText(ct: CT, i: number, j: number, c: CtCell) {
  if (i === j) return "×";
  if (c.games === 0) return "";
  return ct.show_results ? c.results : `${pts(c.points)}/${c.games}`;
}

/** Green: won the encounter, red: lost it, yellow: even. */
function cellTone(i: number, j: number, c: CtCell) {
  if (i === j) return { background: "var(--bg-2)" };
  if (c.games === 0) return undefined;
  const d = c.points * 2 - c.games;
  return { background: d > 0 ? "var(--win-bg)" : d < 0 ? "var(--loss-bg)" : "var(--draw-bg)" };
}

/**
 * Every player against every other (from the PGN games): ranking by points, then
 * Sonneborn-Berger; copied as text or for the forum, saved as a text file or an HTML page.
 */
export function CrosstableView({ source, refreshKey }: { source: CrosstableSource; refreshKey?: unknown }) {
  const t = useT();
  const [ct, setCt] = useState<CT>();
  const [err, setErr] = useState<string>();
  useEffect(() => {
    setErr(undefined);
    call<CT>("crosstable", source)
      .then(setCt)
      .catch((e) => setErr((e as Error).message));
  }, [source.kind, source.id, refreshKey]);

  const copy = async (format: "text" | "bbcode") => {
    try {
      const text = await call<string>("crosstable_text", { ...source, format });
      await navigator.clipboard.writeText(text);
      toast.success(t(format === "bbcode" ? "crosstable.copiedForum" : "crosstable.copied"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const save = async (format: "txt" | "html") => {
    try {
      const r = await call<{ path: string }>("crosstable_save", { ...source, format });
      toast.success(t("crosstable.saved", { path: r.path }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (err) return <ErrorBox error={err} />;
  if (!ct) return <Spinner />;
  const n = ct.players.length;
  const hasRating = ct.players.some((p) => p.rating != null);
  const hasPerf = ct.players.some((p) => p.performance != null);
  return (
    <Panel
      noPad
      title={
        <span className="flex items-center gap-1.5">
          <Grid3x3 size={13} /> {ct.title || t("crosstable.title")}
        </span>
      }
      actions={
        n > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button className="btn btn-sm" onClick={() => copy("text")} data-testid="ct-copy">
              <Copy size={12} /> {t("crosstable.copy")}
            </button>
            <button className="btn btn-sm" onClick={() => copy("bbcode")} title={t("crosstable.copyForumTip")} data-testid="ct-copy-forum">
              <Copy size={12} /> {t("crosstable.copyForum")}
            </button>
            <button className="btn btn-sm" onClick={() => save("txt")} data-testid="ct-save-txt">
              <FileText size={12} /> {t("crosstable.saveTxt")}
            </button>
            <button className="btn btn-sm" onClick={() => save("html")} data-testid="ct-save-html">
              <FileCode2 size={12} /> {t("crosstable.saveHtml")}
            </button>
          </div>
        )
      }
    >
      {n === 0 ? (
        <Empty>{t("crosstable.empty")}</Empty>
      ) : (
        <>
          <div className="overflow-auto">
            <table className="tbl" data-testid="crosstable">
              <thead>
                <tr>
                  <th className="r">#</th>
                  <th>{t("crosstable.engine")}</th>
                  {hasRating && <th className="r">{t("crosstable.rating")}</th>}
                  <th className="r">{t("crosstable.score")}</th>
                  <th className="r">%</th>
                  <th className="r" title={t("crosstable.wdlTip")}>{t("crosstable.wdl")}</th>
                  {ct.players.map((p, j) => (
                    <th key={j} className="text-center" title={p.name}>
                      {j + 1}
                    </th>
                  ))}
                  <th className="r" title={t("crosstable.sbTip")}>S-B</th>
                  {hasPerf && <th className="r" title={t("crosstable.perfTip")}>{t("crosstable.perf")}</th>}
                </tr>
              </thead>
              <tbody>
                {ct.players.map((p, i) => (
                  <tr key={p.name}>
                    <td className="r tnum muted">{i + 1}</td>
                    <td className="font-medium whitespace-nowrap">{p.name}</td>
                    {hasRating && <td className="r tnum">{p.rating != null ? Math.round(p.rating) : ""}</td>}
                    <td className="r tnum font-medium">
                      {pts(p.points)}/{p.games}
                    </td>
                    <td className="r tnum">{p.games ? ((100 * p.points) / p.games).toFixed(1) : ""}</td>
                    <td className="r tnum muted whitespace-nowrap">
                      {p.wins}/{p.draws}/{p.losses}
                    </td>
                    {ct.cells[i].map((c, j) => (
                      <td
                        key={j}
                        className="text-center mono tnum whitespace-nowrap"
                        style={cellTone(i, j, c)}
                        title={i === j || c.games === 0 ? undefined : t("crosstable.cellTip", { a: p.name, b: ct.players[j].name, points: pts(c.points), games: c.games, results: c.results })}
                      >
                        {cellText(ct, i, j, c)}
                      </td>
                    ))}
                    <td className="r tnum">{p.sb.toFixed(2)}</td>
                    {hasPerf && <td className="r tnum">{p.performance != null ? Math.round(p.performance) : ""}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted text-[11.5px] px-3 py-2" data-testid="ct-legend">
            {t("crosstable.legend", { games: ct.games, cells: t(ct.show_results ? "crosstable.cellsResults" : "crosstable.cellsScore") })}
          </div>
        </>
      )}
    </Panel>
  );
}
