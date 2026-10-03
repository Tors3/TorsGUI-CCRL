import { Calculator, Download, Gauge, Play, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { BenchConfig } from "../bindings/BenchConfig";
import type { BenchProgress } from "../bindings/BenchProgress";
import type { BenchRun } from "../bindings/BenchRun";
import type { NominalTc } from "../bindings/NominalTc";
import type { Settings } from "../bindings/Settings";
import type { TcResult } from "../bindings/TcResult";
import type { Topology } from "../bindings/Topology";
import { LineChart } from "../components/Chart";
import { Empty, ErrorBox, Field, PageHeader, Panel, ProgressBar, Spinner, Warn } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { num } from "../lib/format";

type Hist = { id: number; host: string; created_at: string; run: BenchRun };
const COLORS = ["#6d8cff", "#3fb97a", "#e3b341", "#f06a6a", "#b48cff", "#4fc3d9", "#e58fd0", "#9aa4b5"];

export function Bench() {
  const { data: topo } = usePoll<Topology>("topology", {}, 0);
  const { data: bins, refresh: refreshBins } = usePoll<{ dir: string; binaries: [string, string][] }>("bench_binaries", {}, 0);
  const { data: hist, refresh: refreshHist } = usePoll<Hist[]>("bench_history", {}, 0);
  const { data: settings, refresh: refreshSettings } = usePoll<Settings>("settings_get", {}, 0);
  const { data: presets } = usePoll<NominalTc[]>("tc_presets", {}, 0);
  const [progress, setProgress] = useState<BenchProgress>();
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [levels, setLevels] = useState("1");
  const [runs, setRuns] = useState(5);
  const [warmup, setWarmup] = useState(1);
  const [force, setForce] = useState(false);
  const [importPaths, setImportPaths] = useState("");
  // TC calculator
  const [nominal, setNominal] = useState("blitz");
  const [factor, setFactor] = useState(0.86);
  const [bf, setBf] = useState("");
  const [inf, setInf] = useState("");
  const [tc, setTc] = useState<TcResult>();
  const [tcErr, setTcErr] = useState<string>();

  useEffect(() => {
    if (!topo) return;
    const p0 = topo.nodes[0]?.physical_cores ?? topo.physical_cores;
    setLevels(Array.from(new Set([1, Math.max(1, Math.floor(p0 / 2)), p0, topo.physical_cores, topo.logical_cpus])).sort((a, b) => a - b).join(","));
  }, [topo]);
  useEffect(() => {
    if (bins) setPicked(bins.binaries.map(([, p]) => p));
  }, [bins]);
  useEffect(() => {
    if (settings) {
      setBf((b) => b || settings.tc_base_formula);
      setInf((i) => i || settings.tc_inc_formula);
    }
  }, [settings]);
  useEffect(() => {
    const t = setInterval(async () => {
      const p = await call<BenchProgress>("bench_progress").catch(() => undefined);
      setProgress(p);
      if (p && !p.running && p.phase === "done" && progress?.running) refreshHist();
    }, 1000);
    return () => clearInterval(t);
  }, [progress?.running, refreshHist]);

  const computeTc = async () => {
    const n = presets?.find((p) => p.id === nominal);
    if (!n) return;
    try {
      setTc(await call<TcResult>("tc_compute", { nominal: n, factor, base_formula: bf || null, inc_formula: inf || null }));
      setTcErr(undefined);
    } catch (e) {
      setTcErr((e as Error).message);
    }
  };
  useEffect(() => {
    computeTc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nominal, factor, bf, inf, presets]);

  const start = async () => {
    const all = [...(bins?.binaries ?? []).filter(([, p]) => picked.includes(p)), ...(custom ? [["custom", custom] as [string, string]] : [])];
    const cfg: BenchConfig = { binaries: all, levels: levels.split(",").map((x) => Number(x.trim())).filter(Boolean), runs, warmup, hash: 16, depth: 13, ref_ms: 2054, pin: true, force };
    try {
      await call("bench_start", { config: cfg });
      toast("Bench started: keep the machine idle");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const saveFormulas = async () => {
    if (!settings) return;
    await call("settings_save", { settings: { ...settings, tc_base_formula: bf, tc_inc_formula: inf, default_factor: factor } });
    toast.success("Formulas and factor saved as defaults");
    refreshSettings();
  };
  const latest = progress?.result ?? (hist ?? []).slice().sort((a, b) => (a.run.created_at || a.created_at).localeCompare(b.run.created_at || b.created_at)).pop()?.run;
  const chart = useMemo(() => {
    const when = (h: Hist) => h.run.created_at || h.created_at;
    const runs = (hist ?? []).filter((h) => h.run.levels?.length).sort((a, b) => when(a).localeCompare(when(b)));
    const xs = Array.from(new Set(runs.flatMap((h) => h.run.levels.map((l) => l.instances)))).sort((a, b) => a - b);
    return {
      xs,
      series: runs.slice(-8).map((h, i) => ({
        label: `${when(h).slice(0, 16).replace("T", " ")} ${h.run.builds.join("+")}${h.run.valid ? "" : " (invalid)"}`,
        color: COLORS[i % COLORS.length],
        dash: h.run.valid ? undefined : [4, 4],
        values: xs.map((x) => h.run.levels.find((l) => l.instances === x)?.factor ?? null),
      })),
    };
  }, [hist]);

  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader help="bench-and-time-control" title="Bench & calibration" sub="Stockfish 10 bench against the CCRL reference i7-4770K (2054 ms, 3 939 338 nodes)" />
      <div className="grid gap-3 bench-grid">
        <Panel title="Run a bench">
          <div className="flex flex-col gap-2.5">
            <div className="kpi-label">Stockfish 10 builds (64-bit only)</div>
            {(bins?.binaries ?? []).map(([b, p]) => (
              <label key={p} className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={picked.includes(p)} onChange={() => setPicked(picked.includes(p) ? picked.filter((x) => x !== p) : [...picked, p])} />
                <span className="chip">{b}</span>
                <span className="mono muted truncate" title={p}>
                  {p.split(/[\\/]/).pop()}
                </span>
              </label>
            ))}
            {(bins?.binaries ?? []).length === 0 && <div className="muted text-[12px]">No binary in {bins?.dir}.</div>}
            <button
              className="btn btn-sm"
              onClick={() =>
                call("bench_prepare")
                  .then(() => {
                    toast.success("Official Stockfish 10 builds downloaded and verified (sha256)");
                    refreshBins();
                  })
                  .catch((e) => toast.error(e.message))
              }
            >
              <Download size={12} /> Get official SF10 (x64, popcnt, bmi2)
            </button>
            <Field label="Or another 64-bit Stockfish 10 binary">
              <input className="input mono" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="/path/to/stockfish_10_x64" />
            </Field>
            <Field label="Parallel instances (levels)" hint="1 = single core; more instances load the machine like concurrent games">
              <input className="input mono" value={levels} onChange={(e) => setLevels(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Runs per instance">
                <input className="input tnum" type="number" value={runs} onChange={(e) => setRuns(+e.target.value)} />
              </Field>
              <Field label="Warm-up runs">
                <input className="input tnum" type="number" value={warmup} onChange={(e) => setWarmup(+e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Run even if the CPU is busy (result marked invalid)
            </label>
            <button className="btn btn-primary justify-center" onClick={start} disabled={progress?.running || (!picked.length && !custom)}>
              {progress?.running ? <Spinner /> : <Play size={14} />} Start bench
            </button>
            {progress?.running && (
              <div className="flex flex-col gap-1">
                <div className="text-[12px]">{progress.phase}</div>
                <ProgressBar value={progress.done_levels} max={progress.total_levels} />
              </div>
            )}
            <ErrorBox error={progress?.error ?? undefined} />
            <div className="muted text-[11.5px]">Guards: 32-bit binaries are refused, the CPU must be idle (&lt; 5 % load), the power plan (minimum processor state) and the frequency are recorded.</div>
          </div>
        </Panel>
        <div className="flex flex-col gap-3 min-w-0">
          <Panel title={latest ? `Latest result — ${latest.host} · ${latest.cpu}` : "Latest result"} noPad>
            {!latest ? (
              <Empty icon={<Gauge size={20} />}>No bench yet.</Empty>
            ) : (
              <>
                <div className="px-3 pt-2 flex flex-wrap gap-2 items-center text-[12px]">
                  <span className={`chip ${latest.valid ? "chip-win" : "chip-loss"}`}>{latest.valid ? "valid" : "invalid"}</span>
                  <span className="mono">{latest.engine}</span>
                  <span className="muted">
                    nodes {latest.signature.join(", ")} {latest.signature_ok ? "✓" : "≠ 3939338"}
                  </span>
                  {latest.power?.plan && <span className="muted truncate max-w-[300px]">{latest.power.plan}</span>}
                  {latest.power?.current_mhz != null && <span className="muted">{latest.power.current_mhz} MHz</span>}
                </div>
                <div className="px-3 py-1 flex flex-col gap-1">
                  {latest.warnings.map((w, i) => (
                    <Warn key={i}>{w}</Warn>
                  ))}
                </div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Build</th>
                      <th className="r">Instances</th>
                      <th className="r">HT</th>
                      <th className="r">nps / inst. (mean)</th>
                      <th className="r">median</th>
                      <th className="r">spread</th>
                      <th className="r">sd</th>
                      <th className="r">bench ms</th>
                      <th className="r">Factor</th>
                      <th className="r">Blitz 2+1</th>
                      <th className="r">15+10</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.levels.map((l, i) => (
                      <tr key={i} className="clickable" onClick={() => setFactor(l.factor)} title="Use this factor in the TC calculator">
                        <td>
                          <span className="chip">{l.build}</span>
                        </td>
                        <td className="r">{l.instances}</td>
                        <td className="r">{l.ht_siblings}</td>
                        <td className="r">{num(l.nps_mean)}</td>
                        <td className="r">{num(l.nps_median)}</td>
                        <td className="r">{l.spread_pct.toFixed(1)}%</td>
                        <td className="r">{l.stdev_pct.toFixed(2)}%</td>
                        <td className="r">{num(l.bench_time_ms)}</td>
                        <td className="r font-semibold">{l.factor.toFixed(4)}</td>
                        <td className="r mono">
                          {Math.round(120 * l.factor)}+{Math.max(1, Math.round(l.factor))}
                        </td>
                        <td className="r mono">
                          {Math.round(900 * l.factor)}+{Math.max(1, Math.round(10 * l.factor))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Panel>
          <Panel title="History — factor vs parallel instances (dashed = invalid run)">
            {chart.series.length ? (
              <>
                <LineChart x={chart.xs} series={chart.series} height={180} xLabel={(v) => String(v)} />
                <div className="flex flex-wrap gap-3 mt-2 text-[11.5px]">
                  {chart.series.map((s) => (
                    <span key={s.label} className="flex items-center gap-1.5">
                      <span className="dot" style={{ color: s.color }} />
                      {s.label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <Empty>No history yet.</Empty>
            )}
          </Panel>
          <Panel title="Runs" noPad>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Host</th>
                  <th>Engine</th>
                  <th>Builds</th>
                  <th className="r">Levels</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(hist ?? [])
                  .slice()
                  .sort((a, b) => (b.run.created_at || b.created_at).localeCompare(a.run.created_at || a.created_at))
                  .map((h) => (
                    <tr key={h.id}>
                      <td className="mono">{(h.run.created_at || h.created_at).slice(0, 16).replace("T", " ")}</td>
                      <td>{h.host}</td>
                      <td className="mono">{h.run.engine}</td>
                      <td>{h.run.builds.join(", ")}</td>
                      <td className="r">{h.run.levels.map((l) => l.instances).join(", ")}</td>
                      <td title={h.run.invalid_reason ?? ""}>
                        <span className={`chip ${h.run.valid ? "chip-win" : "chip-loss"}`}>{h.run.valid ? "valid" : "invalid"}</span>
                      </td>
                      <td className="r">
                        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Delete run" onClick={() => call("bench_delete", { id: h.id }).then(refreshHist)}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="flex gap-2 p-3" style={{ borderTop: "1px solid var(--border)" }}>
              <input className="input mono" placeholder="Import ccrl_bench.py JSON results (paths, comma separated)" value={importPaths} onChange={(e) => setImportPaths(e.target.value)} />
              <button
                className="btn"
                onClick={() =>
                  call<number>("bench_import", { files: importPaths.split(",").map((s) => s.trim()).filter(Boolean) })
                    .then((n) => {
                      toast.success(`${n} runs imported`);
                      refreshHist();
                    })
                    .catch((e) => toast.error(e.message))
                }
              >
                Import
              </button>
            </div>
          </Panel>
        </div>
        <Panel title="TC calculator">
          <div className="flex flex-col gap-2.5">
            <Field label="CCRL nominal time control">
              <select className="select" value={nominal} onChange={(e) => setNominal(e.target.value)}>
                {(presets ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Factor f" hint="click a result row to use its factor">
              <input className="input tnum" type="number" step={0.0001} value={factor} onChange={(e) => setFactor(+e.target.value)} data-testid="tc-factor" />
            </Field>
            <Field label="Base formula" hint="B = nominal base (s), I = increment (s), M = moves, f = factor">
              <input className="input mono" value={bf} onChange={(e) => setBf(e.target.value)} />
            </Field>
            <Field label="Increment formula" hint="integral increment: some engines mishandle fractions">
              <input className="input mono" value={inf} onChange={(e) => setInf(e.target.value)} />
            </Field>
            <ErrorBox error={tcErr} />
            {tc && (
              <div className="panel p-3 flex flex-col items-center gap-1" style={{ background: "var(--bg-2)" }}>
                <div className="kpi-label">Local TC for fastchess</div>
                <div className="font-semibold mono" style={{ fontSize: 28, lineHeight: 1.2 }} data-testid="tc-result">
                  {tc.fastchess}
                </div>
                <div className="muted">{tc.human}</div>
              </div>
            )}
            <button className="btn" onClick={saveFormulas}>
              <Save size={13} /> Save formulas &amp; factor as defaults
            </button>
            <div className="muted text-[11.5px] flex gap-1.5">
              <Calculator size={13} className="shrink-0 mt-0.5" /> Reference: Blitz 2'+1" at f≈0.86 → 103+1; 40/15 as 15'+10" at f≈1.878 → 1690+19.
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
