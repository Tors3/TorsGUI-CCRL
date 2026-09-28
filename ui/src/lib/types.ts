import type { EventRecord } from "../bindings/EventRecord";
import type { Health } from "../bindings/Health";
import type { TimelineItem } from "../bindings/TimelineItem";
import type { TournamentSummary } from "../bindings/TournamentSummary";

export type DashboardData = {
  tournaments: TournamentSummary[];
  timeline: TimelineItem[];
  queue_eta: string | null;
  health: Health;
  events: EventRecord[];
};

export type AppInfo = {
  version: string;
  workspace: string;
  os: string;
  fastchess: string;
  fastchess_found: boolean;
  fastchess_version: string | null;
  fastchess_pinned: string;
  runner: string;
  runner_found: boolean;
  host: string | null;
};
