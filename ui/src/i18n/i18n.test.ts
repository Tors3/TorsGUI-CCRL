import { afterEach, describe, expect, it } from "vitest";
import { en } from "./en";
import { LOCALES, setLocale, t, translate, translateMsg } from "./index";

describe("languages", () => {
  afterEach(() => setLocale("en"));
  it("fills parameters and plural forms", () => {
    expect(translate("en", "cores.unit.cores", { count: 1 })).toBe("core");
    expect(translate("en", "cores.unit.cores", { count: 8 })).toBe("cores");
    expect(translate("en", "cores.games.useSuggested", { n: 4 })).toBe("Use 4");
    expect(translate("it", "cores.games.useSuggested", { n: 4 })).toBe("Usa 4");
  });
  it("switches language for t()", () => {
    setLocale("it");
    expect(t("cores.pool.physical")).toBe("Solo core fisici");
    expect(document.documentElement.lang).toBe("it");
  });
  it("keeps the same placeholders in every translation", () => {
    const leaves = (o: object, p = ""): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : isPlural(v) ? [[p + k, Object.values(v).join(" ")]] : leaves(v, `${p}${k}.`)));
    const isPlural = (v: object) => "other" in v && Object.keys(v).every((k) => ["zero", "one", "two", "few", "many", "other"].includes(k));
    const names = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();
    const source = new Map(leaves(en));
    for (const l of LOCALES) {
      for (const [key, text] of leaves(l.messages)) {
        expect(source.has(key), `${l.id}: ${key} is not an English text`).toBe(true);
        expect(names(text), `${l.id}: ${key}`).toEqual(names(source.get(key)!));
      }
    }
  });

  it("translates backend messages by code, and keeps the English text of unknown ones", () => {
    const m = { code: "check.games.ok", args: { done: "58", expected: "60" }, text: "58/60 games" };
    expect(translateMsg("en", m)).toBe("58/60 games");
    expect(translateMsg("it", m)).toBe("58/60 partite");
    expect(translateMsg("it", { code: "", args: {}, text: "from the engine" })).toBe("from the engine");
    expect(translateMsg("it", { code: "check.nothing", args: {}, text: "newer backend" })).toBe("newer backend");
    expect(translateMsg("it", "plain string")).toBe("plain string");
  });
});
