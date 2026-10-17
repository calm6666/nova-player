/**
 * ============================================
 * 播放器状态管理 (PlayerStore)
 * ============================================
 * 管理播放器的持久化状态（localStorage）和运行时状态（内存）
 *
 * ========== 持久化存储结构（参考 B站 store.txt）==========
 *
 * nova_player_profile          → JSON 对象，包含：
 *   {
 *     volume: 0.8,              // 音量 (0-1)
 *     isMuted: false,           // 是否静音
 *     playbackRate: 1,          // 播放速度
 *     codecPreferType: 0,       // 编解码器偏好（也单独存一份）
 *     userPreferences: {        // 用户偏好设置
 *       autoplay: false,        //   自动播放
 *       autoQuality: true,      //   自动画质选择
 *       skipOpEd: false,        //   跳过片头片尾
 *       defaultVolume: 0.8,     //   默认音量
 *       defaultPlaybackRate: 1, //   默认播放速度
 *       danmaku: {              //   弹幕偏好
 *         enabled: true,
 *         opacity: 1,
 *         fontSize: 1,
 *         density: "normal",
 *         blockTypes: []
 *       },
 *       subtitle: {             //   字幕偏好
 *         enabled: true,
 *         language: "zh-CN",
 *         fontSize: 1,
 *         opacity: 1,
 *         backgroundOpacity: 0.5
 *       }
 *     }
 *   }
 *
 * nova_player_codec_prefer_type → number  // 独立 key，便于快速读取不必解析整个 profile
 * nova_player_version          → string   // 播放器版本号，用于数据迁移判断
 *
 * ========== 设计对照 B站 store.txt ==========
 *
 * nova_player_profile          ≈ bpx_player_profile
 * nova_player_codec_prefer_type ≈ bilibili_player_codec_prefer_type
 * nova_player_version          ≈ version（在 pcdnzip_prod_36900 对象里）
 *
 * ========== 数据流向 ==========
 *
 * 页面加载 → createPlayerStore()
 *   ├─ 读取 nova_player_profile → 解析 JSON → 合并默认值 → 存入内存
 *   ├─ 读取 nova_player_codec_prefer_type → 覆盖 profile 中的值（独立 key 优先）
 *   └─ 如果 profile 不存在（首次使用）→ 写入默认 profile JSON
 *
 * 用户操作 → store.setVolume(0.5)
 *   ├─ 更新内存中的 persistentState.volume
 *   ├─ 通知所有订阅了 'volume' 的监听器
 *   └─ 将整个 persistentState 写入 nova_player_profile JSON
 */

import type {
  PlayerState,
  PlayerPersistentState,
  PlayerRuntimeState,
  PlayerStore,
  StoreOptions,
  StateListener,
  QualityOption,
  UserPreferences,
  PlayerSettingsFlags,
  DanmakuPersistedSettings,
  SubtitleStyleSettings,
} from './types';

import { PersistentKeyEnum, StateKeyEnum } from './enums';

import {
  defaultPersistentState,
  defaultRuntimeState,
} from './state';

import { BrowserCapabilityDetector } from '@/nova/utils/browserCapabilityDetector';
import { createLogger } from '@/utils';
import { createSafeCall } from '@/error';

const logger = createLogger('PlayerStore');
const safeCall = createSafeCall('PlayerStore');

// ============================================
// 类型守卫工具函数
// ============================================

/**
 * 创建检查 key 是否为对象合法属性的类型谓词
 * 用于替代 Object.keys(obj) as (keyof T)[]
 */
function isKeyOf<T extends object>(obj: T): (key: string) => key is keyof T & string {
  return (key): key is keyof T & string => key in obj;
}

/**
 * 检查值是否为 PlayerPersistentState
 * 验证核心属性的存在性，用于 JSON.parse 后的类型安全
 */
function isPlayerPersistentState(value: unknown): value is PlayerPersistentState {
  return typeof value === 'object' && value !== null &&
    'volume' in value && 'isMuted' in value && 'playbackRate' in value;
}

/**
 * 检查值是否为 Record<string, unknown>（非数组、非 null 的对象）
 */
