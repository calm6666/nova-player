/**
 * ============================================
 * SSR 开发服务器
 * ============================================
 * 使用 Express + Vite 中间件模式实现服务端渲染
 *
 * 工作流程：
 * 1. 启动 Vite 开发服务器（中间件模式）
 * 2. 收到 GET / 请求时：
 *    a. 通过 vite.ssrLoadModule 加载 entry-server.ts
 *    b. 调用 render() 获取组件渲染的 HTML 字符串
 *    c. 读取 index.html 模板
 *    d. 将 <!--ssr-outlet--> 替换为渲染的 HTML
 *    e. 发送完整的 HTML 给浏览器
 * 3. 其他请求交给 Vite 中间件处理（HMR、静态资源等）
 *
 * 前置依赖：需要安装 express
 *   pnpm add -D express
 *   pnpm add -D @types/express
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';

/**
 * 获取当前目录路径
 * ESM 模块中没有 __dirname，需要通过 fileURLToPath 手动转换
 * import.meta.url 返回当前模块的 file:// URL
 * path.dirname 将其转换为目录路径
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 服务器端口号
 * 默认与 vite.config.ts 中的 server.port 保持一致，可用 SSR_PORT 覆盖（便于并行调试）
 */
const PORT = Number(process.env.SSR_PORT) || 5174;

