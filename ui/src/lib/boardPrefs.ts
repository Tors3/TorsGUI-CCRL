import { useSyncExternalStore } from "react";
import type { UserPieceSet } from "../bindings/UserPieceSet";
import { BUNDLED_PIECE_SETS } from "./pieceSets";
import { playEvent, playSan, preloadSounds, SOUND_SETS, type SoundEvent, type SoundSet } from "./sound";

/** Board appearance: a per-viewer preference kept in localStorage. */
export type BoardPrefs = {
  theme: BoardTheme;
  pieces: PieceSet;
  /** Piece animation in ms (0 = off). */
  animation: number;
  coordinates: boolean;
  /** Move and game sounds (viewer, live board, play vs engine). */
  sound: boolean;
  soundSet: SoundSet;
  /** 0..1 */
  soundVolume: number;
  /** Best-move arrows from the engines' PV. */
  arrows: boolean;
  /** Square colours of the "custom" theme. */
  customLight: string;
  customDark: string;
};

export const BOARD_THEMES = ["minimal", "slate", "ocean", "tournament", "classic", "walnut", "maple", "szots", "marble", "custom"] as const;
export type BoardTheme = (typeof BOARD_THEMES)[number];
export const THEME_LABEL: Record<BoardTheme, string> = {
  minimal: "Minimal",
  custom: "Custom",
  walnut: "Walnut",
  maple: "Maple",
  szots: "Szőts wood (for Gabor)",
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
  soundSet: "wood",
  soundVolume: 0.8,
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
      if (!SOUND_SETS.includes(p.soundSet)) p.soundSet = DEFAULT_PREFS.soundSet;
      if (!(p.soundVolume >= 0 && p.soundVolume <= 1)) p.soundVolume = DEFAULT_PREFS.soundVolume;
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

/** The sound of a SAN move with the current preferences (nothing when sound is off). */
export function playMoveSound(san: string | null | undefined) {
  if (current.sound) playSan(san, current.soundSet, current.soundVolume);
}

/** A game sound (game end, low time) with the current preferences. */
export function playGameSound(ev: SoundEvent) {
  if (current.sound) playEvent(ev, current.soundSet, current.soundVolume);
}

/** Loads the files of the chosen set once sound is on. */
export function preloadBoardSounds() {
  if (current.sound) preloadSounds(current.soundSet);
}
