/**
 * 懒挂载面板样式注入
 *
 * 面板样式不进入首屏 style.css：ensurePanel 首次打开面板时，
 * 该模块与面板组件一起动态加载，再把编译后的 CSS 注入 head。
 */

import panelsCss from "../styles/panels.scss?inline";

const STYLE_ID = "nova-player-lazy-panels";

/** 注入面板样式（幂等；模块本身按需动态加载） */
export function ensureLazyPanelStyles(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector(`style[data-nova-style="${STYLE_ID}"]`)) return;
  const style = document.createElement("style");
  style.setAttribute("data-nova-style", STYLE_ID);
  style.textContent = panelsCss;
  document.head.appendChild(style);
}
