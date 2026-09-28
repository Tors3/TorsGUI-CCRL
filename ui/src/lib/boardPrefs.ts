import { useSyncExternalStore } from "react";
import type { UserPieceSet } from "../bindings/UserPieceSet";
import { BUNDLED_PIECE_SETS } from "./pieceSets";

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
  /** Square colours of the "custom" theme. */
  customLight: string;
  customDark: string;
};

export const BOARD_THEMES = ["minimal", "slate", "ocean", "tournament", "classic", "walnut", "maple", "marble", "custom"] as const;
export type BoardTheme = (typeof BOARD_THEMES)[number];
export const THEME_LABEL: Record<BoardTheme, string> = {
  minimal: "Minimal",
  custom: "Custom",
  walnut: "Walnut",
  maple: "Maple",
  marble: "Marble",
  tournament: "Tournament green",
  ocean: "Ocean",
  slate: "Slate",
  classic: "Classic brown",
};

/** A bundled set id ("merida", "cburnett_blue") or "user:<name>" for an imported set. */
export type PieceSet = string;
export const PIECE_SETS: PieceSet[] = BUNDLED_PIECE_SETS.map((p) => p.id);
export const PIECE_LABEL: Record<string, string> = Object.fromEntries(BUNDLED_PIECE_SETS.map((p) => [p.id, p.label]));

// ------------------------------------------------------------------ piece CSS

const ROLES: Record<string, string> = { P: "pawn", N: "knight", B: "bishop", R: "rook", Q: "queen", K: "king" };
let userSets: UserPieceSet[] = [];
const cssClass = (set: PieceSet) => `pieces-${set.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
export const piecesClass = cssClass;

/** One stylesheet with the rules of every set (bundled: files; imported: data URIs). */
function injectPieceCss() {
  if (typeof document === "undefined") return;
  const rules: string[] = [];
  const add = (set: PieceSet, url: (c: "w" | "b", r: string) => string) => {
    for (const c of ["w", "b"] as const)
      for (const r of Object.keys(ROLES)) rules.push(`.${cssClass(set)} .cg-wrap piece.${ROLES[r]}.${c === "w" ? "white" : "black"}{background-image:url("${url(c, r)}")}`);
  };
  for (const id of PIECE_SETS) add(id, (c, r) => `/pieces/${id}/${c}${r}.svg`);
  for (const u of userSets) add(`user:${u.name}`, (c, r) => u.pieces[`${c}${r}`]);
  let el = document.getElementById("torsgui-pieces") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "torsgui-pieces";
    document.head.appendChild(el);
  }
  el.textContent = rules.join("\n");
}
injectPieceCss();

export function setUserPieceSets(sets: UserPieceSet[]) {
  userSets = sets;
  injectPieceCss();
  listeners.forEach((l) => l());
}
export const getUserPieceSets = () => userSets;

export const DEFAULT_PREFS: BoardPrefs = {
  theme: "minimal",
  pieces: "cburnett",
  animation: 220,
  coordinates: true,
  sound: false,
  arrows: true,
  customLight: "#e8e8e8",
  customDark: "#9e9e9e",
};

/** Inline square colours for the custom theme (the other themes are pure CSS). */
export function themeStyle(p: BoardPrefs, theme: BoardTheme = p.theme): Record<string, string> | undefined {
  return theme === "custom" ? { "--sq-light": p.customLight, "--sq-dark": p.customDark } : undefined;
}

const KEY = "torsgui.board";
let current: BoardPrefs = load();
const listeners = new Set<() => void>();

function load(): BoardPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = { ...DEFAULT_PREFS, ...JSON.parse(raw) } as BoardPrefs;
      if (!BOARD_THEMES.includes(p.theme)) p.theme = DEFAULT_PREFS.theme;
      if (!PIECE_SETS.includes(p.pieces) && !p.pieces.startsWith("user:")) p.pieces = DEFAULT_PREFS.pieces;
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
  if (set.startsWith("user:")) {
    const u = userSets.find((x) => `user:${x.name}` === set);
    if (u) return u.pieces[`${color}${role}`];
    set = DEFAULT_PREFS.pieces;
  }
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
