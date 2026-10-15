import { describe, expect, it } from "vitest";
import { guideText, sections, slug } from "./Help";

describe("translated guides", () => {
  it("keep the English section ids, so links into the guide work in every language", () => {
    for (const doc of ["guide", "file"] as const) {
      const en = sections(guideText(doc, "en").md).map((s) => s.id);
      const it_ = sections(guideText(doc, "it").md).map((s) => s.id);
      expect(it_).toEqual(en);
    }
  });

  it("show the heading without its explicit anchor", () => {
    expect(slug("3. Motori {#engines}")).toBe("engines");
    expect(slug("3. Engines")).toBe("engines");
    const s = sections("## 3. Motori {#engines}\n\ntesto\n");
    expect(s[0].title).toBe("3. Motori");
    expect(s[0].html).toContain('<h2 id="engines">3. Motori</h2>');
  });
});

