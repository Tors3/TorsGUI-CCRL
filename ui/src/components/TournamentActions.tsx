import { ListPlus, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import type { TournamentSummary } from "../bindings/TournamentSummary";
import { call } from "../lib/api";
import { Tip } from "./ui";

/** Start / pause / stop / queue buttons with the state rules of the runner. */
export function TournamentActions({ t, onDone, compact }: { t: TournamentSummary; onDone?: () => void; compact?: boolean }) {
  const r = t.record;
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
  const canStart = !r.imported && !running && r.state !== "completed";
  const size = compact ? "btn-sm" : "";
  return (
    <div className="flex items-center gap-1.5">
      {canStart && (
        <Tip content={r.state === "draft" || r.state === "queued" ? "Start now in a detached runner" : "Resume where it stopped (games in progress when it stopped are replayed)"}>
          <button className={`btn btn-primary ${size}`} onClick={() => act("tournament_start", `${r.name}: runner launched`)} data-testid="btn-start">
            <Play size={13} /> {r.state === "draft" || r.state === "queued" ? "Start" : "Resume"}
          </button>
        </Tip>
      )}
      {running && (
        <>
          <Tip content="Pause: the games in progress are played to the end, then the tournament pauses. Resume continues it. The queue does not advance.">
            <button className={`btn ${size}`} onClick={() => act("tournament_pause", `Pausing ${r.name}: the games in progress finish first…`)}>
              <Pause size={13} /> Pause
            </button>
          </Tip>
          <Tip content="Stop: right now. The games in progress are interrupted and replayed later (never counted twice). Resume continues it. The queue does not advance.">
            <button className={`btn btn-danger ${size}`} onClick={() => act("tournament_stop", `Stopping ${r.name}…`)}>
              <Square size={12} /> Stop
            </button>
          </Tip>
        </>
      )}
      {!r.imported && (r.state === "draft" || r.state === "paused" || r.state === "stopped") && (
        <Tip content="Add to the queue: it starts automatically when the previous tournament has all its games and finished cleanly.">
          <button className={`btn ${size}`} onClick={() => act("queue_add", `${r.name} queued`)}>
            <ListPlus size={13} /> Queue
          </button>
        </Tip>
      )}
    </div>
  );
}
