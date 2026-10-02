import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo } from "react";
import type { EngineEntry } from "../bindings/EngineEntry";
import type { EngineListRating } from "../bindings/EngineListRating";
import { usePoll } from "../lib/api";
import { num } from "../lib/format";
import { Tip } from "./ui";

export const RATING_LISTS = ["Blitz", "40/15", "FRC"] as const;
export type RatingList = (typeof RATING_LISTS)[number];
export type EngineRatings = Map<number, Partial<Record<RatingList, EngineListRating>>>;

/** CCRL ratings of the library engines (Blitz, 40/15, FRC), from the stored CCRL lists. */
export function useEngineRatings() {
  const { data, refresh } = usePoll<{ ratings: EngineListRating[]; fetched_at: string }>("engines_ccrl", {}, 0);
  const map = useMemo(() => {
    const m: EngineRatings = new Map();
    for (const r of data?.ratings ?? []) m.set(r.engine_id, { ...m.get(r.engine_id), [r.list]: r });
    return m;
  }, [data]);
  return { ratings: map, fetchedAt: data?.fetched_at ?? "", refresh };
}

/** Search over name, engine, author, build and UCI id; every word must match. */
export function matchesEngine(e: EngineEntry, q: string) {
  const hay = `${e.display_name} ${e.engine} ${e.version} ${e.author} ${e.build} ${e.uci_id}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** Rating with rank, CPU category and games in the tooltip; "≈" when this version is not in the list. */
export function EloCell({ r }: { r?: EngineListRating }) {
  if (!r) return <span className="muted">—</span>;
  return (
    <Tip
      content={
        r.exact
          ? `${r.ccrl_name} · rank ${r.rank}${r.games != null ? ` · ${r.games} games` : ""}`
          : `This version is not in the list: ${r.ccrl_name} (rank ${r.rank}) is the latest version listed`
      }
    >
      <span className={`tnum ${r.exact ? "" : "muted"}`}>
        {r.exact ? "" : "≈"}
        {num(r.rating)}
        {r.cpus > 1 && <span className="chip ml-1">{r.cpus}CPU</span>}
      </span>
    </Tip>
  );
}

export type SortDir = "asc" | "desc";

/** Column header that sorts the table; a second click reverses the order. */
export function SortTh<K extends string>({ k, sort, setSort, children, right, first = "desc" }: { k: K; sort: [K, SortDir]; setSort: (s: [K, SortDir]) => void; children: React.ReactNode; right?: boolean; first?: SortDir }) {
  const on = sort[0] === k;
  return (
    <th className={right ? "r" : undefined}>
      <button className="inline-flex items-center gap-1 hover:underline" onClick={() => setSort([k, on ? (sort[1] === "asc" ? "desc" : "asc") : first])} data-testid={`sort-${k}`}>
        {children}
        {on && (sort[1] === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

/** Numbers with the missing ones always last, whatever the direction. */
export function cmpNum(a: number | null | undefined, b: number | null | undefined, dir: SortDir) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "asc" ? a - b : b - a;
}
