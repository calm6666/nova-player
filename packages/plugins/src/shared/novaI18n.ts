/**
 * 插件内的 i18n 桥接（构建期内部模块）
 * ============================================
 * 插件的 dist 用 preserveModules 打包，若直接打包 `core/i18n` 会得到一份
 * **独立于 @lumina/nova 的语言包注册表**：应用通过 VideoPlayer 注册的
 * 语言包（i18n.messages）插件读不到，弹幕列表面板只能显示 i18n key。
 *
 * 这里把插件用到的 `t()` 指到 `@lumina/nova` 的实例（运行时 external），
 * 其余 i18n API 保持原有语义（插件目前不直接使用，转出以维持
 * `core/index` 的导出面不变）。
 */
export {
  setLocale,
  getLocale,
  registerLocale,
  subscribeLocale,
  isI18nEnabled,
  initI18n,
  localeSignal,
} from '@/core/i18n';
export type { Locale, I18nConfig } from '@/core/i18n';
export { t } from '@lumina/nova';
