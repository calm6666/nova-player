// @vitest-environment node
import { describe, expect, it } from "vitest";
import { VideoPlayer, renderPlayerToString } from "@/index";

describe("Player SSR", () => {
  it("renders the full player UI to HTML", () => {
    const player = new VideoPlayer({
      src: "/sample.mp4",
      ui: { title: "SSR Player" },
    });
    const html = renderPlayerToString(player);

    expect(html).toContain("nova-player-container");
    expect(html).toContain("<video");
    expect(html.length).toBeGreaterThan(1000);
  });
});
