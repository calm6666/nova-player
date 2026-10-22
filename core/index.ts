/**
 * ============================================
 * 核心模块统一导出
 * ============================================
 */

export { h, defineComponent, Fragment, when, each, show } from './h';
export { mount, materialize, applyAttrs, destroy, invokeLifecycle, hydrate, getHydrationMismatchCount } from './mount';

// 响应式控制流组件（For/Show/Switch/Match/Dynamic）
// key-based 列表精准更新 + 条件渲染 + 动态组件切换
export { For, Show, Switch, Match, Dynamic } from './flow';
export { ref } from './ref';
export { useTemplateRef } from './templateRef';
export type { Ref, ExposedApi, ComponentLifecycle, TypedComponentLifecycle, TypedEmit, TypedOn, ComponentAttrs, VNodeInternalAttrs, EventCallbacks, ExposedComponent, MaybeSignal, Signalify } from '@/types';

// 状态管理、事件总线、钩子系统（基础类型和实现）
export { createStateManager, createTypedStateManager, useState, useReactiveState } from './state';
export { createEventBus, createTypedEventBus } from './eventBus';
export { createHookSystem } from './hooks';
export { createContext, useContext, provide, saveContext, restoreContext } from './context';

// 响应式信号 + effect（基于自研 signalsCore）
export { signal, computed, effect, batch, untracked, onEffect } from './signals';
export type { Signal, ReadonlySignal } from './signals';

// 框架警告与错误处理
export { warn, reportError, safeCall, safeAsyncCall, assertWarn, onFrameworkError, onFrameworkWarning } from './warning';
export { WarnSource, ErrorSource } from './warning';
export type { FrameworkError, FrameworkWarning, GlobalErrorHandler, GlobalWarningHandler } from './warning';

// i18n 国际化机制（语言包由应用层通过 initI18n / registerLocale 注册）
export { t, setLocale, getLocale, registerLocale, subscribeLocale, isI18nEnabled, initI18n, localeSignal } from './i18n';
export type { Locale, I18nConfig } from './i18n';

// 响应式指令系统（自定义指令注册 + 内置 v-model/v-show/v-text/v-html）
export { directive } from './directives';

// 导出基础类型（从各模块重新导出，不依赖 plugin）
export type { StateManager, TypedStateManager } from './state';
export type { EventBus, TypedEventBus } from './eventBus';
export type { PlayerEventMap, PlayerEventBus } from './events';
export type { HookSystem } from './hooks';

// 服务端渲染(SSR)
export { renderToString } from './ssr';

// Style / Class 标准化（SSR 和客户端共用）
export {
  normalizeStyle,
  normalizeStyleValue,
  normalizeClass,
  serializeStyle,
  applyStyle,
  camelToKebab,
} from './normalize';

// 编译期内部函数（由 vite-plugin-lumina-compile 生成的代码引用）
export {
  _createStaticEl,
  _createEl,
  _createSvgEl,
  _createFragment,
  _createComp,
  _createCompPure,
  _cloneHoisted,
  _reactiveText,
  _reactiveTemplate,
} from './internal';
