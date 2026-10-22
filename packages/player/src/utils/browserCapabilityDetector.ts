// browser-capability-detector.ts
import { createLogger } from '@/utils';
const logger = createLogger('BrowserDetector');

/**
 * 解码能力信息接口
 * 描述特定编码配置在浏览器中的解码性能
 */
interface DecodingCapabilityInfo {
  /** 是否支持此编码配置 */
  supported: boolean;
  /** 播放是否流畅 */
  smooth: boolean;
  /** 是否省电（通常意味着使用了硬件解码） */
  powerEfficient: boolean;
}

/**
 * 硬件设备信息接口
 * 包含从WebGL/WebGPU等API获取的GPU相关信息
 */
interface HardwareDeviceInfo {
  /** 是否支持WebGPU（现代GPU访问API） */
  webgpuSupported: boolean;
  /** 是否支持WebGL（基础GPU访问API） */
  webglSupported: boolean;
  /** WebGL渲染器信息字符串，包含GPU型号和驱动信息 */
  webglRenderer: string | null;
  /** WebGL供应商信息 */
  webglVendor: string | null;
  /** 是否为独立显卡（基于渲染器字符串的启发式判断） */
  isDiscreteGPU: boolean | null;
}

/**
 * 浏览器综合能力检测结果接口
 */
interface BrowserCapabilityResult {
  /** 浏览器名称 */
  browserName: string;
  /** 浏览器版本 */
  browserVersion: string;
  /** 浏览器是否为Safari */
  isSafari: boolean;
  /** 是否为iOS系统（包括iPadOS） */
  isIOS: boolean;
  /** 是否为macOS系统 */
  isMacOS: boolean;
  /** 操作系统名称 */
  osName: string;
  /** 操作系统版本 */
  osVersion: string;
  /** 是否支持Media Source Extensions（DASH和flv.js的基础） */
  mseSupported: boolean;
  /** 是否支持DASH协议（基于MSE） */
  dashSupported: boolean;
  /** 是否支持flv.js（基于MSE） */
  flvjsSupported: boolean;
  /** 硬件设备信息 */
  hardwareInfo: HardwareDeviceInfo;
  /** 是否支持 hls.js（基于 MSE 且非 iOS） */
  hlsjsSupported: boolean;
  /** hls.js 支持的详细说明 */
  hlsjsSupportDetail: string;
  /** 是否支持 Hi-Res 无损音频解码（FLAC/ALAC） */
  hiResSupported: boolean;
  /** Hi-Res 能力说明 */
  hiResSupportDetail: string;
}

interface NavigatorUABrandVersion {
  readonly brand: string;
  readonly version: string;
}

interface NavigatorUAData {
  readonly brands: NavigatorUABrandVersion[];
  readonly mobile: boolean;
  readonly platform: string;
  getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>>;
}

/**
 * 浏览器能力检测工具类
 *
 * 本工具提供全面的浏览器兼容性检测能力，支持所有主流浏览器。
 * 对于不支持的API会自动降级，确保在任何环境下都能正常运行。
 */
class BrowserCapabilityDetector {
  /**
   * 检测浏览器是否为Safari
   *
   * 采用三层检测机制，按优先级依次尝试：
   * 1. 现代API：User-Agent Client Hints（最准确）
   * 2. 特性检测：检查Safari特有属性（如ApplePay）
   * 3. 降级方案：User-Agent字符串嗅探（兜底）
   *
   * 注意：iOS上的所有浏览器（包括Chrome、Firefox）都使用WebKit内核，
   * 因此某些特性检测可能无法区分Safari和其他iOS浏览器。
   *
   * @returns 是否为Safari浏览器
   */
  static isSafari(): boolean {
    // 方案1：尝试使用现代的User-Agent Client Hints API
    if ('userAgentData' in navigator) {
      const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
      // 检查brands中是否包含Safari品牌信息
      if (uaData && uaData.brands) {
        const hasSafariBrand = uaData.brands.some(
          (brand: { brand: string; version: string }) => brand.brand === 'Safari'
        );
        if (hasSafariBrand) {
          return true;
        }
      }
    }

    // 方案2：特性检测 - 检查Safari特有的API
    // ApplePay是Safari的独有API，其他浏览器即使支持WebKit也不具备
    if (typeof window !== 'undefined' && 'ApplePayError' in window) {
      return true;
    }

    // 方案3：降级方案 - 使用User-Agent字符串嗅探
    const ua = navigator.userAgent;
    // 排除Chrome（Safari的UA中包含"Chrome"但必然同时包含"Safari"，而Chrome不包含"Safari"）
    // 同时排除Edge和Opera等伪装成Chrome的浏览器
    const isNonSafariChromium = /Chrome|Edg|OPR|CriOS/i.test(ua) && !/Safari/i.test(ua);
    if (isNonSafariChromium) {
      return false;
    }
    // 检测Safari特征：包含Safari且不包含Chrome，或包含Version（移动端Safari）
    return /Safari/i.test(ua) && (!/Chrome/i.test(ua) || /Version\/.*Safari/i.test(ua));
  }

