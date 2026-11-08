/**
 * 右侧控制栏悬停/状态动画 JSON 聚合模块（合计 ~730KB）：
 *
 * 6 个动画 JSON 若逐个动态 import，会拆成 6 个独立 chunk 与 6 个独立
 * 网络请求，数据逐个到达导致控制栏图标动画先后出现、观感割裂；
 * 聚合为单一模块后构建产物仅 1 个 chunk，运行时仅 1 个请求，
 * 全部动画数据同批就绪，图标在同一时刻完成渲染。
 *
 * 模块整体仍通过消费侧单一动态 import 加载，处于播放器主包
 * 关键路径之外，不增加主包体积。
 */
import webFullscreenAnimationData from "../assets/lottie-icon/web-fullscreen-animation.json";
import webExitFullscreenAnimationData from "../assets/lottie-icon/web-exit-fullscreen-animation.json";
import wideHoverAnimationData from "../assets/lottie-icon/wide-hover-animation.json";
import wideExitHoverAnimationData from "../assets/lottie-icon/wide-exit-hover-animation.json";
import pipHoverAnimationData from "../assets/lottie-icon/pip-hover-animation.json";
import pipExitHoverAnimationData from "../assets/lottie-icon/pip-exit-hover-animation.json";

/** 动画 JSON 聚合映射：键与各 LottieIcon 槽位一一对应 */
export interface IconAnimationDataMap {
  webFullscreen: Record<string, unknown>;
  webExitFullscreen: Record<string, unknown>;
  wideHover: Record<string, unknown>;
  wideExitHover: Record<string, unknown>;
  pipHover: Record<string, unknown>;
  pipExitHover: Record<string, unknown>;
}

/** 6 个动画数据的聚合对象 */
export const iconAnimations: IconAnimationDataMap = {
  webFullscreen: webFullscreenAnimationData,
  webExitFullscreen: webExitFullscreenAnimationData,
  wideHover: wideHoverAnimationData,
  wideExitHover: wideExitHoverAnimationData,
  pipHover: pipHoverAnimationData,
  pipExitHover: pipExitHoverAnimationData,
};
