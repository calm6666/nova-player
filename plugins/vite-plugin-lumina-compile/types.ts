/**
 * Vite 编译插件类型定义
 */

/**
 * 插件配置选项（全部可选，零配置时使用默认值）
 */
export interface LuminaCompileOptions {
  /**
   * 是否启用静态提升
   * 将纯静态的 h() 子树提升为模块级常量（使用点克隆复用）
   * 默认：true，但仅生产构建生效（与 Vue plugin-vue 一致）
   */
  hoistStatic?: boolean;

  /**
   * 静态子树模板化（编译期 DOM 化阶段 1）
   * 将提升的静态子树从「VNode 常量 + 运行时克隆解释」改为
   * 「HTML 字符串常量 + 运行时 _tmpl() 惰性 <template> cloneNode」：
   * - mount：一次 cloneNode 替代整棵子树的 createElement/applyAttrs/递归物化
   * - SSR：renderToString 直接拼模板 HTML，跳过 VNode 序列化
   * - 水合：直接采用 SSR 已输出的 DOM 段，零克隆成本
   * 不适用模板的场景自动回退 VNode 提升路径（裸 SVG 子标签/ref/受限标签等）
   * 默认：true（dev/prod 同一模板路径，显著提升渲染性能）；
   * 设 false 回到 VNode 提升路径。开启时开发模式也会激活静态提升
   */
  tmplStatic?: boolean;

  /**
   * 是否预计算组件类型
   * 在 defineComponent 和 class 组件后注入 __lumina_type 标记
   * 默认：true（dev/prod 均生效）
   */
  compileComponentType?: boolean;

  /**
   * 是否预分类属性
   * 将 onXxx 事件提取为 __events，ref 提取为 __ref
   * 默认：true（dev/prod 均生效）
   */
  compileAttrs?: boolean;

  /**
   * 是否在开发模式下也执行转换
   * 默认：true —— dev/prod 使用同一套编译产物（与 Vue/Solid 一致），
   * 消除双路径行为差异；设 false 回到旧行为（dev 零转换）
   */
  dev?: boolean;

  /**
   * 包含的文件 glob 模式
   * 默认：[/\.tsx?$/]
   */
  include?: RegExp[];

  /**
   * 排除的文件 glob 模式
   * 默认排除 node_modules、测试文件、框架核心文件
   */
  exclude?: RegExp[];

  /**
   * 编译产物引用的内部函数导入路径
   * 默认：'@/core/internal'（需要与项目的 @/core 别名一致）
   * 若用户项目使用不同的别名/包名，可在此覆盖
   */
  internalImportSource?: string;
}

/**
 * 转换上下文（内部使用）
 */
export interface TransformContext {
  /** 是否为生产环境（真实环境，非编译选项） */
  isProduction: boolean;
  /** 是否启用静态提升 */
  hoistStatic: boolean;
  /** 是否启用静态子树模板化（HTML 字符串 + _tmpl cloneNode） */
  tmplStatic: boolean;
  /** 是否预计算组件类型 */
  compileComponentType: boolean;
  /** 是否预分类属性 */
  compileAttrs: boolean;
  /** 静态提升变量计数器 */
  hoistedCount: number;
  /** 静态 attrs 提升常量计数器（_hoisted_attrs_N） */
  hoistedAttrsCount: number;
  /** export default 改写临时变量计数器 */
  defaultExportCount: number;
  /** 当前文件名 */
  filename: string;
  /** 内部函数导入路径 */
  internalImportSource: string;
  /**
   * 已使用的内部函数名集合（按需注入 import）
   * 用 string[] 而非 Set：避免 Set 展开迭代在低 target / 无 downlevelIteration
   * 环境下产生 error 类型，触发 no-unsafe-call
   */
  usedInternalFns: string[];
  /** 静态提升声明列表（按依赖顺序收集，最后统一注入） */
  hoistedDecls: string[];
}