  /**
   * 检测当前操作系统是否为iOS（包括iPadOS）
   *
   * iOS系统限制：
   * - 不支持Media Source Extensions (MSE)
   * - 因此不支持dash.js和flv.js
   * - 原生支持HLS协议
   *
   * @returns 是否为iOS系统
   */
  static isIOS(): boolean {
    const ua = navigator.userAgent;
    // iPadOS 13+ 的UA伪装成macOS，需要额外检测触摸点数量来区分
    const isIPadOS = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
    return /iPhone|iPad|iPod/i.test(ua) || isIPadOS;
  }

  /**
   * 检测当前操作系统是否为macOS
   *
   * macOS桌面端Safari 8.0+支持MSE，理论上可以使用dash.js和flv.js。
   * 但需要排除iPadOS伪装成macOS的情况。
   *
   * @returns 是否为macOS系统
   */
  static isMacOS(): boolean {
    const ua = navigator.userAgent;
    // 排除iPadOS伪装
    if (this.isIOS()) {
      return false;
    }
    return /Macintosh|Mac OS X/i.test(ua);
  }

  /**
   * 检测浏览器是否支持Media Source Extensions (MSE)
   *
   * MSE是dash.js和flv.js等JS播放器库的基础API。
   * iOS上的所有浏览器均不支持MSE，因此这些库在iOS上无法工作。
   *
   * @returns 是否支持MSE
   */
  static isMSESupported(): boolean {
    // 检查MediaSource构造函数是否存在
    if (typeof MediaSource === 'undefined') {
      return false;
    }

    // 额外检查：尝试创建MediaSource对象，某些浏览器可能声明了构造函数但无法使用
    try {
      new MediaSource();
      return true;
    } catch (_e) {
      return false;
    }
  }

  /**
   * 检测是否支持DASH协议
   *
   * DASH（Dynamic Adaptive Streaming over HTTP）是一种自适应比特率流媒体协议。
   * 浏览器原生不支持DASH，必须通过dash.js等JS库实现。
   * dash.js依赖于MSE，因此检测DASH支持等同于检测MSE支持。
   *
   * 注意：macOS Safari 8.0+支持MSE，但存在部分兼容性问题（如同分辨率码率切换bug）。
   *
   * @returns 是否支持DASH协议（基于MSE）
   */
  static isDASHSupported(): boolean {
    // DASH播放完全依赖MSE，无MSE则无法使用dash.js
    return this.isMSESupported();
  }

  /**
   * 检测是否支持flv.js
   *
   * flv.js通过将FLV流转换为fMP4片段，再通过MSE喂给video标签来实现播放。
   * 因此其兼容性完全取决于MSE。
   *
   * 注意事项：
   * - iOS Safari完全不支持（无MSE）
   * - macOS Safari 10+支持MSE，理论上可用，但需充分测试
   * - 某些浏览器（如旧版Edge）可能存在MP3音频编解码器兼容性问题
   *
   * @returns 是否支持flv.js
   */
  static isFlvjsSupported(): boolean {
    // flv.js依赖MSE，同时需要基本的ES5特性（现代浏览器都满足）
    return this.isMSESupported();
  }

  /**
   * 获取硬件设备信息
   *
   * 通过WebGPU和WebGL API探测GPU硬件信息。
   *
   * WebGPU：现代GPU访问API，Chrome 113+、Edge 113+、Safari（实验性）支持。
   * WebGL：基础GPU访问API，几乎所有现代浏览器都支持，作为降级方案。
   *
   * @returns 硬件设备信息对象
   */
  static getHardwareInfo(): HardwareDeviceInfo {
    const info: HardwareDeviceInfo = {
      webgpuSupported: false,
      webglSupported: false,
      webglRenderer: null,
      webglVendor: null,
      isDiscreteGPU: null,
    };

    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
      info.webgpuSupported = true;
    }

