import { useSyncExternalStore } from "react";

/** The fonts of the app: modern (Inter / JetBrains Mono) or retro (DotGothic16 / IBM Plex Mono). */
export const FONTS = [
  { id: "modern", label: "Modern", about: "Inter for text, JetBrains Mono for numbers and moves" },
  { id: "retro", label: "Retro", about: "DotGothic16 (dot-matrix, like the old PC screens) for text, IBM Plex Mono for numbers and moves (bundled, OFL)" },
] as const;
export type FontId = (typeof FONTS)[number]["id"];

const KEY = "torsgui-font";
const listeners = new Set<() => void>();

function read(): FontId {
  try {
    const v = localStorage.getItem(KEY);
    if (v && FONTS.some((f) => f.id === v)) return v as FontId;
  } catch {
    /* private mode */
  }
  return "modern";
}

let current: FontId = read();

export function applyFont(id: FontId = current) {
  if (typeof document !== "undefined") document.documentElement.dataset.font = id;
}

export function setFont(id: FontId) {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
  applyFont(id);
  listeners.forEach((l) => l());
}

export function useFont() {
  const font = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return { font, setFont };
}
