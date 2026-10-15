import { useEffect, useMemo, useState } from "react";
import type { LanePlan } from "../bindings/LanePlan";
import type { Gpu } from "../bindings/Gpu";
import type { Placement } from "../bindings/Placement";
import type { Topology } from "../bindings/Topology";
import type { WizardPreview } from "../bindings/WizardPreview";
import { useT } from "../i18n";
import { call } from "../lib/api";
import { cpuMap, gameColor, suggestedLanes, type Cell, type NodeMap } from "../lib/cores";
import { Choices, Field, Panel, Spinner } from "./ui";

/** What the panel edits in the tournament's configuration. */
export type CoresValue = { nodes: number[]; lanes: number; placement: Placement; smt: boolean; gpus: number[] };

/**
 * New tournament → Cores & games: which CPUs the engines may use (physical cores or every
 * hardware thread), the NUMA nodes (only on machines that have several), how many games
 * run at the same time and how they are placed, with the arithmetic spelled out and a map
 * of the CPUs.
 */
export function CoresPanel(props: {
  topo?: Topology;
  value: CoresValue;
  onChange: (v: Partial<CoresValue>) => void;
  /** Threads of the two engines of the heaviest game. */
  pair: [number, number];
  preview?: WizardPreview;
  /** The graphics cards of the machine, and the chosen GPU engines (none: no card section). */
  cards?: Gpu[];
  gpuEngines?: string[];
}) {
  const t = useT();
  const { topo, value, onChange, pair, preview, cards, gpuEngines = [] } = props;
  const { nodes, lanes, placement, smt, gpus } = value;
  const laneCpus = Math.max(2, pair[0] + pair[1]);
  const [plans, setPlans] = useState<LanePlan[]>([]);

  const planKey = JSON.stringify([nodes, lanes, laneCpus, placement, smt]);
  useEffect(() => {
    if (!nodes.length) return setPlans([]);
    let live = true;
    call<LanePlan[]>("lane_plan", { nodes, lanes, threads: 1, cores_per_lane: laneCpus, placement, smt })
      .then((p) => live && setPlans(p))
      .catch(() => live && setPlans([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  const maps = useMemo(() => (topo ? cpuMap(topo, nodes, smt, placement, plans) : []), [topo, nodes, smt, placement, plans]);
  if (!topo) return <Panel title={t("cores.title")}><Spinner /></Panel>;

  const multiNode = topo.nodes.length > 1;
  const unit = (count: number) => t(smt ? "cores.unit.threads" : "cores.unit.cores", { count });
  const cpuSuggested = suggestedLanes(topo, nodes[0] ?? 0, laneCpus, smt);
  // GPU engines: one game per card at a time
  const gpuLanes = Math.max(1, Math.floor(Math.max(1, gpus.length) / Math.max(1, nodes.length)));
  const suggested = gpuEngines.length ? Math.min(cpuSuggested, gpuLanes) : cpuSuggested;
  const nodeBudget = smt ? (topo.nodes.find((n) => n.id === (nodes[0] ?? 0))?.logical_cpus ?? 0) : (topo.nodes.find((n) => n.id === (nodes[0] ?? 0))?.physical_cores ?? 0);
  const busy = preview?.busy_threads ?? 0;
  const budget = preview?.cpu_budget ?? 0;
  const over = budget > 0 && busy > budget;

  return (
    <Panel title={t("cores.title")}>
      <div className="flex flex-col gap-4" data-testid="cores-panel">
        <div className="muted text-[12px]" data-testid="cores-machine">
          {t(multiNode ? "cores.machineNodes" : "cores.machine", { cpu: topo.cpu_model, cores: topo.physical_cores, threads: topo.logical_cpus, nodes: topo.nodes.length })}
        </div>

        <Field label={t("cores.pool.label")}>
          <Choices
            name="cpu-pool"
            value={smt ? "smt" : "physical"}
            onChange={(v) => onChange({ smt: v === "smt" })}
            options={[
              { value: "physical", label: t("cores.pool.physical"), about: t("cores.pool.physicalAbout"), badge: "CCRL" },
              { value: "smt", label: t("cores.pool.smt"), about: topo.smt ? t("cores.pool.smtAbout") : t("cores.pool.noSmt"), disabled: !topo.smt },
            ]}
          />
        </Field>

        {multiNode && (
          <Field label={t("cores.nodes.label")} hint={t("cores.nodes.about", { count: topo.nodes.length })}>
            <div className="flex gap-3 flex-wrap">
              {topo.nodes.map((n) => (
                <label key={n.id} className="flex items-center gap-1.5 text-[12.5px]">
                  <input type="checkbox" checked={nodes.includes(n.id)} onChange={() => onChange({ nodes: nodes.includes(n.id) ? nodes.filter((x) => x !== n.id) : [...nodes, n.id].sort((a, b) => a - b) })} />
                  {t("cores.nodes.node", { id: n.id })} <span className="muted">({t("cores.nodes.nodeCpus", { n: smt ? n.logical_cpus : n.physical_cores })})</span>
                </label>
              ))}
            </div>
          </Field>
        )}

        <Field
          label={t(multiNode ? "cores.games.labelPerNode" : "cores.games.label")}
          hint={pair[0] === pair[1] ? t("cores.games.needSame", { threads: laneCpus, each: pair[0], eachUnit: t("cores.unit.threads", { count: pair[0] }) }) : t("cores.games.need", { threads: laneCpus, a: pair[0], b: pair[1] })}
        >
          <div className="flex items-center gap-2">
            <input className="input tnum" style={{ width: 90 }} type="number" min={1} value={lanes} onChange={(e) => onChange({ lanes: Math.max(1, +e.target.value) })} data-testid="cores-lanes" />
            {suggested !== lanes && (
              <button type="button" className="btn btn-sm" onClick={() => onChange({ lanes: suggested })} title={t("cores.games.suggestedTip", { budget: nodeBudget, unit: unit(nodeBudget), threads: laneCpus })} data-testid="cores-use-suggested">
                {t("cores.games.useSuggested", { n: suggested })}
              </button>
            )}
          </div>
        </Field>

        {gpuEngines.length > 0 && (
          <Field label={t("cores.gpu.label")} hint={t("cores.gpu.about", { list: gpuEngines.join(", ") })}>
            <div className="flex flex-col gap-1.5 text-[12.5px]" data-testid="cores-gpus">
              {!cards ? (
                <Spinner size={12} />
              ) : cards.length === 0 ? (
                <span style={{ color: "var(--warn)" }}>{t("cores.gpu.noCards")}</span>
              ) : (
                cards.map((c) => (
                  <label key={c.index} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={gpus.includes(c.index)}
                      onChange={() => onChange({ gpus: gpus.includes(c.index) ? gpus.filter((x) => x !== c.index) : [...gpus, c.index].sort((a, b) => a - b) })}
                      data-testid={`cores-gpu-${c.index}`}
                    />
                    {t("cores.gpu.card", { n: c.index })} · <span className="font-medium">{c.name}</span>
                    {c.memory_mb > 0 && <span className="muted tnum">({(c.memory_mb / 1024).toFixed(c.memory_mb >= 10240 ? 0 : 1)} GB)</span>}
                  </label>
                ))
              )}
              {lanes * Math.max(1, nodes.length) > Math.max(1, gpus.length) && cards && cards.length > 0 && (
                <span style={{ color: "var(--warn)" }} data-testid="cores-gpu-shared">
                  {t("cores.gpu.shared", { games: lanes * Math.max(1, nodes.length), cards: Math.max(1, gpus.length) })}
                  {nodes.length > Math.max(1, gpus.length) && <> {t("cores.gpu.sharedNodes", { cards: Math.max(1, gpus.length) })}</>}
                </span>
              )}
            </div>
          </Field>
        )}

        <Field label={t("cores.placement.label")}>
          <Choices
            name="placement"
            value={placement}
            onChange={(v) => onChange({ placement: v })}
            options={[
              { value: "node", label: t(multiNode ? "cores.placement.nodeNuma" : "cores.placement.node"), about: t(multiNode ? "cores.placement.nodeNumaAbout" : "cores.placement.nodeAbout"), badge: multiNode ? "NUMA" : undefined },
              { value: "lane", label: t("cores.placement.lane"), about: t(multiNode ? "cores.placement.laneNumaAbout" : "cores.placement.laneAbout"), badge: multiNode ? "NUMA" : undefined },
              { value: "none", label: t("cores.placement.none"), about: t(multiNode ? "cores.placement.noneNumaAbout" : "cores.placement.noneAbout") },
            ]}
          />
        </Field>

        {preview && (
          <div className="flex flex-col gap-1.5 p-3 rounded-md text-[12.5px]" style={{ background: over ? "var(--loss-bg)" : "var(--bg-2)", border: `1px solid ${over ? "var(--loss)" : "var(--border)"}` }} data-testid="cores-sum">
            <div className="label">{t("cores.sum.title")}</div>
            <div className="tnum font-medium">
              {(() => {
                const each = preview.concurrent_games ? Math.round(busy / preview.concurrent_games) : 0;
                return t("cores.sum.line", { games: preview.concurrent_games, threads: each, threadsUnit: t("cores.unit.threads", { count: each }), busy, budget, unit: unit(budget) });
              })()}
            </div>
            <div className="muted">{t("cores.sum.ponder")}</div>
            <div style={{ color: over ? "var(--loss)" : "var(--win)" }}>{over ? t("cores.sum.over", { over: busy - budget, unit: unit(busy - budget) }) : t("cores.sum.ok", { unit: unit(2) })}</div>
            {smt && !over && busy > preview.physical_cores && <div style={{ color: "var(--warn)" }}>{t("cores.sum.smtShare")}</div>}
          </div>
        )}

        <CpuMap maps={maps} smt={smt} placement={placement} over={over} lanes={lanes} laneCpus={laneCpus} multiNode={multiNode} />
      </div>
    </Panel>
  );
}

function CpuMap(props: { maps: NodeMap[]; smt: boolean; placement: Placement; over: boolean; lanes: number; laneCpus: number; multiNode: boolean }) {
  const t = useT();
  const { maps, smt, placement, over, lanes, laneCpus, multiNode } = props;
  const cellStyle = (c: Cell) => (c.state === "game" ? { background: gameColor(c.lane ?? 0) } : undefined);
  const gamesShown = placement === "lane" ? Math.min(lanes, Math.max(0, ...maps.map((m) => m.fit))) : 0;
  return (
    <div className="flex flex-col gap-2" data-testid="cpu-map">
      <div className="label">{t("cores.map.title")}</div>
      {maps.map((m) => (
        <div key={m.node} className="flex flex-col gap-1">
          {multiNode && <div className="muted text-[11.5px]">{t("cores.nodes.node", { id: m.node })}</div>}
          <div className={`cpu-map ${over ? "cpu-over" : ""}`}>
            {m.cores.map((core) => (
              <div key={core.core} className="cpu-core" title={t("cores.map.core", { n: core.core })}>
                {core.cells.map((c) => (
                  <span key={c.id} className={`cpu-cell cpu-${c.state}`} style={cellStyle(c)} title={`CPU ${c.id}`} />
                ))}
              </div>
            ))}
          </div>
          {placement === "lane" && m.fit < lanes && <div className="text-[11.5px]" style={{ color: "var(--warn)" }}>{t("cores.map.tooShort", { games: lanes, threads: laneCpus, fit: m.fit })}</div>}
        </div>
      ))}
      <div className="cpu-legend">
        {placement === "none" ? (
          <span>
            <span className="cpu-cell cpu-os" />
            {t("cores.map.legendOs")}
          </span>
        ) : placement === "node" ? (
          <span>
            <span className="cpu-cell cpu-shared" />
            {t("cores.map.legendShared")}
          </span>
        ) : (
          <>
            {Array.from({ length: Math.min(gamesShown, 8) }, (_, i) => (
              <span key={i}>
                <span className="cpu-cell" style={{ background: gameColor(i) }} />
                {t("cores.map.legendGame", { n: i + 1 })}
              </span>
            ))}
            {gamesShown > 8 && <span>{t("cores.map.legendMore", { count: gamesShown * maps.length })}</span>}
            <span>
              <span className="cpu-cell cpu-free" />
              {t("cores.map.legendFree")}
            </span>
          </>
        )}
        {!smt && placement !== "none" && (
          <span>
            <span className="cpu-cell cpu-off" />
            {t("cores.map.legendOff")}
          </span>
        )}
      </div>
      {placement === "none" &&
        (multiNode ? (
          <div className="text-[12px] p-2 rounded" style={{ color: "var(--loss)", background: "var(--loss-bg)" }} data-testid="cores-none-numa">
            {t("cores.map.noneNuma", { count: maps.length })}
          </div>
        ) : (
          <div className="muted text-[11.5px]">{t("cores.map.noneNote")}</div>
        ))}
    </div>
  );
}
