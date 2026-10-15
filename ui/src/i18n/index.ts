import { useSyncExternalStore } from "react";
import { en, type Messages } from "./en";
import { it } from "./it";
import type { IsText, Shape, Text } from "./types";
import type { Msg } from "../bindings/Msg";

export type { Shape, Text } from "./types";

/**
 * Interface languages. English is the source: every text is written there first
 * (`./en/<area>.ts`). A translation (`./it/<area>.ts`) covers whole areas: an area it
 * has must have every key (TypeScript checks it), an area it lacks falls back to English,
 * so a language can be translated one page at a time.
 *
 * Texts: `"{n} games"` takes parameters; `{ one: "…", other: "…" }` picks the plural form
 * of the `count` parameter for the language (Intl.PluralRules).
 */
export const LOCALES = [
  { id: "en", label: "English", dates: "en-GB", messages: en },
  { id: "it", label: "Italiano", dates: "it-IT", messages: it },
] as const satisfies readonly { id: string; label: string; dates: string; messages: Translation }[];
export type LocaleId = (typeof LOCALES)[number]["id"];

/** A language: any whole area of the English texts. */
export type Translation = { [A in keyof Messages]?: Shape<Messages[A]> };

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: IsText<T[K]> extends true ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
/** "area.key" of every English text. */
export type Key = Leaves<Messages>;
export type Params = Record<string, string | number>;

const KEY = "torsgui-locale";
export const DEFAULT_LOCALE: LocaleId = "en";
const listeners = new Set<() => void>();

function initial(): LocaleId {
  try {
    const v = localStorage.getItem(KEY);
    if (v && LOCALES.some((l) => l.id === v)) return v as LocaleId;
  } catch {
    /* private mode */
  }
  return DEFAULT_LOCALE;
}

let current: LocaleId = initial();

export function getLocale(): LocaleId {
  return current;
}

/** The BCP 47 tag for dates and numbers in `locale` (toLocaleString). */
export function dateLocale(locale: LocaleId = current): string {
  return LOCALES.find((l) => l.id === locale)?.dates ?? "en-GB";
}

export function setLocale(id: LocaleId) {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
  if (typeof document !== "undefined") document.documentElement.lang = id;
  listeners.forEach((l) => l());
}

const PLURAL = new Set(["zero", "one", "two", "few", "many", "other"]);

function lookup(tree: unknown, key: string): Text | undefined {
  let v: unknown = tree;
  for (const part of key.split(".")) {
    if (v == null || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  const plural = (o: object) => "other" in o && Object.keys(o).every((k) => PLURAL.has(k));
  return typeof v === "string" || (v != null && typeof v === "object" && plural(v)) ? (v as Text) : undefined;
}

/** The text of `key` in `locale` (English when the language does not have it yet). */
export function translate(locale: LocaleId, key: Key, params: Params = {}): string {
  const messages = LOCALES.find((l) => l.id === locale)?.messages;
  const text = lookup(messages, key) ?? lookup(en, key) ?? key;
  let s: string;
  if (typeof text === "string") s = text;
  else {
    const n = Number(params.count ?? 0);
    s = text[new Intl.PluralRules(locale).select(n)] ?? text.other;
  }
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/**
 * A message from the backend in `locale`: by its code when the language has it (the English
 * texts are generated from the Rust `msg!` calls), else its English text as sent.
 */
export function translateMsg(locale: LocaleId, m: Msg | string): string {
  if (typeof m === "string") return m;
  if (!m.code) return m.text;
  const key = `backend.${m.code}`;
  if (!lookup(en, key)) return m.text;
  return translate(locale, key as Key, m.args);
}

/** `const tm = useMsg()` in a component: backend messages in the current language. */
export function useMsg(): (m: Msg | string) => string {
  const locale = useLocale();
  return (m) => translateMsg(locale, m);
}

/** `t("cores.title")` in the current language, outside React. */
export function t(key: Key, params?: Params): string {
  return translate(current, key, params);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The current language; the component renders again when it changes. */
export function useLocale(): LocaleId {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

/** `const t = useT()` in a component: texts in the current language. */
export function useT(): (key: Key, params?: Params) => string {
  const locale = useLocale();
  return (key, params) => translate(locale, key, params);
}
