/**
 * 服务端专用样式入口。
 *
 * 只由 demo/server.mjs 通过 vite.ssrLoadModule 加载；
 * 不进入客户端入口，也不由 main.ts / entry-server.ts 导入。
 */
import playerCss from "@/styles/style.scss?inline";

export default playerCss;