function isRecordStringUnknown(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ============================================
// localStorage 工具函数
// ============================================

/**
 * 类型谓词：检查值是否为非空的普通对象
 */
function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 安全地从 localStorage 读取并 JSON 解析（带类型守卫）
 * 读取失败或验证不通过时返回 null
 */
function safeGetJSON<T>(key: string, guard: (value: unknown) => value is T): T | null;
/**
 * 安全地从 localStorage 读取并 JSON 解析（无类型守卫）
 * 读取失败时返回 null，成功时返回解析后的对象
 */
function safeGetJSON(key: string): Record<string, unknown> | null;
function safeGetJSON<T>(key: string, guard?: (value: unknown) => value is T): T | Record<string, unknown> | null {
  const result = safeCall.storage(
    () => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (guard && guard(parsed)) {
        return parsed;
      }
      // 无验证器时，仅做基本非空对象检查
      if (isNonNullObject(parsed)) {
        return parsed;
      }
      return null;
    },
    'STORAGE_READ_FAILED',
    `读取 localStorage 失败 (${key})`,
  );
  return result.success ? result.value : null;
}

/**
 * 安全地将值 JSON 序列化后写入 localStorage
 * 写入失败（如配额超限）时输出警告，不抛异常
 */
function safeSetJSON(key: string, value: unknown): void {
  const result = safeCall.storage(
    () => localStorage.setItem(key, JSON.stringify(value)),
    'STORAGE_WRITE_FAILED',
    `写入 localStorage 失败 (${key})`,
  );
  if (!result.success) {
    logger.warn(`写入失败 (${key})`);
  }
}

/**
 * 安全地从 localStorage 读取单个值
 * 自动尝试 JSON.parse，失败返回 null
 */
function safeGetItem(key: string): unknown {
  const result = safeCall.storage(
    () => {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw) as unknown;
    },
    'STORAGE_READ_FAILED',
    `读取 localStorage 失败 (${key})`,
  );
  return result.success ? result.value : null;
}

/**
 * 安全地将单个值写入 localStorage
 */
function safeSetItem(key: string, value: unknown): void {
  safeSetJSON(key, value);
}

/**
 * 安全地从 localStorage 删除 key
 */
function safeRemoveItem(key: string): void {
  safeCall.storage(
    () => localStorage.removeItem(key),
    'STORAGE_REMOVE_FAILED',
    `删除 localStorage 失败 (${key})`,
  );
}

/**
 * 将持久化状态写入主 profile JSON（nova_player_profile）
 * 仅在 persist=true 时执行
 */
function saveProfile(state: PlayerPersistentState): void {
  safeSetJSON(PersistentKeyEnum.profile, state);
}

// ============================================
// 旧格式数据迁移
// ============================================

/**
 * 从旧格式迁移到新的 profile 对象存储
 *
 * 旧格式（v1，已废弃）：单一 key 'hili_player_state' 存储完整状态 JSON（平铺结构）
 * （改名前的历史 key，字面量保留原名以兼容改名前的浏览器数据）
 * 新格式（v2，当前）：nova_player_profile JSON 对象 + nova_player_codec_prefer_type 独立 key
 *
 * 迁移步骤：
 * 1. 读取旧 key 'hili_player_state'
 * 2. 写入新 key 'nova_player_profile'
 * 3. 提取 codecPreferType 到独立 key
 * 4. 删除旧 key
 */
function tryMigrateFromLegacy(): void {
  const result = safeCall.storage(
    () => {
      /** 改名（hili→nova）前的历史 v1 key，保留原名以迁移旧浏览器数据 */
      const legacyKey = 'hili_player_state';
      const legacyData = localStorage.getItem(legacyKey);
      if (!legacyData) return;

      const parsed: unknown = JSON.parse(legacyData);
      if (!isRecordStringUnknown(parsed)) return;

      // 写入新的 profile key
      safeSetJSON(PersistentKeyEnum.profile, parsed);

      // 提取 codecPreferType 到独立 key
      if (typeof parsed.codecPreferType === 'number') {
        safeSetItem(PersistentKeyEnum.codec_prefer_type, parsed.codecPreferType);
      }

      // 删除旧格式数据，避免重复迁移
      safeRemoveItem(legacyKey);
      logger.info('已从旧格式 (hili_player_state) 迁移到新格式 (nova_player_profile)');
    },
    'MIGRATION_FAILED',
    '旧格式迁移失败',
  );
  if (!result.success) {
    logger.warn('旧格式迁移失败');
  }
}

