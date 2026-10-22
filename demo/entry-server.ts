/**
 * ============================================
 * 服务端渲染(SSR)入口
 * ============================================
 * 此文件在 Node.js 环境中运行（通过 vite.ssrLoadModule 加载）
 *
 * 职责：
 * 1. 导入 RootLayout 组件（从 main.ts）
 * 2. 创建 VNode 虚拟节点树
 * 3. 调用 renderToString 将 VNode 树序列化为 HTML 字符串
 * 4. 导出 render() 函数供服务器调用
 * 5. 导出 getSSRMeta() 返回 SSR 渲染耗时（供 server.mjs 注入 meta 标签）
 *
 * ============================================
 * SSR 渲染流程说明
 * ============================================
 *
 * 浏览器请求 → Express 服务器 → vite.ssrLoadModule('/entry-server.ts')
 *   → 调用 render() → RootLayout({}) 创建 VNode 树
 *   → renderToString(vnode) 序列化为 HTML 字符串
 *   → 替换 index.html 中的 <!--ssr-outlet-->
 *   → 注入 <meta name="ssr-start-time"> 标签
 *   → 返回完整 HTML 给浏览器
 *
 * 注意事项：
 * - 此文件在 Node.js 中执行，不能使用浏览器 API（document, window 等）
 * - main.ts 中的浏览器特定代码已被 typeof document 守卫保护
 * - VNode 树的创建方式必须与 entry-client.ts 完全一致
 *   否则 hydrate 时 VNode 与 DOM 不匹配会导致水合失败
 */

import "@/styles/style.scss";
import { renderToString } from "@/core";
import { RootLayout, playerInstance, setPlayerInstance } from "./main";

/**
 * SSR 渲染开始时间戳（模块加载时记录）
 * 用于计算从模块加载到渲染完成的总耗时
 */
const SSR_MODULE_LOAD_TIME = Date.now();

/**
 * 最近一次 SSR 渲染的耗时（毫秒）
 * 由 render() 函数填充，由 getSSRMeta() 导出
 */
let lastSSRDuration = 0;
let lastSSRStartTime = 0;

/**
 * SSR 渲染函数
 * 服务器调用此函数获取组件渲染后的 HTML 字符串
 *
 * @returns 渲染后的 HTML 字符串
 *
 * 工作原理：
 * 1. RootLayout({}) 调用组件函数，返回组件的 VNode 树
 *    - RootLayout 是根布局组件，内部通过 provide 注入 Context
 *    - App 是主应用组件，包含计数器、主题切换、VideoPlayer 容器等子组件
 *    - 传入空对象 {} 因为 RootLayout 不需要外部 props
 *
 * 2. renderToString(vnode) 递归遍历 VNode 树，将其序列化为 HTML：
 *    - 原生标签（div, span 等）→ <div>...</div>
 *    - 组件标签 → 递归调用组件函数，序列化其返回的 VNode
 *    - Fragment → 只输出子元素，不产生包裹标签
 *    - 文本节点 → 直接输出文本内容（经过 HTML 转义）
 *    - Context Provider → 在渲染子树前设置上下文，渲染后恢复
 */
export function render(): string {
  lastSSRStartTime = performance.now();
  const vnode = RootLayout({});
  const html = renderToString(vnode);
  lastSSRDuration = performance.now() - lastSSRStartTime;
  // SSR 播放器实例不进入请求生命周期：序列化完成后释放，避免下一个请求复用到带状态的实例
  try {
    playerInstance?.destroy();
  } finally {
    setPlayerInstance(null);
  }
  return html;
}

/**
 * 获取最近一次 SSR 渲染的元信息
 * 服务器在 render() 调用后获取此信息，
 * 注入到 HTML 模板中供客户端读取
 *
 * @returns SSR 元信息对象
 *   - startTime: 模块加载时间（用于客户端计算总 SSR 耗时）
 *   - renderDuration: render() 函数本身的执行耗时
 *   - moduleLoadTime: 模块加载完成的时间点
 */
export function getSSRMeta(): {
  startTime: number;
  renderDuration: number;
  moduleLoadTime: number;
} {
  return {
    startTime: SSR_MODULE_LOAD_TIME,
    renderDuration: lastSSRDuration,
    moduleLoadTime: SSR_MODULE_LOAD_TIME,
  };
}
