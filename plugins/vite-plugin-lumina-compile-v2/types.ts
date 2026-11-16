/**
 * v2 编译插件配置
 */
export interface LuminaCompileV2Options {
  /** 是否启用，默认 true；全量模式不需要配置 compileFiles */
  enabled?: boolean;
  /**
   * 可选白名单：绝对路径、项目相对路径或 RegExp。
   * 未配置或空数组时处理全部符合框架 h 检测的文件。
   */
  compileFiles?: Array<string | RegExp>;
  /** 黑名单，优先于白名单 */
  exclude?: Array<string | RegExp>;
  /** 文件首部声明式开关，默认 @lumina:compile；全量模式下可省略 */
  pragma?: string;
  /** 是否转换 *.test.* 文件，默认 false；测试环境需要编译期响应式时开启 */
  transformTests?: boolean;
  /** 运行时入口，默认 @lumina/framework/core/internal-dom */
  internalImportSource?: string;
  /** v1 收尾编译的运行时入口，默认 @lumina/framework/core/internal */
  v1InternalImportSource?: string;
  /** 覆盖 v1 收尾编译的 isProduction，默认跟随 vite command */
  v1IsProduction?: boolean;
}
