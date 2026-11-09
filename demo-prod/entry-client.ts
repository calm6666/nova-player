/**
 * demo-prod 客户端水合入口
 * ============================================
 * 在浏览器中执行（通过 <script type="module"> 加载）。
 *
 * 工作流程：
 * 1. 创建与 SSR 相同的 VNode 树（createApp({})）
 * 2. 调用 hydrate() — 遍历已有 DOM，绑定事件、ref、生命周期
 * 3. 填充调试面板数据（SSR 耗时、Style/Class 验证）
 * 4. 绑定「切换视频源」「销毁播放器」按钮事件
 */

import { hydrate } from "@lumina/framework";
import { createApp } from "./main";

// ★ 从构建产物导入播放器（monorepo 链接到 packages/player/dist）
import { VideoPlayer } from "@lumina/nova";
// 插件从构建产物导入（monorepo 链接到 packages/plugins/dist）
import { createHlsPlugin } from "@lumina/plugins/hls";
import { createDashPlugin } from "@lumina/plugins/dash";

// ============================================
// 步骤 1：执行水合
// ============================================

const root = document.getElementById("root");
if (!root) throw new Error("#root 元素未找到 — 请检查 HTML 模板");

// 水合计时起点
const hydrationStart = performance.now();

try {
  // createApp 创建与 SSR 完全相同的 VNode 树
  // hydrate 遍历 VNode 树，匹配已有 DOM，绑定事件和 ref
  hydrate(createApp({}), root);

  // 更新 SSR 徽章状态
  const badge = document.getElementById("ssr-badge");
  if (badge) {
    badge.className = "ssr-badge hydrated";
    const text = badge.querySelector(".text");
    if (text) text.textContent = "Hydrated";
  }

  console.log(
    "[demo-prod] 水合完成 ·",
    (performance.now() - hydrationStart).toFixed(1),
    "ms",
  );
} catch (e) {
  console.error("[demo-prod] 水合失败:", e);
  const badge = document.getElementById("ssr-badge");
  if (badge) {
    badge.className = "ssr-badge failed";
    const text = badge.querySelector(".text");
    if (text) text.textContent = "Failed";
  }
}

// ============================================
// 步骤 2：填充调试面板
// ============================================

/**
 * HTML 转义工具：防止用户数据中的特殊字符破坏 HTML 结构
 */
function esc(s: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  };
  return s.replace(/[&<>"]/g, (c) => map[c] || c);
}

/**
 * 向调试面板的指定区域渲染键值对列表
 *
 * @param containerId - 目标容器的 DOM id
 * @param items - 键值对数组，ok 为 false 时显示为红色
 */
function renderDebugItems(
  containerId: string,
  items: Array<{ k: string; v: string; ok: boolean }>,
): void {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items
    .map(
      (item) =>
        `<div class="debug-row">` +
        `<span class="k">${esc(item.k)}</span>` +
        `<span class="v ${item.ok ? "green" : "red"}">${esc(item.v)}</span>` +
        `</div>`,
    )
    .join("");
}

/**
 * 更新调试面板顶部指示器的颜色状态
 *
 * @param id - 指示器 DOM id
 * @param ok - true 显示绿色，false 显示红色
 */
function setIndicator(id: string, ok: boolean): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.color = ok ? "#4ade80" : "#f87171";
  el.style.background = ok ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)";
}

// ====== SSR 信息 ======
// 从 SSR 注入的 <meta> 标签读取渲染耗时
const ssrMeta = document.querySelector('meta[name="ssr-render-duration"]');
const ssrDuration = ssrMeta?.getAttribute("content") ?? "?";

renderDebugItems("dbg-ssr", [
  { k: "renderToString", v: `${ssrDuration}ms`, ok: true },
  {
    k: "hydrate()",
    v: `${(performance.now() - hydrationStart).toFixed(1)}ms`,
    ok: true,
  },
  { k: "环境", v: "Node.js + Browser", ok: true },
  { k: "模式", v: "SSR + Hydration", ok: true },
]);

// ====== Style 验证 ======
// 扫描 DOM 中所有带 style 属性的元素，检查是否有脏输出
(function checkStyles() {
  const all = document.querySelectorAll("[style]");
  let emptyCount = 0; // style="" 或 style=";"
  let dirtyCount = 0; // display: ; 残留
  let validCount = 0;

  all.forEach((el) => {
    const attr = el.getAttribute("style") || "";
    // 空 style 属性或仅含分号 → style=";"
    if (!attr.trim() || attr.trim() === ";") {
      emptyCount++;
      return;
    }
    // display: ; 残留 → 之前的 bug 痕迹
    if (/display\s*:\s*;/.test(attr)) {
      dirtyCount++;
      return;
    }
    validCount++;
  });

  const ok = emptyCount === 0 && dirtyCount === 0;
  renderDebugItems("dbg-style", [
    { k: "含 style 元素", v: String(all.length), ok: true },
    { k: "有效 style", v: String(validCount), ok: true },
    { k: '空 style=""', v: String(emptyCount), ok: emptyCount === 0 },
    { k: "display: ; 残留", v: String(dirtyCount), ok: dirtyCount === 0 },
  ]);
  setIndicator("ind-style", ok);
})();