/**
 * 从独立 key 恢复值，覆盖 profile 中的旧数据
 * 独立 key 优先级高于 profile JSON 中的值
 */
function restoreFromIndependentKeys(state: PlayerPersistentState): void {
  // 编解码器偏好
  const codecVal = safeGetItem(PersistentKeyEnum.codec_prefer_type);
  if (typeof codecVal === 'number') {
    state.codecPreferType = codecVal;
  }

  // GPU 渲染器
  const gpuVal = safeGetItem(PersistentKeyEnum.gpu_renderer);
  if (typeof gpuVal === 'string' && gpuVal) {
    state.gpuRenderer = gpuVal;
  }

  // PBP 进度条偏好（各独立 key 优先于 profile 中的值）
  const pbpHeight = safeGetItem(PersistentKeyEnum.pbp_height);
  if (typeof pbpHeight === 'string') state.pbpHeight = pbpHeight;

  const pbpOpacity = safeGetItem(PersistentKeyEnum.pbp_opacity);
  if (typeof pbpOpacity === 'string') state.pbpOpacity = pbpOpacity;

  const pbpPin = safeGetItem(PersistentKeyEnum.pbp_pin);
  if (typeof pbpPin === 'number') state.pbpPin = pbpPin;

  const pbpTheme = safeGetItem(PersistentKeyEnum.pbp_theme);
  if (typeof pbpTheme === 'string') state.pbpTheme = pbpTheme;

  const pbpState = safeGetItem(PersistentKeyEnum.pbp_state);
  if (typeof pbpState === 'number') state.pbpState = pbpState;

  const pbpStateClear = safeGetItem(PersistentKeyEnum.pbp_state_clear);
  if (typeof pbpStateClear === 'number') state.pbpStateClear = pbpStateClear;
}

/**
 * 确保所有 key 都已写入 localStorage
 * 检查每个 key，如果不存在则写入当前内存中的值
 * 保证首次加载和刷新后数据不丢失
 */
function ensureAllKeysInitialized(state: PlayerPersistentState): void {
  // 主 profile JSON
  safeSetJSON(PersistentKeyEnum.profile, state);

  // 独立 key：不存在时才写入，避免覆盖已有数据
  initKey(PersistentKeyEnum.codec_prefer_type,  state.codecPreferType);
  initKey(PersistentKeyEnum.codec_prefer_reset, '1.0.0');
  initKey(PersistentKeyEnum.gpu_renderer,       state.gpuRenderer);
  initKey(PersistentKeyEnum.player_version,     '1.0.0');

  // PBP 进度条偏好独立 key
  initKey(PersistentKeyEnum.pbp_height,       state.pbpHeight);
  initKey(PersistentKeyEnum.pbp_opacity,      state.pbpOpacity);
  initKey(PersistentKeyEnum.pbp_pin,          state.pbpPin);
  initKey(PersistentKeyEnum.pbp_theme,        state.pbpTheme);
  initKey(PersistentKeyEnum.pbp_version,      state.pbpVersion);
  initKey(PersistentKeyEnum.pbp_state,        state.pbpState);
  initKey(PersistentKeyEnum.pbp_state_clear,  state.pbpStateClear);
}

/**
 * 如果 key 不存在则写入，存在则跳过
 * SSR 安全：服务端环境下 localStorage 不存在，直接跳过
 */
function initKey(key: string, defaultValue: unknown): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(key) === null) {
    safeSetItem(key, defaultValue);
  }
}

// ============================================
// Store 实现
// ============================================

/**
 * 创建播放器 Store 实例
 *
 * 每个 VideoPlayer 实例应创建独立的 Store
 * 也可通过 usePlayerStore() 获取全局单例
 *
 * @param options - Store 配置选项
 * @param options.persist - 是否启用持久化（默认 true）
 * @param options.persistKey - 持久化主 key（默认 PersistentKeyEnum.profile）
 * @returns PlayerStore 实例
 *
 * @example
 * // 创建独立 Store
 * const store = createPlayerStore({ persist: true });
 *
 * @example
 * // 获取全局单例
 * const store = usePlayerStore();
 */
