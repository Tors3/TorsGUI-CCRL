import { useMemo } from "react";
import type { Topology } from "../bindings/Topology";
import type { TournamentRecord } from "../bindings/TournamentRecord";
import type { TournamentSummary } from "../bindings/TournamentSummary";
import { useT } from "../i18n";
import { usePoll } from "../lib/api";
import { gameShade, loadMap, type LoadCell, type LoadItem } from "../lib/cores";
import { coresPerLane } from "../lib/cpu";

/** A tournament's games on the map, from its configuration. */
export function loadItem(r: TournamentRecord): LoadItem {
  const c = r.config;
  return { key: r.id, name: r.name, nodes: c.nodes.length ? c.nodes : [0], lanes: Math.max(1, c.lanes_per_node), laneCpus: coresPerLane(c.kind, c.participants, c.threads), smt: !!c.use_smt, placement: c.placement };
}

/** The tournaments whose games are running now (their runner is alive), but `except`. */
export function useRunningItems(except?: string): LoadItem[] {
  const { data } = usePoll<TournamentSummary[]>("tournaments_list", {}, 5000);
  return (data ?? []).filter((t) => t.record.state === "running" && t.runner_alive && t.record.id !== except).map((t) => loadItem(t.record));
}

/**
 * The CPUs of the machine, socket by socket, each core with its hardware threads: every
 * tournament in its own colour, its games in shades of it. `focus` (an index of `items`) is the
 * tournament being set up: the others are drawn fainter.
 */
export function LoadMap({ topo, items, focus }: { topo: Topology; items: LoadItem[]; focus?: number }) {
  const t = useT();
  const nodes = useMemo(() => loadMap(topo, items), [topo, items]);
  const multi = topo.nodes.length > 1;
  const color = (c: LoadCell) => (c.item == null ? undefined : gameShade(c.item, c.game ?? 1));
  const title = (c: LoadCell, core: number, k: number) => {
    const where = t("cores.load.thread", { core, k: k + 1 });
    return c.item == null ? `${where} · ${t("cores.load.free")}` : `${where} · ${t("cores.load.game", { name: items[c.item].name, n: c.game ?? 1 })}`;
  };
  return (
    <div className="flex flex-col gap-2" data-testid="load-map">
      {nodes.map((n) => {
        const cells = n.cores.flatMap((c) => c.cells);
        const used = cells.filter((c) => c.item != null).length;
        const missing = n.over.reduce((s, o) => s + o.cpus, 0);
        return (
          <div key={n.node} className="flex flex-col gap-1" data-testid={`load-node-${n.node}`}>
            <div className="flex justify-between text-[11.5px]">
              <span className="font-medium">{multi ? t("cores.load.socket", { id: n.node }) : t("cores.map.title")}</span>
              <span className="muted tnum">{t("cores.load.inUse", { used, total: cells.length })}</span>
            </div>
            <div className={`cpu-map ${missing ? "cpu-over" : ""}`}>
              {n.cores.map((core) => (
                <div key={core.core} className="cpu-core">
                  {core.cells.map((c, k) => (
                    <span
                      key={c.id}
                      className={`cpu-cell ${c.item == null ? "cpu-free" : ""}`}
                      style={{ background: color(c), opacity: c.item != null && focus != null && c.item !== focus ? 0.5 : undefined }}
                      title={title(c, core.core, k)}
                      data-item={c.item ?? ""}
                    />
                  ))}
                </div>
              ))}
              {Array.from({ length: Math.min(missing, 40) }, (_, i) => (
                <span key={`x${i}`} className="cpu-cell" style={{ background: "var(--loss)" }} />
              ))}
            </div>
            {missing > 0 && (
              <div className="text-[11.5px]" style={{ color: "var(--loss)" }} data-testid="load-over">
                {t("cores.load.over", { cpus: missing })}
              </div>
            )}
          </div>
        );
      })}
      <div className="cpu-legend">
        {items.map((it, i) => (
          <span key={it.key} style={{ opacity: focus != null && i !== focus ? 0.7 : undefined }}>
            {Array.from({ length: Math.min(4, it.lanes * it.nodes.length) }, (_, g) => (
              <span key={g} className="cpu-cell" style={{ background: gameShade(i, g + 1), marginRight: g < 3 ? 1 : 5 }} />
            ))}
            {t("cores.load.liveItem", { name: it.name, games: it.lanes * it.nodes.length, cpus: it.laneCpus })}
          </span>
        ))}
        <span>
          <span className="cpu-cell cpu-free" />
          {t("cores.load.free")}
        </span>
      </div>
      <div className="muted text-[11.5px]">{t("cores.load.shareNote")}</div>
    </div>
  );
}