// ====== Class 验证 ======
// 扫描 DOM 中所有带 class 属性的元素，检查是否有序列化错误
(function checkClasses() {
  const all = document.querySelectorAll("[class]");
  let badCount = 0; // 含 [object Object] 或逗号分隔的无效 class
  let okCount = 0;

  all.forEach((el) => {
    const cls = el.getAttribute("class") || "";
    // [object Object] → 对象未正确序列化
    // 逗号 → 数组未 join(' ')
    if (cls.includes("[object Object]") || cls.includes(",")) {
      badCount++;
      return;
    }
    if (cls.trim()) okCount++;
  });

  renderDebugItems("dbg-class", [
    { k: "含 class 元素", v: String(all.length), ok: true },
    { k: "有效 class", v: String(okCount), ok: true },
    { k: "无效 class", v: String(badCount), ok: badCount === 0 },
  ]);
  setIndicator("ind-class", badCount === 0);
})();

// ====== 性能信息 ======
(function showPerf() {
  // Navigation Timing API：页面加载性能数据
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  renderDebugItems("dbg-perf", [
    {
      k: "DOM 解析",
      v: nav ? `${nav.domContentLoadedEventEnd.toFixed(0)}ms` : "?",
      ok: true,
    },
    {
      k: "首字节",
      v: nav ? `${nav.responseStart.toFixed(0)}ms` : "?",
      ok: true,
    },
    { k: "构建产物", v: "index.es.js", ok: true },
    { k: "编译插件", v: "lumina-compile", ok: true },
  ]);
})();

// ============================================
// 步骤 3：调试面板交互
// ============================================

(function setupDebugPanel() {
  const panel = document.getElementById("debug");
  const toggle = document.getElementById("debug-toggle");
  if (!panel || !toggle) return;

  // 点击标题栏展开/收起
  toggle.addEventListener("click", () => {
    panel.classList.toggle("open");
  });

  // 键盘快捷键：按 `（反引号）切换调试面板
  document.addEventListener("keydown", (e) => {
    if (e.key === "`" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      panel.classList.toggle("open");
    }
  });
})();

// ============================================
// 步骤 4：「切换视频源」「销毁播放器」按钮
// ============================================

/** 示例视频源列表（轮播切换：MP4 / HLS / DASH） */
const SAMPLE_SOURCES = [
  "http://127.0.0.1:9000/hfs/4d00fa3c10f5807b74f3ec7d52e86c4918d043b6911f854af577f4c70b366dc5.mp4",
  "http://127.0.0.1:9000/video/dash2/master-segmentbase.m3u8",
  "http://127.0.0.1:9000/video/dash2/output-segmentbase.mpd",
];
/** 当前使用的视频源索引（轮播递增） */
let sourceIndex = 0;

/**
 * 切换视频源：
 * 1. 销毁当前播放器实例
 * 2. 根据 URL 后缀选择流媒体插件（HLS / DASH）
 * 3. 创建新播放器并挂载到容器
 */
function switchSource(): void {
  const wrapper = document.getElementById("player-wrapper");
  if (!wrapper) return;

  // 轮播选择下一个视频源
  const src = SAMPLE_SOURCES[sourceIndex % SAMPLE_SOURCES.length];
  sourceIndex++;

  // 根据视频源类型选择对应的流媒体插件
  const plugins: Array<
    ReturnType<typeof createHlsPlugin> | ReturnType<typeof createDashPlugin>
  > = [];
  if (src.includes(".m3u8")) {
    plugins.push(createHlsPlugin({ autoplay: false }));
  }
  if (src.includes(".mpd")) {
    plugins.push(createDashPlugin({ autoplay: false }));
  }

  // 创建新播放器实例并挂载
  const player = new VideoPlayer({
    src,
    playback: {
      autoplay: false,
      muted: true,
      volume: 0.8,
    },
    interaction: {
      keyboard: true,
    },
    plugins: {
      list: plugins,
    },
    advanced: {
      debug: false,
    },
  });

  wrapper.innerHTML = "";
  player.mount(wrapper);

  console.log("[demo-prod] 切换视频源:", src.slice(0, 60));
}

/**
 * 销毁播放器：清空容器，显示占位提示
 */
function destroyPlayer(): void {
  const wrapper = document.getElementById("player-wrapper");
  if (!wrapper) return;
  wrapper.innerHTML =
    `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.3);font-size:14px;">` +
    `播放器已销毁</div>`;
  console.log("[demo-prod] 播放器已销毁");
}

// 绑定按钮事件
document.getElementById("btn-switch")?.addEventListener("click", switchSource);
document
  .getElementById("btn-destroy")
  ?.addEventListener("click", destroyPlayer);
