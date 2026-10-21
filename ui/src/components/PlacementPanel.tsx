import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Topology } from "../bindings/Topology";
import type { TournamentDetail } from "../bindings/TournamentDetail";
import { useT } from "../i18n";
import { call, usePoll } from "../lib/api";
import { LoadMap, loadItem, useRunningItems } from "./LoadMap";
import { Field, Panel, Spinner } from "./ui";

/**
 * Tournament → Configuration → Placement: the sockets the games run on, Hyper-Threading and
 * how many games at once, with the map of the CPUs (the other running tournaments in grey).
 * The opening blocks stay as they are, so the games played keep their place: with fewer
 * sockets than blocks, a socket takes several blocks.
 */
export function PlacementPanel({ d, refresh }: { d: TournamentDetail; refresh: () => void }) {
  const t = useT();
  const r = d.summary.record;
  const c = r.config;
  const { data: topo } = usePoll<Topology>("topology", {}, 0);
  const others = useRunningItems(r.id);
  const blocks = Math.max(1, c.nodes.length);
  const [sockets, setSockets] = useState<number[]>(() => [...new Set(c.nodes)].sort((a, b) => a - b));
  const [smt, setSmt] = useState(!!c.use_smt);
  const [games, setGames] = useState(c.lanes_per_node * blocks);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSockets([...new Set(c.nodes)].sort((a, b) => a - b));
    setSmt(!!c.use_smt);
    setGames(c.lanes_per_node * blocks);
    // the saved configuration, when it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify([c.nodes, c.use_smt, c.lanes_per_node])]);
  if (!topo) return <Panel title={t("detail.placement.title")}><Spinner /></Panel>;

  const running = r.state === "running" && d.summary.runner_alive;
  // each opening block on a socket, in turn: [0, 1] with both, [1, 1] with socket 1 only
  const nodes = sockets.length ? Array.from({ length: blocks }, (_, i) => sockets[i % sockets.length]) : [];
  const lanes = Math.max(1, Math.round(games / blocks));
  const draft = { ...loadItem(r), nodes, lanes, smt };
  const items = [...others, draft];
  const changed = JSON.stringify(nodes) !== JSON.stringify(c.nodes) || lanes !== c.lanes_per_node || smt !== !!c.use_smt;
  const save = async () => {
    setBusy(true);
    try {
      await call("tournament_update", { id: r.id, config: { ...c, nodes, lanes_per_node: lanes, use_smt: smt } });
      toast.success(t("detail.placement.saved", { games: lanes * blocks }));
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={t("detail.placement.title")}>
      <div className="flex flex-col gap-3" data-testid="placement-panel">
        <p className="muted text-[12px]">{t("detail.placement.about")}</p>
        {topo.nodes.length > 1 && (
          <Field label={t("detail.placement.nodes")} hint={blocks === 1 ? t("detail.placement.oneBlock") : undefined}>
            <div className="flex gap-3 flex-wrap">
              {topo.nodes.map((n) => (
                <label key={n.id} className="flex items-center gap-1.5 text-[12.5px]">
                  {blocks > 1 ? (
                    <input type="checkbox" checked={sockets.includes(n.id)} onChange={() => setSockets(sockets.includes(n.id) ? sockets.filter((x) => x !== n.id) : [...sockets, n.id].sort((a, b) => a - b))} data-testid={`placement-node-${n.id}`} />
                  ) : (
                    // one opening block: one socket
                    <input type="radio" name="placement-node" checked={sockets.includes(n.id)} onChange={() => setSockets([n.id])} data-testid={`placement-node-${n.id}`} />
                  )}
                  {t("cores.load.socket", { id: n.id })} <span className="muted">({t("cores.nodes.nodeCpus", { n: smt ? n.logical_cpus : n.physical_cores })})</span>
                </label>
              ))}
            </div>
          </Field>
        )}
        {topo.smt && (
          <label className="flex items-center gap-1.5 text-[12.5px]">
            <input type="checkbox" checked={smt} onChange={(e) => setSmt(e.target.checked)} data-testid="placement-smt" /> {t("detail.placement.smt")}
          </label>
        )}
        <Field label={t("detail.placement.games")} hint={blocks > 1 ? t("detail.placement.gamesHint", { count: blocks }) : undefined}>
          <div className="flex items-center gap-2">
            <input type="range" min={blocks} max={blocks * 20} step={blocks} value={lanes * blocks} onChange={(e) => setGames(+e.target.value)} style={{ flex: 1 }} data-testid="placement-games-range" />
            <input className="input tnum" style={{ width: 72 }} type="number" min={blocks} step={blocks} value={lanes * blocks} onChange={(e) => setGames(Math.max(blocks, +e.target.value))} data-testid="placement-games" />
          </div>
        </Field>
        <LoadMap topo={topo} items={items} focus={items.length - 1} />
        <div className="text-[12.5px] tnum" data-testid="placement-sum">
          {t("detail.placement.sum", { games: lanes * blocks, cpus: lanes * blocks * draft.laneCpus, busy: lanes * blocks * Math.max(1, Math.round(draft.laneCpus / 2)) })}
        </div>
        {!sockets.length && <div className="text-[12px]" style={{ color: "var(--loss)" }}>{t("detail.placement.noNode")}</div>}
        {running && <div className="text-[12px]" style={{ color: "var(--warn)" }}>{t("detail.placement.running")}</div>}
        <div className="flex justify-end">
          <button className="btn btn-primary" disabled={!changed || running || busy || !sockets.length || r.imported} onClick={save} data-testid="placement-save">
            {busy ? <Spinner size={12} /> : null} {t("detail.placement.save")}
          </button>
        </div>
      </div>
    </Panel>
  );
}
