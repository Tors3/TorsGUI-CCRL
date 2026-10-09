import { AlertTriangle, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { UciOption } from "../bindings/UciOption";
import { call } from "../lib/api";

/** Options TorsGUI sets itself: the tournament's threads and hash, Chess960 from the variant. */
const MANAGED = new Set(["Threads", "Hash", "UCI_Chess960"]);

/**
 * The UCI options of one engine, with the right control for each type (number with its
 * range, true/false, list, text or file path). Only the options that are set are sent;
 * an empty value means "the engine's default". Options the engine does not declare are added
 * as name + value rows. With `engineId` the values are checked (names, ranges, files).
 */
/** The tablebase path TorsGUI sends by itself for an option (Syzygy, Gaviota, Nalimov, Scorpio EGBB). */
function tablebaseFor(name: string, kind: string, paths: TablebasePaths): string | undefined {
  const n = name.toLowerCase();
  if (name === "SyzygyPath") return paths.syzygy || undefined;
  if (kind !== "string" || !(n.includes("path") || n.includes("dir"))) return undefined;
  if (n.includes("gaviota")) return paths.gaviota || undefined;
  if (n.includes("nalimov")) return paths.nalimov || undefined;
  if (n.includes("egbb")) return paths.egbb || undefined;
  return undefined;
}

export type TablebasePaths = { syzygy?: string; gaviota?: string; nalimov?: string; egbb?: string };

export function UciOptionsEditor({ options, values, onChange, engineId, dir, syzygyPath, tournament }: { options: UciOption[]; values: Record<string, string>; onChange: (v: Record<string, string>) => void; engineId?: number | null; dir?: string; syzygyPath?: string; tournament?: boolean }) {
  // the tablebase paths of the settings (the tournament's Syzygy path when given)
  const [tb, setTb] = useState<TablebasePaths>({});
  useEffect(() => {
    call<{ syzygy_path: string; gaviota_path: string; nalimov_path: string; egbb_path: string }>("settings_get", {})
      // in a created tournament only the Syzygy path is added at each game; the others were
      // copied into the options when it was created
      .then((s) => setTb(tournament ? { syzygy: syzygyPath ?? s.syzygy_path } : { syzygy: syzygyPath ?? s.syzygy_path, gaviota: s.gaviota_path, nalimov: s.nalimov_path, egbb: s.egbb_path }))
      .catch(() => {});
  }, [syzygyPath, tournament]);
  const declared = useMemo(() => options.filter((o) => o.kind !== "button" && !MANAGED.has(o.name)), [options]);
  const names = useMemo(() => new Set(options.map((o) => o.name)), [options]);
  // options the engine does not declare (or all of them when its options are unknown)
  const [extra, setExtra] = useState<[string, string][]>(() => Object.entries(values).filter(([k]) => !names.has(k) && !MANAGED.has(k)));
  const [warnings, setWarnings] = useState<string[]>([]);
  const [q, setQ] = useState("");

  const set = (k: string, v: string) => {
    const n = { ...values };
    if (v === "") delete n[k];
    else n[k] = v;
    onChange(n);
  };
  const setExtraRows = (rows: [string, string][]) => {
    setExtra(rows);
    const kept = Object.fromEntries(Object.entries(values).filter(([k]) => names.has(k) || MANAGED.has(k)));
    for (const [k, v] of rows) if (k.trim() && !MANAGED.has(k.trim())) kept[k.trim()] = v.trim();
    onChange(kept);
  };

  const key = JSON.stringify(values);
  useEffect(() => {
    if (engineId == null) return;
    const t = setTimeout(() => {
      call<string[]>("engine_check_options", { engine_id: engineId, options: values })
        .then(setWarnings)
        .catch(() => setWarnings([]));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, engineId]);

  const shown = declared.filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()));
  const nSet = declared.filter((o) => values[o.name] != null).length + extra.filter(([k]) => k.trim()).length;

  return (
    <div className="flex flex-col gap-2" data-testid="uci-options">
      {declared.length > 0 ? (
        <>
          <div className="flex items-center gap-2 text-[12px]">
            <span className="muted">
              {declared.length} options declared by the engine · {nSet} set · empty = the engine's default. Threads and Hash come from the tournament.
            </span>
            {declared.length > 8 && <input className="input ml-auto" style={{ width: 180 }} placeholder="Find an option" value={q} onChange={(e) => setQ(e.target.value)} />}
          </div>
          <div className="overflow-auto" style={{ maxHeight: 340 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Option</th>
                  <th>Value sent</th>
                  <th>Engine default</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => {
                  const v = values[o.name] ?? "";
                  const auto = v === "" || v === "<empty>" ? tablebaseFor(o.name, o.kind, tb) : undefined;
                  return (
                    <tr key={o.name} style={v !== "" ? { background: "var(--accent-bg)" } : undefined}>
                      <td className="font-medium whitespace-nowrap">
                        {o.name} <span className="muted text-[11px]">{o.kind}</span>
                      </td>
                      <td style={{ minWidth: 220 }}>
                        <OptionInput o={o} v={v} set={(x) => set(o.name, x)} />
                        {auto && (
                          <div className="muted text-[11px] mt-0.5" data-testid={`uci-auto-${o.name}`}>
                            empty: TorsGUI sends <span className="mono">{auto}</span> ({o.name === "SyzygyPath" && syzygyPath != null ? "the tournament's Syzygy path" : "Settings → Paths"})
                          </div>
                        )}
                      </td>
                      <td className="mono muted text-[11.5px]">
                        {o.default ?? ""}
                        {o.kind === "spin" && o.min != null && o.max != null ? ` (${o.min}..${o.max})` : ""}
                      </td>
                      <td>
                        {v !== "" && (
                          <button className="btn btn-ghost btn-icon btn-sm" aria-label={`reset ${o.name}`} title="back to the engine default" onClick={() => set(o.name, "")}>
                            <RotateCcw size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="muted text-[12px]">The engine's options are not known yet (verify it to read them): write them below.</div>
      )}
      <div className="flex flex-col gap-1.5" data-testid="uci-extra">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="muted">{declared.length ? "Other options (not declared by the engine)" : "Options"}</span>
          <button className="btn btn-sm" onClick={() => setExtraRows([...extra, ["", ""]])} data-testid="uci-extra-add">
            <Plus size={12} /> Add option
          </button>
        </div>
        {extra.map(([k, v], i) => (
          <div key={i} className="flex items-center gap-2">
            <input className="input mono" style={{ width: 200 }} placeholder="Name (e.g. EvalFile)" value={k} onChange={(e) => setExtraRows(extra.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} aria-label={`extra option name ${i + 1}`} />
            <input className="input mono flex-1" placeholder="Value (e.g. nets/my-net.nnue)" value={v} onChange={(e) => setExtraRows(extra.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} aria-label={`extra option value ${i + 1}`} />
            <button className="btn btn-ghost btn-icon btn-sm" aria-label={`remove extra option ${i + 1}`} onClick={() => setExtraRows(extra.filter((_, j) => j !== i))}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      {dir && <div className="muted text-[11.5px]">Relative file paths are read from the engine folder: <span className="mono">{dir}</span></div>}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="uci-warnings">
          {warnings.map((w) => (
            <div key={w} className="flex items-start gap-1.5 text-[12px]" style={{ color: "var(--warn)" }}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OptionInput({ o, v, set }: { o: UciOption; v: string; set: (v: string) => void }) {
  const label = `option ${o.name}`;
  if (o.kind === "check")
    return (
      <select className="select" value={v} onChange={(e) => set(e.target.value)} aria-label={label}>
        <option value="">(default: {o.default ?? "?"})</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  if (o.kind === "combo")
    return (
      <select className="select" value={v} onChange={(e) => set(e.target.value)} aria-label={label}>
        <option value="">(default: {o.default ?? "?"})</option>
        {o.vars.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
    );
  if (o.kind === "spin")
    return <input className="input tnum" type="number" min={o.min ?? undefined} max={o.max ?? undefined} placeholder={o.default ?? ""} value={v} onChange={(e) => set(e.target.value)} aria-label={label} />;
  return <input className="input mono" placeholder={o.default && o.default !== "<empty>" ? o.default : ""} value={v} onChange={(e) => set(e.target.value)} aria-label={label} />;
}
