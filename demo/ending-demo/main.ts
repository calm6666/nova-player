/**
 * ============================================
 * 片尾 / 跳过片头片尾场景演示
 * ============================================
 * 一个按钮切换查看：
 * - 标准片尾（浮层 + lottie 倒计时）
 * - 电视剧 OGV 片尾（整页 + 封面 / 追剧 / 推荐卡）
 * - 外链片尾（整页 + 下载 / 进入站内）
 * - 片尾分享面板
 * - 外链播放中（简化控制栏 + 底部推荐条）
 * - 设置面板「跳过头尾」
 * - 进度条片头 / 片尾断点
 */

import { VideoPlayer } from "@/nova/player";
import { PlayMode } from "@/types";
import type { EndingRelatedItem, PlayerConfig } from "@/types";

type DemoMode =
  | "standard"
  | "ogv"
  | "embedded"
  | "share"
  | "embedded-play"
  | "settings"
  | "points";

const VIDEO =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

/** 生成 SVG data URI 图片（封面 / 推荐图） */
const svgPic = (index: number, width = 400, height = 225): string =>
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="hsl(${(index * 40) % 360},55%,38%)"/><text x="16" y="${height / 2}" fill="#fff" font-size="${Math.round(width / 14)}">推荐 ${index + 1}</text></svg>`,
  );

/** 标准片尾推荐数据 */
const standardRelated: EndingRelatedItem[] = Array.from(
  { length: 8 },
  (_, i) => ({
    title: `示例推荐视频 ${i + 1}：一段用于预览片尾卡片的标题`,
    pic: svgPic(i),
    duration: 60 + i * 17,
    url: "#",
  }),
);

/** OGV / 外链推荐数据 */
const ogvRelated: EndingRelatedItem[] = Array.from({ length: 10 }, (_, i) => ({
  title: `西游记相关推荐 ${i + 1}：一段剧集标题`,
  pic: svgPic(i, 448, 592),
  url: "#",
}));

const container = document.querySelector<HTMLElement>("#player");
if (!container) throw new Error("missing #player");

let player: VideoPlayer | null = null;

/** 等待播放器元数据就绪（duration 可用） */
const waitDuration = (timeout = 8000): Promise<number> =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      const duration = player?.getDuration() ?? 0;
      if (Number.isFinite(duration) && duration > 0) {
        resolve(duration);
        return;
      }
      if (Date.now() - started > timeout) {
        reject(new Error("等待视频元数据超时"));
        return;
      }
      setTimeout(tick, 120);
    };
    tick();
  });

/** 跳到结尾并播放（触发片尾） */
const seekToEnd = async (): Promise<void> => {
  const duration = await waitDuration();
  await player?.seek(Math.max(0, duration - 0.35));
  await player?.play();
};

/** 让控制栏显示（PlayerDocker 监听容器 mousemove） */
const showControls = (): void => {
  const root = container.querySelector(".nova-player-container");
  if (root instanceof HTMLElement) {
    root.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 600, clientY: 400 }),
    );
    // 演示/截图：直接展开控制栏与底部推荐条
    root.setAttribute("data-ctrl-hidden", "false");
  }
};

/** 打开设置面板（真实 mouseenter 事件） */
const openSettings = (): void => {
  showControls();
  const btn = container.querySelector(".nova-player-ctrl-setting");
  if (btn instanceof HTMLElement) {
    btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
  }
};

/** 构建设置面板演示配置（OGV / 断点均能触发「跳过头尾」开关） */
const buildConfig = (mode: DemoMode): PlayerConfig => {
  const base: PlayerConfig = {
    container: "#player",
    src: VIDEO,
    i18n: { enabled: true, locale: "zh-CN" },
    playback: {
      autoplay: true,
      muted: true,
      pauseAfterEnd: mode === "share",
      playMode: PlayMode.ORDER,
    },
    playlist: [
      { src: VIDEO, title: "第一集" },
      { src: VIDEO, title: "第二集" },
    ],
    progress: { skipPoints: { introEnd: 1, outroStart: 4 } },
    ui: {
      title: "片尾场景演示",
      scene: "station",
      endingStyle: "standard",
      related: standardRelated,
      up: {
        name: "测试 UP 主",
        face: svgPic(2, 96, 96),
        followed: false,
      },
      share: {
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        embedCode:
          '<iframe src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>',
      },
      controls: {
        quality: true,
        episodes: true,
        setting: true,
        pip: true,
        wideScreen: true,
        webFullscreen: true,
      },
    },
  };

  if (mode === "ogv" || mode === "settings") {
    return {
      ...base,
      ui: {
        ...base.ui,
        title: "西游记",
        endingStyle: "ogv",
        ogv: {
          title: "西游记",
          cover: svgPic(3, 136, 136),
          followed: false,
          related: ogvRelated,
        },
      },
    };
  }

  if (mode === "embedded" || mode === "embedded-play") {
    return {
      ...base,
      ui: {
        ...base.ui,
        scene: "embedded",
        embedded: {
          title: "外链播放器演示：B 站风格片尾",
          up: {
            name: "测试 UP 主",
            face: svgPic(7, 96, 96),
            followed: false,
          },
          related: ogvRelated,
          enterUrl: "#enter",
          downloadUrl: "#download",
        },
      },
    };
  }

  return base;
};

/** 销毁旧实例并重建 */
const createPlayer = (mode: DemoMode): void => {
  if (player) {
    player.destroy();
    player = null;
  }
  container.innerHTML = "";
  const next = new VideoPlayer(buildConfig(mode));
  next.mount(container);
  player = next;
  document
    .querySelectorAll<HTMLButtonElement>("[data-mode]")
    .forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === mode);
    });
};

/** 执行模式对应的交互 */
const runMode = async (mode: DemoMode): Promise<void> => {
  if (mode === "standard" || mode === "ogv" || mode === "embedded") {
    await seekToEnd();
    return;
  }
  if (mode === "share") {
    await seekToEnd();
    setTimeout(() => {
      container
        .querySelector<HTMLElement>(
          '.nova-player-ending-functions-btn[data-action="share"]',
        )
        ?.click();
    }, 900);
    return;
  }
  if (mode === "embedded-play") {
    await waitDuration();
    await player?.seek(1);
    await player?.play();
    setTimeout(() => {
      player?.pause();
      showControls();
    }, 900);
    return;
  }
  if (mode === "settings") {
    await waitDuration();
    await player?.seek(1);
    player?.pause();
    setTimeout(openSettings, 900);
    return;
  }
  if (mode === "points") {
    await waitDuration();
    await player?.seek(2);
    player?.pause();
    setTimeout(showControls, 600);
  }
};

/** 切换场景 */
const switchMode = async (mode: DemoMode): Promise<void> => {
  createPlayer(mode);
  try {
    await runMode(mode);
  } catch (error) {
    console.error("[ending-demo]", error);
  }
};

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;
    if (mode) void switchMode(mode as DemoMode);
  });
});

// 供无头浏览器 / 控制台调用
(window as unknown as {
  demo: {
    switchMode: (mode: DemoMode) => Promise<void>;
    getPlayer: () => VideoPlayer | null;
    modes: DemoMode[];
    screenshotMode: (on: boolean) => void;
  };
}).demo = {
  switchMode,
  getPlayer: () => player,
  modes: [
    "standard",
    "ogv",
    "embedded",
    "share",
    "embedded-play",
    "settings",
    "points",
  ],
  screenshotMode: (on: boolean) => {
    document.body.classList.toggle("screenshot-mode", on);
  },
};

void switchMode("standard");
