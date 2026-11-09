/**
 * SVG 标签集合（编译期使用）
 *
 * ★ 单一数据源：直接从 core/h.ts 再导出，
 * 避免与运行时 SVG_TAGS 双份维护导致漂移。
 */
export { SVG_TAGS } from "../../packages/framework/src/core/h";
