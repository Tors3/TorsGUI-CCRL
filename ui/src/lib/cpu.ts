import type { Participant } from "../bindings/Participant";
import type { TournamentKind } from "../bindings/TournamentKind";

type P = Pick<Participant, "role" | "threads">;

/** Threads of a participant: its own, else the tournament's (mirrors `model::threads_of`). */
export const threadsOf = (p: { threads?: number | null }, threads: number) => Math.max(1, p.threads ?? threads);

const uniq = (v: number[]) => [...new Set(v)].sort((a, b) => a - b);
const join = (v: number[]) => v.map((t) => `${t}CPU`).join("/");

/** "8CPU", or "8CPU vs 1CPU" when the seeds and the opponents differ (mirrors `model::cpu_label`). */
export function cpuLabel(participants: P[], threads: number): string {
  if (participants.every((p) => threadsOf(p, threads) === threads)) return `${threads}CPU`;
  const seeds = uniq(participants.filter((p) => p.role === "seed").map((p) => threadsOf(p, threads)));
  const opps = uniq(participants.filter((p) => p.role === "opponent").map((p) => threadsOf(p, threads)));
  if (!seeds.length || !opps.length) return join(uniq([...seeds, ...opps]));
  return `${join(seeds)} vs ${join(opps)}`;
}

/** Physical cores one lane needs: the two engines of the heaviest pairing (mirrors `model::cores_per_lane`). */
export function coresPerLane(kind: TournamentKind, participants: P[], threads: number): number {
  const t = (p: P) => threadsOf(p, threads);
  const gauntlet = kind === "gauntlet" || kind === "multi_gauntlet";
  const seeds = participants.filter((p) => p.role === "seed").map(t);
  const opps = participants.filter((p) => p.role === "opponent").map(t);
  if (gauntlet && seeds.length && opps.length) return Math.max(2, Math.max(...seeds) + Math.max(...opps));
  const all = participants.map(t).sort((a, b) => b - a);
  if (all.length === 0) return 2 * Math.max(1, threads);
  if (all.length === 1) return 2 * all[0];
  return Math.max(2, all[0] + all[1]);
}
