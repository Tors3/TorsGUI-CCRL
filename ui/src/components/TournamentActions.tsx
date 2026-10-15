import { ListMinus, ListPlus, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import type { TournamentSummary } from "../bindings/TournamentSummary";
import { call } from "../lib/api";
import { Tip } from "./ui";
import { useT } from "../i18n";

/** Start / pause / stop / queue buttons with the state rules of the runner. */
export function TournamentActions({ t, onDone, compact }: { t: TournamentSummary; onDone?: () => void; compact?: boolean }) {
  const r = t.record;
  const tr = useT();
  const act = async (cmd: string, msg: string) => {
    try {
      await call(cmd, { id: r.id });
      toast.success(msg);
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const running = r.state === "running" && t.runner_alive;
  // a completed cup whose final is tied again (more tiebreaks since 0.7.5) can be resumed
  const canStart = !r.imported && !running && (r.state !== "completed" || t.unfinished);
  const size = compact ? "btn-sm" : "";
  return (
    <div className="flex items-center gap-1.5">
      {canStart && (
        <Tip
          content={
            r.state === "draft" || r.state === "queued"
              ? tr("ui.actions.startTip")
              : t.unfinished
                ? tr("ui.actions.tiebreakTip")
                : tr("ui.actions.resumeTip")
          }
        >
          <button className={`btn btn-primary ${size}`} onClick={() => act("tournament_start", tr("ui.actions.launched", { name: r.name }))} data-testid="btn-start">
            <Play size={13} /> {r.state === "draft" || r.state === "queued" ? tr("ui.actions.start") : tr("ui.actions.resume")}
          </button>
        </Tip>
      )}
      {running && (
        <>
          <Tip content={tr("ui.actions.pauseTip")}>
            <button className={`btn ${size}`} onClick={() => act("tournament_pause", tr("ui.actions.pausing", { name: r.name }))}>
              <Pause size={13} /> {tr("ui.actions.pause")}
            </button>
          </Tip>
          <Tip content={tr("ui.actions.stopTip")}>
            <button className={`btn btn-danger ${size}`} onClick={() => act("tournament_stop", tr("ui.actions.stopping", { name: r.name }))}>
              <Square size={12} /> {tr("ui.actions.stop")}
            </button>
          </Tip>
        </>
      )}
      {!r.imported && (r.state === "draft" || r.state === "paused" || r.state === "stopped") && (
        <Tip content={tr("ui.actions.queueTip")}>
          <button className={`btn ${size}`} onClick={() => act("queue_add", tr("ui.actions.queued", { name: r.name }))}>
            <ListPlus size={13} /> {tr("ui.actions.queue")}
          </button>
        </Tip>
      )}
      {!r.imported && r.state === "queued" && (
        <Tip content={tr("tournament.unqueueTip")}>
          <button className={`btn ${size}`} onClick={() => act("queue_remove", tr("tournament.unqueued", { name: r.name }))} data-testid="btn-unqueue">
            <ListMinus size={13} /> {tr("tournament.unqueue")}
          </button>
        </Tip>
      )}
    </div>
  );
}
