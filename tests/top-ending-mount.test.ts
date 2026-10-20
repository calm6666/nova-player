import { describe, expect, it } from "vitest";
import { TopPlugin } from "../packages/plugins/src/top";
import { EndingPlugin } from "../packages/plugins/src/ending";

describe("Top / Ending 插件注册", () => {
  it("TopPlugin install / uninstall 注册到 player 实例", () => {
    let registered: ((container: HTMLElement) => void | (() => void)) | null =
      null;
    const host = {
      registerTopPluginMount(mount: typeof registered) {
        registered = mount;
      },
      unregisterTopPluginMount(mount?: typeof registered) {
        if (!mount || registered === mount) registered = null;
      },
    };
    const plugin = TopPlugin({ id: "custom-top", mount: () => {} });
    expect(registered).toBeNull();
    plugin.install?.(host as never);
    expect(registered).not.toBeNull();
    plugin.uninstall?.();
    expect(registered).toBeNull();
  });

  it("EndingPlugin install / uninstall 注册到 player 实例", () => {
    let registered: ((container: HTMLElement) => void | (() => void)) | null =
      null;
    const host = {
      registerEndingPluginMount(mount: typeof registered) {
        registered = mount;
      },
      unregisterEndingPluginMount(mount?: typeof registered) {
        if (!mount || registered === mount) registered = null;
      },
    };
    const plugin = EndingPlugin({ id: "custom-ending", mount: () => {} });
    expect(registered).toBeNull();
    plugin.install?.(host as never);
    expect(registered).not.toBeNull();
    plugin.uninstall?.();
    expect(registered).toBeNull();
  });
});
