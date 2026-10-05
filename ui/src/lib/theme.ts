import { useSyncExternalStore } from "react";

/** Colour themes of the app (the board has its own themes in Settings → Board appearance). */
export const THEMES = [
  { id: "system", label: "System", scheme: "auto", about: "Dark or Light, following the operating system" },
  { id: "paper", label: "Paper", scheme: "light", about: "The default: sober and warm, off-white paper with an ink-blue accent" },
  { id: "dark", label: "Dark", scheme: "dark", about: "Dark blue-grey with a blue accent" },
  { id: "light", label: "Light", scheme: "light", about: "Bright, for daylight" },
  { id: "graphite", label: "Graphite", scheme: "dark", about: "Sober: neutral greys, a quiet steel accent" },
  { id: "nord", label: "Nord", scheme: "dark", about: "Cool arctic blues (Nord palette)" },
  { id: "midnight", label: "Midnight", scheme: "dark", about: "Pure black, for OLED screens and dark rooms" },
  { id: "forest", label: "Forest", scheme: "dark", about: "Dark green, easy on the eyes for long sessions" },
  { id: "coffee", label: "Coffee", scheme: "dark", about: "Espresso browns, crema text and a caramel accent" },
  { id: "contrast", label: "High contrast", scheme: "dark", about: "Black and white with strong borders" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];

const KEY = "torsgui-theme";
const KEY_CHOSEN = "torsgui-theme-chosen";
export const DEFAULT_THEME: ThemeId = "paper";
const listeners = new Set<() => void>();

function read(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    // before 0.5.2 "dark" was stored on every start without being chosen: only a theme picked
    // in the new picker (marked by KEY_CHOSEN) overrides the default
    const chosen = localStorage.getItem(KEY_CHOSEN) === "1";
    if (v && THEMES.some((t) => t.id === v) && (chosen || v !== "dark")) return v as ThemeId;
  } catch {
    /* private mode */
  }
  return DEFAULT_THEME;
}

let current: ThemeId = read();

const prefersLight = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: light)").matches;

/** The palette actually shown ("system" resolved). */
export function resolvedTheme(id: ThemeId = current): Exclude<ThemeId, "system"> {
  return id === "system" ? (prefersLight() ? "light" : "dark") : id;
}

/** "dark" or "light", for the toasts and the native controls. */
export function themeScheme(id: ThemeId = current): "dark" | "light" {
  const t = THEMES.find((x) => x.id === resolvedTheme(id));
  return t?.scheme === "light" ? "light" : "dark";
}

export function applyTheme(id: ThemeId = current) {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = resolvedTheme(id);
}

export function setTheme(id: ThemeId) {
  current = id;
  try {
    localStorage.setItem(KEY, id);
    localStorage.setItem(KEY_CHOSEN, "1");
  } catch {
    /* private mode */
  }
  applyTheme(id);
  listeners.forEach((l) => l());
}

/** Next theme for the `t` shortcut: cycles through the fixed palettes. */
export function cycleTheme() {
  const ids = THEMES.map((t) => t.id).filter((x) => x !== "system");
  const i = ids.indexOf(resolvedTheme() as (typeof ids)[number]);
  setTheme(ids[(i + 1) % ids.length]);
}

if (typeof window !== "undefined") {
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => {
    if (current === "system") {
      applyTheme();
      listeners.forEach((l) => l());
    }
  });
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return { theme, scheme: themeScheme(theme), setTheme, cycle: cycleTheme };
}
