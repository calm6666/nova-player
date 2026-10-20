import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../packages/player/src/config/normalizeConfig";

describe("ui slot config", () => {
  it("保留只包含 top 的 ui 配置", () => {
    const node = document.createElement("div");
    const config = normalizeConfig({
      container: "#player",
      ui: { top: node },
    });

    expect(config.ui?.top).toBe(node);
  });
});