    if (typeof document === 'undefined') return info;

    try {
      const canvas = document.createElement('canvas');
      const gl =
        canvas.getContext('webgl2') ||
        canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl');

      // 使用类型守卫检查 gl 是否包含 getExtension 方法
      if (gl && 'getExtension' in gl) {
        info.webglSupported = true;

        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          info.webglRenderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
          info.webglVendor = String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL));
        }

        if (info.webglRenderer) {
          const rendererLower = info.webglRenderer.toLowerCase();
          const integratedKeywords = [
            'intel',
            'iris',
            'uhd',
            'hd graphics',
            'radeon vega',
            'adreno',
            'mali',
            'powervr',
            'apple',
          ];
          const hasIntegratedKeyword = integratedKeywords.some((keyword) =>
            rendererLower.includes(keyword)
          );
          info.isDiscreteGPU = !hasIntegratedKeyword;
        }
      }
    } catch (e) {
      logger.warn('WebGL detection failed:', e);
    }

    return info;
  }

  /**
   * 检测特定视频编码配置的解码能力
   *
   * 使用Media Capabilities API的decodingInfo方法，这是目前最准确的解码能力检测方式。
   * 不仅能判断是否支持，还能评估播放流畅度和是否使用硬件解码（powerEfficient）。
   *
   * 降级策略：
   * 1. 优先使用Media Capabilities API（Chrome 66+、Edge 79+、Safari 13+）
   * 2. 降级使用canPlayType（兼容性最好，但信息粗略）
   * 3. 最终返回默认的不支持状态
   *
   * @param codecString - 编码字符串，如 'video/mp4; codecs="avc1.42E01E"'
   * @param width - 视频宽度（可选，用于性能评估）
   * @param height - 视频高度（可选，用于性能评估）
   * @returns Promise，解析为解码能力信息
   */
  static async checkDecodingCapability(
    codecString: string,
    width: number = 1920,
    height: number = 1080
  ): Promise<DecodingCapabilityInfo> {
    const defaultResult: DecodingCapabilityInfo = {
      supported: false,
      smooth: false,
      powerEfficient: false,
    };

    // 方案1：优先使用Media Capabilities API（最准确）
    if ('mediaCapabilities' in navigator) {
      try {
        const config: MediaDecodingConfiguration = {
          type: 'file', // 也可以是 'media-source' 或 'webrtc'
          video: {
            contentType: codecString,
            width: width,
            height: height,
            bitrate: 5000000, // 5 Mbps，典型高清视频码率
            framerate: 30,
          },
        };

        const result = await navigator.mediaCapabilities.decodingInfo(config);
        return {
          supported: result.supported,
          smooth: result.smooth,
          powerEfficient: result.powerEfficient,
        };
      } catch (e) {
        logger.warn('Media Capabilities API call failed, falling back to canPlayType:', e);
      }
    }

    // 方案2：降级使用 canPlayType
    // 注意：canPlayType 返回 "probably"、"maybe" 或 ""，信息较粗略
    const video = document.createElement('video');
    const canPlayResult = video.canPlayType(codecString);

    if (canPlayResult === 'probably' || canPlayResult === 'maybe') {
      // canPlayType 无法判断流畅度和省电情况，保守估计为 false
      return {
        supported: true,
        smooth: false,
        powerEfficient: false,
      };
    }

    // 方案3：完全不支持
    return defaultResult;
  }

  /**
   * 获取详细的操作系统信息
   *
   * 通过解析 User-Agent 字符串识别主流操作系统。
   * 注意：iPadOS 13+ 会伪装成 macOS，需特殊处理。
   *
   * @returns 包含操作系统名称和版本的对象
   */
  static getOSInfo(): { name: string; version: string } {
    const ua = navigator.userAgent;

    // 特殊处理：iPadOS 13+ 伪装成 macOS，但触摸点数量多
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) {
      return { name: 'iPadOS', version: '13+' };
    }

    // Windows 检测
    if (/Windows NT/i.test(ua)) {
      const versionMatch = ua.match(/Windows NT (\d+\.\d+)/);
      const versionMap: Record<string, string> = {
        '10.0': '10/11',
        '6.3': '8.1',
        '6.2': '8',
        '6.1': '7',
        '6.0': 'Vista',
      };
      const ntVersion = versionMatch ? versionMatch[1] : '';
      const version = versionMap[ntVersion] || ntVersion;
      return { name: 'Windows', version };
    }

    // macOS 检测
    if (/Mac OS X/i.test(ua)) {
      const versionMatch = ua.match(/Mac OS X (\d+[._]\d+[._]?\d*)/);
      const version = versionMatch ? versionMatch[1].replace(/_/g, '.') : '';
      return { name: 'macOS', version };
    }

    // iOS 检测 (iPhone/iPod)
    if (/iPhone|iPod/i.test(ua)) {
      const versionMatch = ua.match(/OS (\d+_\d+_?\d*)/);
      const version = versionMatch ? versionMatch[1].replace(/_/g, '.') : '';
      return { name: 'iOS', version };
    }

    // iPad 检测 (非伪装版本)
    if (/iPad/i.test(ua)) {
      const versionMatch = ua.match(/OS (\d+_\d+_?\d*)/);
      const version = versionMatch ? versionMatch[1].replace(/_/g, '.') : '';
      return { name: 'iPadOS', version };
    }

    // Android 检测
    if (/Android/i.test(ua)) {
      const versionMatch = ua.match(/Android (\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : '';
      return { name: 'Android', version };
    }

    // Linux 检测
    if (/Linux/i.test(ua)) {
      return { name: 'Linux', version: '' };
    }

    // Chrome OS 检测
    if (/CrOS/i.test(ua)) {
      return { name: 'Chrome OS', version: '' };
    }

    return { name: 'Other', version: '' };
  }

  /**
   * 获取详细的浏览器信息
   *
   * 采用多层检测策略：
   * 1. 优先使用 User-Agent Client Hints API（现代浏览器）
   * 2. 降级解析 User-Agent 字符串
   *
   * @returns 包含浏览器名称和版本的对象
   */
  static getBrowserInfo(): { name: string; version: string } {
    // 策略1：尝试使用现代的 User-Agent Client Hints
    if ('userAgentData' in navigator) {
      const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
      if (uaData && uaData.brands && uaData.brands.length > 0) {
        // brands 是一个数组，包含品牌和版本信息
        // 例如：[{brand: "Google Chrome", version: "120"}, {brand: "Chromium", version: "120"}]
        const brands = uaData.brands;

        // 查找主要浏览器品牌
        const chromeBrand = brands.find((b) => b.brand === 'Google Chrome');
        const edgeBrand = brands.find((b) => b.brand === 'Microsoft Edge');
        const operaBrand = brands.find((b) => b.brand === 'Opera');

        if (chromeBrand) {
          return { name: 'Chrome', version: chromeBrand.version };
        }
        if (edgeBrand) {
          return { name: 'Edge', version: edgeBrand.version };
        }
        if (operaBrand) {
          return { name: 'Opera', version: operaBrand.version };
        }

        // 如果没有匹配的已知品牌，使用第一个品牌（通常是 Chromium）
        if (brands.length > 0) {
          // 特殊处理：如果 brands 中包含 Safari，但移动端 UA 也包含，此处不重复判断
          const safariBrand = brands.find((b) => b.brand === 'Safari');
          if (safariBrand) {
            return { name: 'Safari', version: safariBrand.version };
          }
          return { name: brands[0].brand, version: brands[0].version };
        }
      }
    }

    // 策略2：降级解析 User-Agent 字符串
    const ua = navigator.userAgent;

    // 注意：检测顺序很重要，因为很多浏览器会伪装成其他浏览器

    // Edge (基于 Chromium 的新版)
    if (/Edg\//i.test(ua)) {
      const match = ua.match(/Edg\/(\d+\.\d+)/);
      return { name: 'Edge', version: match ? match[1] : '' };
    }

    // Opera / OPR
    if (/OPR\//i.test(ua)) {
      const match = ua.match(/OPR\/(\d+\.\d+)/);
      return { name: 'Opera', version: match ? match[1] : '' };
    }

    // Chrome (需排除 Edge 和 Opera)
    if (/Chrome/i.test(ua) && !/Edg|OPR/i.test(ua)) {
      const match = ua.match(/Chrome\/(\d+\.\d+)/);
      // 但 Safari 的 UA 中也包含 "Chrome"，需进一步排除
      if (/Safari/i.test(ua) && !/Chrome\/[0-9]+/.test(ua)) {
        // 这是 Safari，稍后处理
      } else {
        return { name: 'Chrome', version: match ? match[1] : '' };
      }
    }

    // Firefox
    if (/Firefox/i.test(ua)) {
      const match = ua.match(/Firefox\/(\d+\.\d+)/);
      return { name: 'Firefox', version: match ? match[1] : '' };
    }

    // Safari (需排除 Chrome)
    if (/Safari/i.test(ua) && !/Chrome|CriOS|FxiOS/i.test(ua)) {
      const match = ua.match(/Version\/(\d+\.\d+)/);
      return { name: 'Safari', version: match ? match[1] : '' };
    }

    // iOS 上的 Chrome (CriOS)
    if (/CriOS/i.test(ua)) {
      const match = ua.match(/CriOS\/(\d+\.\d+)/);
      return { name: 'Chrome (iOS)', version: match ? match[1] : '' };
    }

    // iOS 上的 Firefox (FxiOS)
    if (/FxiOS/i.test(ua)) {
      const match = ua.match(/FxiOS\/(\d+\.\d+)/);
      return { name: 'Firefox (iOS)', version: match ? match[1] : '' };
    }

    // 其他或未知浏览器
    return { name: 'Other', version: '' };
  }

  /**
   * 检测 hls.js 的支持情况
   *
   * hls.js 依赖 MSE API。此外，hls.js 在 iOS 上虽然可以加载，但会降级为原生播放，
   * 无法使用其强大的 API 控制功能（如手动切换清晰度）。
   *
   * @returns 包含支持布尔值和详细说明的对象
   */
  static checkHlsjsSupport(): { supported: boolean; detail: string } {
    const mseSupported = this.isMSESupported();
    const isIOS = this.isIOS();
    const isSafari = this.isSafari();
    const browserInfo = this.getBrowserInfo();

    // iOS 上 hls.js 会降级为原生播放器，虽然可以播但功能受限
    if (isIOS) {
      return {
        supported: false,
        detail: 'iOS does not support MSE, hls.js will fall back to native player without fine-grained control',
      };
    }

    // 桌面端 Safari 支持 MSE，但 hls.js 可能存在兼容性问题（如 HE-AAC 音频）
    if (isSafari && !isIOS) {
      return {
        supported: mseSupported,
        detail: mseSupported
          ? 'Desktop Safari supports MSE, hls.js is generally usable, but HE-AAC audio may have issues'
          : 'MSE not supported, hls.js cannot work',
      };
    }

    // 其他浏览器（Chrome、Edge、Firefox 等）
    if (mseSupported) {
      return {
        supported: true,
        detail: `${browserInfo.name} fully supports MSE, hls.js works normally`,
      };
    }

    return {
      supported: false,
      detail: 'Current browser does not support MSE, hls.js cannot be used',
    };
  }

  /**
   * 检测浏览器是否具备 Hi-Res 无损音频解码能力
   *
   * 覆盖原生 canPlayType 与 MSE isTypeSupported（DASH/HLS 的 fMP4 FLAC/ALAC 轨）。
   * 位深/采样率精确能力由 checkHiResDecodingCapability() 补充。
   */
  static checkHiResAudioSupport(): {
    supported: boolean;
    detail: string;
    nativeTypes: string[];
    mseTypes: string[];
  } {
    const probes = [
      'audio/mp4; codecs="flac"',
      'audio/flac',
      'audio/x-flac',
      'audio/mp4; codecs="alac"',
    ];
    const nativeTypes: string[] = [];
    const mseTypes: string[] = [];

    if (typeof document !== 'undefined') {
      const audio = document.createElement('audio');
      for (const type of probes) {
        if (audio.canPlayType(type) !== '') nativeTypes.push(type);
      }
    }

    if (this.isMSESupported()) {
      for (const type of probes) {
        if (MediaSource.isTypeSupported(type)) mseTypes.push(type);
      }
    }

    const supported = nativeTypes.length > 0 || mseTypes.length > 0;
    const detail = supported
      ? `Hi-Res audio supported (native: ${nativeTypes.join(', ') || 'none'}; MSE: ${mseTypes.join(', ') || 'none'})`
      : 'Hi-Res audio not supported (no FLAC/ALAC decoder)';

    return { supported, detail, nativeTypes, mseTypes };
  }

  /**
   * MediaCapabilities 精确检测 24bit/96kHz Hi-Res 音频解码能力
   */
  static async checkHiResDecodingCapability(): Promise<DecodingCapabilityInfo> {
    const fallback = this.checkHiResAudioSupport();
    const defaultResult: DecodingCapabilityInfo = {
      supported: fallback.supported,
      smooth: false,
      powerEfficient: false,
    };
    if (typeof navigator === 'undefined' || !('mediaCapabilities' in navigator)) {
      return defaultResult;
    }
    try {
      const result = await navigator.mediaCapabilities.decodingInfo({
        type: 'media-source',
        audio: {
          contentType: 'audio/mp4; codecs="flac"',
          channels: 2,
          bitrate: 4608000,
          samplerate: 96000,
        },
      } as unknown as MediaDecodingConfiguration);
      return {
        supported: result.supported,
        smooth: result.smooth,
        powerEfficient: result.powerEfficient,
      };
    } catch (e) {
      logger.warn('Hi-Res MediaCapabilities detection failed:', e);
      return defaultResult;
    }
  }

  /**
   * 获取完整的浏览器能力检测结果
   *
   * 执行所有检测并返回综合结果。
   *
   * 使用场景：
   * - 视频播放器初始化前的兼容性检查
   * - 根据检测结果选择合适的播放协议（HLS/DASH/FLV）
   * - 为不支持的浏览器提供友好的降级提示
   *
   * @returns 浏览器综合能力检测结果
   */
  static getFullCapabilityResult(): BrowserCapabilityResult {
    const browserInfo = this.getBrowserInfo();
    const osInfo = this.getOSInfo();
    const hlsjsSupport = this.checkHlsjsSupport();
    const hiResSupport = this.checkHiResAudioSupport();

    return {
      browserName: browserInfo.name,
      browserVersion: browserInfo.version,
      isSafari: this.isSafari(),
      isIOS: this.isIOS(),
      isMacOS: this.isMacOS(),
      osName: osInfo.name,
      osVersion: osInfo.version,
      mseSupported: this.isMSESupported(),
      dashSupported: this.isDASHSupported(),
      flvjsSupported: this.isFlvjsSupported(),
      hlsjsSupported: hlsjsSupport.supported, // 新增
      hlsjsSupportDetail: hlsjsSupport.detail, // 新增
      hiResSupported: hiResSupport.supported,
      hiResSupportDetail: hiResSupport.detail,
      hardwareInfo: this.getHardwareInfo(),
    };
  }

  /**
   * 打印格式化的检测结果到控制台
   *
   * 用于开发调试，输出清晰的能力检测报告。
   */
  static printCapabilityReport(): void {
    const result = this.getFullCapabilityResult();
    const hw = result.hardwareInfo;

    const osDisplay = result.osVersion ? `${result.osName} ${result.osVersion}` : result.osName;

    const browserDisplay = result.browserVersion
      ? `${result.browserName} ${result.browserVersion}`
      : result.browserName;

    logger.info('='.repeat(50));
    logger.info('Browser capability report');
    logger.info('='.repeat(50));
    logger.info(`Browser: ${browserDisplay}`);
    logger.info(`OS: ${osDisplay}`);
    logger.info('-'.repeat(50));
    logger.info('-'.repeat(50));
    logger.info('Streaming protocol support:');
    logger.info(`  • MSE (base): ${result.mseSupported ? 'supported' : 'not supported'}`);
    logger.info(`  • DASH: ${result.dashSupported ? 'supported' : 'not supported'}`);
    logger.info(`  • flv.js: ${result.flvjsSupported ? 'supported' : 'not supported'}`);
    logger.info(
      `  • hls.js: ${result.hlsjsSupported ? 'supported' : 'not supported'} (${result.hlsjsSupportDetail})`
    );
    logger.info('-'.repeat(50));
    logger.info('Hardware info:');
    logger.info(`  • WebGPU: ${hw.webgpuSupported ? 'supported' : 'not supported'}`);
    logger.info(`  • WebGL: ${hw.webglSupported ? 'supported' : 'not supported'}`);
    if (hw.webglRenderer) {
      logger.info(`  • GPU renderer: ${hw.webglRenderer}`);
    }
    if (hw.webglVendor) {
      logger.info(`  • GPU vendor: ${hw.webglVendor}`);
    }
    logger.info(
      `  • Possibly discrete GPU: ${hw.isDiscreteGPU === null ? 'unknown' : hw.isDiscreteGPU ? 'yes' : 'no'}`
    );
    logger.info('='.repeat(50));
  }
}

// 导出供其他模块使用
export { BrowserCapabilityDetector };
export type { DecodingCapabilityInfo, HardwareDeviceInfo, BrowserCapabilityResult };