export function createPlayerStore(options: StoreOptions = {}): PlayerStore {
  const { persist = true } = options;
  const persistKey = options.persistKey ?? PersistentKeyEnum.profile;

  // -------- 从 localStorage 恢复持久化状态 --------

  let persistentState: PlayerPersistentState;

  /**
   * localStorage 中是否已存在用户持久化数据（profile 曾被写入过）
   * 「持久化优先」语义的判定依据：存在 → 持久化值优先于外部传入的
   * 默认配置；不存在（首次使用）→ 外部传入值兜底 store 默认值
   */
  let hasSavedProfile = false;

  if (persist) {
    // 先尝试旧格式迁移（只执行一次，迁移后删除旧数据）
    tryMigrateFromLegacy();

    // 读取主 profile JSON
    const saved = safeGetJSON(persistKey, isPlayerPersistentState);

    if (saved) {
      // 标记存在已持久化数据（持久化优先语义的判定依据）
      hasSavedProfile = true;
      // 有已存储的数据：合并默认值（确保新增字段有默认值）；
      // 嵌套对象逐个深合并，避免旧版本 profile 缺新字段时整组覆盖丢失
      persistentState = {
        ...defaultPersistentState,
        ...saved,
        userPreferences: {
          ...defaultPersistentState.userPreferences,
          ...(saved.userPreferences || {}),
        },
        settings: {
          ...defaultPersistentState.settings,
          ...(saved.settings || {}),
        },
        danmakuSettings: {
          ...defaultPersistentState.danmakuSettings,
          ...(saved.danmakuSettings || {}),
        },
        subtitleStyle: {
          ...defaultPersistentState.subtitleStyle,
          ...(saved.subtitleStyle || {}),
        },
      };

      // 独立 key 优先覆盖 profile 中的值
      restoreFromIndependentKeys(persistentState);
    } else {
      // 首次使用：使用默认值
      persistentState = { ...defaultPersistentState };
    }

    // 写入所有还未持久化的 key，确保刷新后不丢失
    ensureAllKeysInitialized(persistentState);

    // 检测 GPU 渲染器（参照 store.txt: bilibili_player_gpu_renderer）
    // 如果内存中为空，说明是首次使用或浏览器变更，进行实时检测
    if (!persistentState.gpuRenderer) {
      const hw = BrowserCapabilityDetector.getHardwareInfo();
      if (hw.webglRenderer) {
        persistentState.gpuRenderer = hw.webglRenderer;
        safeSetItem(PersistentKeyEnum.gpu_renderer, hw.webglRenderer);
        saveProfile(persistentState);
      }
    }
  } else {
    // 不持久化模式（如 SSR 环境或测试环境）
    persistentState = { ...defaultPersistentState };
  }

  // -------- 运行时状态（仅内存，不持久化）--------

  let runtimeState: PlayerRuntimeState = { ...defaultRuntimeState };

  // 监听器映射表：stateKey → Set<listener>
  const listeners = new Map<string, Set<StateListener<unknown>>>();

  /**
   * 通知所有订阅了指定 key 的监听器
   * 遍历 key 对应的 Set，依次调用每个监听器
   */
  const notify = <T>(key: string, newVal: T, oldVal: T): void => {
    const keyListeners = listeners.get(key);
    if (keyListeners) {
      keyListeners.forEach(fn => {
        try { fn(newVal, oldVal); } catch (e) { logger.error('监听器异常:', e); }
      });
    }
  };

  // ============================================
  // Store 实例
  // ============================================

  const store: PlayerStore = {
    // --------------------------------
    // 状态获取
    // --------------------------------

    /** 获取持久化状态的深拷贝 */
    getPersistentState(): PlayerPersistentState {
      return { ...persistentState };
    },

    /** 获取运行时状态的深拷贝 */
    getRuntimeState(): PlayerRuntimeState {
      return { ...runtimeState };
    },

    /** 获取完整状态（持久化 + 运行时合并） */
    getState(): PlayerState {
      return { ...persistentState, ...runtimeState };
    },

    // --------------------------------
    // 持久化状态操作（修改后自动保存到 localStorage）
    // --------------------------------

    /**
     * 设置音量
     * 限制范围 0-1，变更后自动持久化
     */
    setVolume(volume: number): void {
      const oldVal = persistentState.volume;
      const newVal = Math.max(0, Math.min(1, volume));
      if (oldVal === newVal) return;
      persistentState = { ...persistentState, volume: newVal };
      notify(StateKeyEnum.volume, newVal, oldVal);
      saveProfile(persistentState);
    },

    /**
     * 设置静音状态
     */
    setMuted(muted: boolean): void {
      const oldVal = persistentState.isMuted;
      if (oldVal === muted) return;
      persistentState = { ...persistentState, isMuted: muted };
      notify(StateKeyEnum.is_muted, muted, oldVal);
      saveProfile(persistentState);
    },

    /**
     * 设置播放速度
     */
    setPlaybackRate(rate: number): void {
      const oldVal = persistentState.playbackRate;
      if (oldVal === rate) return;
      persistentState = { ...persistentState, playbackRate: rate };
      notify(StateKeyEnum.playback_rate, rate, oldVal);
      saveProfile(persistentState);
    },

    /**
     * 设置编解码器偏好类型
     * 同时写入 profile JSON 和独立 key（便于外部快速读取）
     */
    setCodecPreferType(type: number): void {
      const oldVal = persistentState.codecPreferType;
      if (oldVal === type) return;
      persistentState = { ...persistentState, codecPreferType: type };
      notify(StateKeyEnum.codec_prefer_type, type, oldVal);
      // 双写：profile JSON + 独立 key
      safeSetItem(PersistentKeyEnum.codec_prefer_type, type);
      saveProfile(persistentState);
    },

    /**
     * 设置音量均衡模式（0 关闭 / 1 标准 / 2 高动态）
     * 写入 profile JSON；播放器刷新/重建后按此值恢复音效链状态
     */
    setLoudness(mode: number): void {
      const oldVal = persistentState.loudness;
      if (oldVal === mode) return;
      persistentState = { ...persistentState, loudness: mode };
      notify(StateKeyEnum.loudness, mode, oldVal);
      saveProfile(persistentState);
    },

    /**
     * 是否存在已持久化的用户数据
     * 「持久化优先」语义的判定依据（见 hasSavedProfile 注释）
     */
    hasPersistedData(): boolean {
      return hasSavedProfile;
    },

    /**
     * 设置面板开关项增量合并持久化
     * （镜像/循环/自动开播/关灯/播完暂停——用户可打开/关闭的全部项）
     */
    updateSettingsFlags(flags: Partial<PlayerSettingsFlags>): void {
      const oldVal = persistentState.settings;
      const merged = { ...oldVal, ...flags };
      persistentState = { ...persistentState, settings: merged };
      notify(StateKeyEnum.settings_flags, merged, oldVal);
      saveProfile(persistentState);
    },

    /** 画面比例持久化（"0:0" 自适应） */
    setAspect(aspect: string): void {
      const oldVal = persistentState.aspect;
      if (oldVal === aspect) return;
      persistentState = { ...persistentState, aspect };
      notify(StateKeyEnum.aspect, aspect, oldVal);
      saveProfile(persistentState);
    },

    /**
     * 弹幕设置增量合并持久化（弹幕面板全部可调项：
     * 开关/不透明度/速度/显示区域/字号/随屏幕缩放）
     */
    updateDanmakuSettings(patch: Partial<DanmakuPersistedSettings>): void {
      const merged = { ...persistentState.danmakuSettings, ...patch };
      const oldVal = persistentState.danmakuSettings;
      persistentState = { ...persistentState, danmakuSettings: merged };
      notify(StateKeyEnum.danmaku_settings, merged, oldVal);
      saveProfile(persistentState);
    },

    /**
     * 字幕样式增量 patch 持久化（只带变化字段，合并到既有样式对象；
     * 刷新/重建后经构造期合并恢复到字幕菜单初值 + 挂载期应用到字幕插件）
     */
    updateSubtitleStyle(patch: Partial<SubtitleStyleSettings>): void {
      const merged = { ...persistentState.subtitleStyle, ...patch };
      const oldVal = persistentState.subtitleStyle;
      persistentState = { ...persistentState, subtitleStyle: merged };
      notify(StateKeyEnum.subtitle_style, merged, oldVal);
      saveProfile(persistentState);
    },

    /**
     * 批量更新用户偏好设置（自动播放、跳过片头片尾等通用设置）
     * 弹幕/字幕偏好由各插件自己管理
     */
    updateUserPreferences(preferences: Partial<UserPreferences>): void {
      const oldVal = persistentState.userPreferences;
      persistentState = {
        ...persistentState,
        userPreferences: { ...oldVal, ...preferences },
      };
      notify(StateKeyEnum.skip_op_ed, persistentState.userPreferences, oldVal);
      saveProfile(persistentState);
    },

    // ---------- 进度条偏好 (PBP) ----------

    setPbpHeight(height: string): void {
      const oldVal = persistentState.pbpHeight;
      if (oldVal === height) return;
      persistentState = { ...persistentState, pbpHeight: height };
      notify(StateKeyEnum.pbp_height, height, oldVal);
      safeSetItem(PersistentKeyEnum.pbp_height, height);
      saveProfile(persistentState);
    },

    setPbpOpacity(opacity: string): void {
      const oldVal = persistentState.pbpOpacity;
      if (oldVal === opacity) return;
      persistentState = { ...persistentState, pbpOpacity: opacity };
      notify(StateKeyEnum.pbp_opacity, opacity, oldVal);
      safeSetItem(PersistentKeyEnum.pbp_opacity, opacity);
      saveProfile(persistentState);
    },

    setPbpPin(pin: number): void {
      const oldVal = persistentState.pbpPin;
      if (oldVal === pin) return;
      persistentState = { ...persistentState, pbpPin: pin };
      notify(StateKeyEnum.pbp_pin, pin, oldVal);
      safeSetItem(PersistentKeyEnum.pbp_pin, pin);
      saveProfile(persistentState);
    },

    setPbpTheme(theme: string): void {
      const oldVal = persistentState.pbpTheme;
      if (oldVal === theme) return;
      persistentState = { ...persistentState, pbpTheme: theme };
      notify(StateKeyEnum.pbp_theme, theme, oldVal);
      safeSetItem(PersistentKeyEnum.pbp_theme, theme);
      saveProfile(persistentState);
    },

    setPbpState(state: number): void {
      const oldVal = persistentState.pbpState;
      if (oldVal === state) return;
      persistentState = { ...persistentState, pbpState: state };
      notify(StateKeyEnum.pbp_state, state, oldVal);
      safeSetItem(PersistentKeyEnum.pbp_state, state);
      saveProfile(persistentState);
    },

    setPbpStateClear(clear: number): void {
      const oldVal = persistentState.pbpStateClear;
      if (oldVal === clear) return;
      persistentState = { ...persistentState, pbpStateClear: clear };
      notify(StateKeyEnum.pbp_state_clear, clear, oldVal);
      safeSetItem(PersistentKeyEnum.pbp_state_clear, clear);
      saveProfile(persistentState);
    },

    // ---------- 系统信息 ----------

    setGpuRenderer(renderer: string): void {
      const oldVal = persistentState.gpuRenderer;
      if (oldVal === renderer) return;
      persistentState = { ...persistentState, gpuRenderer: renderer };
      notify(StateKeyEnum.gpu_renderer, renderer, oldVal);
      safeSetItem(PersistentKeyEnum.gpu_renderer, renderer);
      saveProfile(persistentState);
    },

    setMaxVideoQn(qn: number): void {
      const oldVal = persistentState.maxVideoQn;
      if (oldVal === qn) return;
      persistentState = { ...persistentState, maxVideoQn: qn };
      notify(StateKeyEnum.max_video_qn, qn, oldVal);
      saveProfile(persistentState);
    },

    setMaxAudioQn(qn: number): void {
      const oldVal = persistentState.maxAudioQn;
      if (oldVal === qn) return;
      persistentState = { ...persistentState, maxAudioQn: qn };
      notify(StateKeyEnum.max_audio_qn, qn, oldVal);
      saveProfile(persistentState);
    },

    setIsWideScreen(wide: boolean): void {
      const oldVal = persistentState.isWideScreen;
      if (oldVal === wide) return;
      persistentState = { ...persistentState, isWideScreen: wide };
      notify(StateKeyEnum.is_wide_screen, wide, oldVal);
      saveProfile(persistentState);
    },

    // --------------------------------
    // 运行时状态操作（仅内存，不持久化）
    // --------------------------------

    setPlaying(playing: boolean): void {
      const oldVal = runtimeState.isPlaying;
      if (oldVal === playing) return;
      runtimeState = { ...runtimeState, isPlaying: playing };
      notify(StateKeyEnum.is_playing, playing, oldVal);
    },

    setPaused(paused: boolean): void {
      const oldVal = runtimeState.isPaused;
      if (oldVal === paused) return;
      runtimeState = { ...runtimeState, isPaused: paused };
      notify(StateKeyEnum.is_paused, paused, oldVal);
    },

    setLoading(loading: boolean): void {
      const oldVal = runtimeState.isLoading;
      if (oldVal === loading) return;
      runtimeState = { ...runtimeState, isLoading: loading };
      notify(StateKeyEnum.is_loading, loading, oldVal);
    },

    setEnded(ended: boolean): void {
      const oldVal = runtimeState.isEnded;
      if (oldVal === ended) return;
      runtimeState = { ...runtimeState, isEnded: ended };
      notify(StateKeyEnum.is_ended, ended, oldVal);
    },

    setWaiting(waiting: boolean): void {
      const oldVal = runtimeState.isWaiting;
      if (oldVal === waiting) return;
      runtimeState = { ...runtimeState, isWaiting: waiting };
      notify(StateKeyEnum.is_waiting, waiting, oldVal);
    },

    setDuration(duration: number): void {
      const oldVal = runtimeState.duration;
      if (oldVal === duration) return;
      runtimeState = { ...runtimeState, duration };
      notify(StateKeyEnum.duration, duration, oldVal);
    },

    setBuffered(buffered: number): void {
      const oldVal = runtimeState.buffered;
      if (oldVal === buffered) return;
      runtimeState = { ...runtimeState, buffered };
      notify(StateKeyEnum.buffered, buffered, oldVal);
    },

    setQuality(qn: number): void {
      const oldVal = runtimeState.currentQuality;
      if (oldVal === qn) return;
      runtimeState = { ...runtimeState, currentQuality: qn };
      notify(StateKeyEnum.current_quality, qn, oldVal);
    },

    setAudioQuality(qn: number): void {
      const oldVal = runtimeState.currentAudioQuality;
      if (oldVal === qn) return;
      runtimeState = { ...runtimeState, currentAudioQuality: qn };
      notify(StateKeyEnum.current_audio_quality, qn, oldVal);
    },

    setAvailableQualities(qualities: QualityOption[]): void {
      runtimeState = { ...runtimeState, availableQualities: qualities };
      notify(StateKeyEnum.available_qualities, qualities, []);
    },

    setScreenMode(mode: PlayerRuntimeState['screenMode']): void {
      const oldVal = runtimeState.screenMode;
      if (oldVal === mode) return;
      runtimeState = { ...runtimeState, screenMode: mode };
      notify(StateKeyEnum.screen_mode, mode, oldVal);
    },

    setPip(pip: boolean): void {
      const oldVal = runtimeState.isPip;
      if (oldVal === pip) return;
      runtimeState = { ...runtimeState, isPip: pip };
      notify(StateKeyEnum.is_pip, pip, oldVal);
    },

    // --------------------------------
    // 批量更新运行时状态
    // --------------------------------

    batchUpdateRuntime(updates: Partial<PlayerRuntimeState>): void {
      const changedKeys: (keyof PlayerRuntimeState)[] = [];
      const oldValues = new Map<keyof PlayerRuntimeState, unknown>();
      Object.keys(updates).filter(isKeyOf(runtimeState)).forEach(key => {
        const newVal = updates[key];
        const oldVal = runtimeState[key];
        if (newVal !== undefined && newVal !== oldVal) {
          oldValues.set(key, oldVal);
          changedKeys.push(key);
        }
      });
      if (changedKeys.length === 0) return;
      runtimeState = { ...runtimeState, ...updates };
      changedKeys.forEach(key => {
        notify(key, runtimeState[key], oldValues.get(key));
      });
    },

    // --------------------------------
    // 订阅
    // --------------------------------

    /**
     * 订阅状态变更
     * 当指定 key 的状态变化时，listener 会被调用
     *
     * @param key - 状态键名（如 'volume', 'is_playing'）
     * @param listener - 变更回调 (newVal, oldVal) => void
     * @returns 取消订阅的函数
     */
    subscribe<K extends keyof PlayerState>(key: K, listener: StateListener<PlayerState[K]>): () => void {
      const keyStr = String(key);
      // 包装监听器以适配统一的 StateListener<unknown> 存储
      // 类型安全由 subscribe 的泛型约束保证：key 与 listener 的类型参数一致
      const wrappedListener: StateListener<unknown> = (newVal, oldVal) => {
        // 泛型 K 约束保证 key 与 listener 类型一致，as 还原由泛型保证安全
        listener(newVal as PlayerState[K], oldVal as PlayerState[K]);
      };
      if (!listeners.has(keyStr)) listeners.set(keyStr, new Set());
      listeners.get(keyStr)!.add(wrappedListener);
      return () => { listeners.get(keyStr)?.delete(wrappedListener); };
    },

    // --------------------------------
    // 重置
    // --------------------------------

    /** 重置运行时状态为默认值（不影响持久化数据） */
    resetRuntime(): void {
      runtimeState = { ...defaultRuntimeState };
      Object.keys(defaultRuntimeState).filter(isKeyOf(defaultRuntimeState)).forEach(key => {
        notify(key, defaultRuntimeState[key], undefined);
      });
    },

    /** 重置所有状态（包括清除 localStorage） */
    resetAll(): void {
      this.resetRuntime();
      persistentState = { ...defaultPersistentState };
      // 清除所有 localStorage 中的播放器数据
      safeRemoveItem(PersistentKeyEnum.profile);
      safeRemoveItem(PersistentKeyEnum.codec_prefer_type);
      safeRemoveItem(PersistentKeyEnum.codec_prefer_reset);
      safeRemoveItem(PersistentKeyEnum.gpu_renderer);
      safeRemoveItem(PersistentKeyEnum.playback_info);
      safeRemoveItem(PersistentKeyEnum.player_version);
      safeRemoveItem(PersistentKeyEnum.pbp_height);
      safeRemoveItem(PersistentKeyEnum.pbp_opacity);
      safeRemoveItem(PersistentKeyEnum.pbp_pin);
      safeRemoveItem(PersistentKeyEnum.pbp_theme);
      safeRemoveItem(PersistentKeyEnum.pbp_version);
      safeRemoveItem(PersistentKeyEnum.pbp_state);
      safeRemoveItem(PersistentKeyEnum.pbp_state_clear);
      // 重新写入默认值
      saveProfile(persistentState);
      safeSetItem(PersistentKeyEnum.codec_prefer_type, persistentState.codecPreferType);
      Object.keys(defaultPersistentState).filter(isKeyOf(defaultPersistentState)).forEach(key => {
        notify(key, defaultPersistentState[key], undefined);
      });
    },
  };

  return store;
}

// ============================================
// 单例导出
// ============================================

/** 全局 Store 单例 */
let playerStore: PlayerStore | null = null;

/**
 * 获取播放器 Store 实例（单例模式）
 * 整个应用共享同一个 Store 实例
 */
export function usePlayerStore(): PlayerStore {
  if (!playerStore) {
    playerStore = createPlayerStore();
  }
  return playerStore;
}

/**
 * 重置 Store 实例（用于测试或重新初始化）
 */
export function resetPlayerStore(): void {
  playerStore = null;
}

export default usePlayerStore;
