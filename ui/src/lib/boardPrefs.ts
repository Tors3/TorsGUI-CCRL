import { useSyncExternalStore } from "react";

/** Board appearance: a per-viewer preference kept in localStorage. */
export type BoardPrefs = {
  theme: BoardTheme;
  pieces: PieceSet;
  /** Piece animation in ms (0 = off). */
  animation: number;
  coordinates: boolean;
  /** Move sound in the viewer and the large live board. */
  sound: boolean;
  /** Best-move arrows from the engines' PV. */
  arrows: boolean;
};

export const BOARD_THEMES = ["walnut", "maple", "marble", "tournament", "ocean", "slate", "classic"] as const;
export type BoardTheme = (typeof BOARD_THEMES)[number];
export const THEME_LABEL: Record<BoardTheme, string> = {
  walnut: "Walnut",
  maple: "Maple",
  marble: "Marble",
  tournament: "Tournament green",
  ocean: "Ocean",
  slate: "Slate",
  classic: "Classic brown",
};

/** Piece sets bundled in public/pieces (all GPL-compatible, see public/pieces/README.md). */
export const PIECE_SETS = ["cburnett", "merida", "chessnut", "fantasy", "spatial", "mpchess"] as const;
export type PieceSet = (typeof PIECE_SETS)[number];
export const PIECE_LABEL: Record<PieceSet, string> = {
  cburnett: "Cburnett",
  merida: "Merida",
  chessnut: "Chessnut",
  fantasy: "Fantasy",
  spatial: "Spatial",
  mpchess: "MPChess",
};

export const DEFAULT_PREFS: BoardPrefs = { theme: "walnut", pieces: "merida", animation: 260, coordinates: true, sound: false, arrows: true };

const KEY = "torsgui.board";
let current: BoardPrefs = load();
const listeners = new Set<() => void>();

function load(): BoardPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = { ...DEFAULT_PREFS, ...JSON.parse(raw) } as BoardPrefs;
      if (!BOARD_THEMES.includes(p.theme)) p.theme = DEFAULT_PREFS.theme;
      if (!PIECE_SETS.includes(p.pieces)) p.pieces = DEFAULT_PREFS.pieces;
      return p;
    }
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_PREFS;
}

export function setBoardPrefs(p: Partial<BoardPrefs>) {
  current = { ...current, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

export function useBoardPrefs(): BoardPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** Piece image URL (for material strips and previews). */
export function pieceUrl(set: PieceSet, color: "w" | "b", role: "P" | "N" | "B" | "R" | "Q" | "K") {
  return `/pieces/${set}/${color}${role}.svg`;
}

// ------------------------------------------------------------------ sound

let ctx: AudioContext | null = null;

/** A short wooden "tock" synthesised with WebAudio (no audio files). Captures are lower. */
export function playMove(capture = false) {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    const len = 0.09;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 5);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = capture ? 900 : 1500;
    bp.Q.value = 3.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(capture ? 0.9 : 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t);
  } catch {
    /* audio unavailable */
  }
}