async function createServer() {
  /**
   * 创建 Express 应用实例
   * Express 是一个轻量级的 Node.js Web 框架
   * 用于处理 HTTP 请求和路由
   */
  const app = express();

  /**
   * ============================================
   * 步骤1：创建 Vite 开发服务器（中间件模式）
   * ============================================
   *
   * middlewareMode: true
   *   表示 Vite 不自己启动 HTTP 服务器，而是作为中间件挂载到 Express 上
   *   这样 Express 负责路由控制，Vite 负责模块转换、HMR 等开发功能
   *
   * appType: 'custom'
   *   自定义模式，Vite 不会注入默认的 HTML 处理中间件
   *   我们自己处理 HTML 模板的读取和 SSR 注入
   */
  const httpServer = app.listen(PORT, () => {
    console.log(`SSR 开发服务器已启动: http://localhost:${PORT}`);
  });

  const vite = await createViteServer({
    root: path.resolve(__dirname),
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
    },
    appType: 'custom',
  });

  /**
   * 将 Vite 中间件挂载到 Express
   * vite.middlewares 是一个 connect 兼容的中间件
   * 它会处理以下请求：
   *   - /@modules/* → Vite 的模块转换请求
   *   - /src/* → 源码文件的即时编译
   *   - *.vue, *.ts → 特定文件类型的转换
   *   - /@hmr → HMR 热更新的 WebSocket 连接
   * 挂载后，这些请求会先经过 Vite 处理，不需要我们手动转换模块
   */
  app.use(vite.middlewares);

  /**
   * ============================================
   * SSR CSS 收集（SSR 关键部分）
   * ============================================
   * SSR 下 CSS import 会被 Vite 忽略，首屏会 FOUC，所以要把编译后的 CSS
   * 内联进 HTML。这里必须走 Vite 的客户端 CSS 转换，而不是直接 sass.compile：
   * 只有经过 Vite，SCSS 里的 url(@/assets/xxx) 才会被改写为浏览器可访问的
   * /@fs/... 地址。直接 Sass 编译会留下裸 @/ 路径，浏览器按相对路径请求
   * 得到 /@/assets/xxx，必然 404。
   */
  const PLAYER_STYLE_URL = '@/styles/style.scss';

  /**
   * 从 Vite transformRequest 的 JS 包装中提取 CSS 字符串
   * Vite 生成的 JS 代码格式：const __vite__css = "...actual CSS...";
   */
  function extractCssLiteral(jsCode) {
    const marker = jsCode.match(/__vite__css\s*=\s*/);
    if (!marker) return null;
    const start = marker.index + marker[0].length;
    const quote = jsCode[start];
    if (quote !== '"' && quote !== "'" && quote !== "`") return null;
    let escaped = false;
    let i = start + 1;
    for (; i < jsCode.length; i++) {
      const ch = jsCode[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) { i += 1; break; }
    }
    const literal = jsCode.slice(start, i);
    if (quote === '"') {
      try { return JSON.parse(literal); } catch { return null; }
    }
    return literal
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\");
  }

  async function compilePlayerCss() {
    const resolved = await vite.pluginContainer.resolveId(PLAYER_STYLE_URL, undefined, {
      ssr: false,
    });
    if (!resolved) throw new Error(`无法解析样式入口: ${PLAYER_STYLE_URL}`);
    const result = await vite.transformRequest(resolved.id, { ssr: false });
    const css = result?.code ? extractCssLiteral(result.code) : null;
    if (!css) throw new Error(`样式转换结果中未找到 CSS: ${PLAYER_STYLE_URL}`);
    return css;
  }

  /**
   * ============================================
   * 步骤2：处理页面请求（SSR 渲染）
   * ============================================
   * 当浏览器请求 / 路径时，执行服务端渲染
   * 返回完整的 HTML 页面（包含 SSR 渲染的内容）
   */
  app.get('/', async (req, res, next) => {
    try {
      /**
       * 2a. 读取 index.html 模板
       * 模板中包含 <!--ssr-outlet--> 占位符
       * 该占位符将被替换为组件渲染后的 HTML 字符串
       *
       * 注意：在开发模式下，我们直接读取磁盘上的文件
       * 在生产模式下，应该使用构建后的模板并经过 vite.transformIndexHtml 处理
       */
      const template = fs.readFileSync(
        path.resolve(__dirname, 'index.html'),
        'utf-8'
      );

      /**
       * 2b. 通过 Vite 加载 SSR 入口模块
       *
       * vite.ssrLoadModule 的作用：
       *   - 在 Node.js 环境中加载并执行 TypeScript 模块
       *   - 自动处理 TypeScript 编译（无需预编译）
       *   - 自动解析路径别名（如 @/core → ../core/index.ts）
       *   - 返回模块的导出对象
       *
       * 传入的路径 '/entry-server.ts' 是相对于 Vite root 的模块路径
       * Vite 会自动查找并编译该文件
       */
      const ssrModule = await vite.ssrLoadModule('/entry-server.ts');
      const { render, getSSRMeta } = ssrModule;

      /**
       * 2c. 调用 render() 获取组件渲染的 HTML 字符串
       * render() 函数定义在 entry-server.ts 中
       * 它会：
       *   1. 创建 VNode 虚拟节点树（与客户端完全一致）
       *   2. 调用 renderToString 将 VNode 树序列化为 HTML 字符串
       *   3. 返回 HTML 字符串
       */
      const appHtml = await render(req.query);

      /**
       * 2c-1. 收集 SSR 渲染过程中涉及的 CSS
       * 遍历 Vite 模块依赖图，提取所有 CSS/SCSS 模块的编译结果
       * 注入到 HTML <head> 中，确保首屏即带样式（无 FOUC）
       *
       * 注意：必须在 render() 之后调用，因为 ssrLoadModule 加载入口模块时
       * 才会建立完整的模块依赖图（包括 VideoPlayer → index.scss 等）
       */
      // 必须经 Vite 转换，url(@/assets/...) 才会被改写为 /@fs/... 可访问地址
      let ssrCss = '';
      try {
        ssrCss = await compilePlayerCss();
        console.log('[SSR CSS] compiled player style:', ssrCss.length, 'bytes');
      } catch (err) {
        console.warn('[SSR CSS] compile failed:', err?.message ?? err);
      }

      /**
       * 2d. 注入 SSR 元信息（meta 标签）
       * 客户端 entry-client.ts 通过 document.querySelector 读取这些 meta：
       *   - ssr-start-time: 服务端模块加载时间戳（用于计算 SSR → 客户端水合的总耗时）
       *   - ssr-render-duration: render() 函数本身的执行耗时
       */
      const meta = getSSRMeta ? getSSRMeta() : { startTime: Date.now(), renderDuration: 0 };
      const metaTags =
        '<meta name="ssr-start-time" content="' + meta.startTime + '" />' +
        '<meta name="ssr-render-duration" content="' + meta.renderDuration.toFixed(2) + '" />';

      /**
       * 2e. 将 <!--ssr-outlet--> 替换为渲染的 HTML
       * 同时将 <!--ssr-meta-outlet--> 替换为 SSR meta 标签
       * 将 <!--ssr-css-outlet--> 替换为收集到的 CSS（内联 <style> 标签）
       * 替换后，浏览器收到的就是完整的 HTML 页面（含样式）
       */
      let html = template.replace('<!--ssr-outlet-->', appHtml);
      html = html.replace('<!--ssr-meta-outlet-->', metaTags);
      html = html.replace('<!--ssr-css-outlet-->', ssrCss ? '<style data-ssr-nova-css>' + ssrCss + '</style>' : '');

      /**
       * 2f. 发送完整的 HTML 给浏览器
       * 设置 Content-Type 为 text/html
       * 浏览器收到后直接渲染，用户可以立即看到页面内容
       * 然后浏览器加载 entry-client.ts 进行水合(hydration)
       */
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (e) {
      /**
       * SSR 渲染出错时的处理
       * vite.ssrFixStacktrace 会修正错误堆栈信息
       * 使其指向原始的 TypeScript 源码位置，而不是编译后的代码
       * 方便开发者定位问题
       */
      vite.ssrFixStacktrace(e);
      console.error('[SSR Error]', e);
      res.status(500).end(
        '<!DOCTYPE html><html><body style="font-family:monospace;padding:20px;background:#1a1a2e;color:#f87171">' +
        '<h2>SSR Error</h2><pre>' + (e.stack || e.message) + '</pre>' +
        '</body></html>'
      );
    }
  });

  /**
   * ============================================
   * 步骤3：启动服务器
   * ============================================
   * 监听指定端口，等待客户端连接
   */
}

/**
 * 执行服务器创建函数
 * 使用顶层 async 函数是因为 vite.ssrLoadModule 是异步操作
 */
createServer();
