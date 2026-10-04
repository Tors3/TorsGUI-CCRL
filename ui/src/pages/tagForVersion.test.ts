import { describe, expect, it } from "vitest";
import { tagForVersion } from "./Engines";

describe("release of the CCRL version", () => {
  it("matches the usual tag styles", () => {
    const tags = ["v9.0.1", "v9.0.0", "v8.1.0"];
    expect(tagForVersion(tags, "9.0.0")).toBe("v9.0.0");
    expect(tagForVersion(tags, "9.0")).toBe("v9.0.0");
    expect(tagForVersion(["sf_19", "sf_18"], "19")).toBe("sf_19");
    expect(tagForVersion(["Koivisto_9.0", "Koivisto_8.0"], "9.0")).toBe("Koivisto_9.0");
    expect(tagForVersion(["v3_0"], "3.0")).toBe("v3_0");
    expect(tagForVersion(tags, "7")).toBeUndefined();
    expect(tagForVersion(tags, "")).toBeUndefined();
  });
});
