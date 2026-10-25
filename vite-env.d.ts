/// <reference types="vite/client" />

// SCSS 文件作为 side-effect import
declare module '*.scss' {
  const content: Record<string, string>;
  export default content;
}

// SCSS 以 ?inline 后缀导入（插件运行时注入样式，如 SubtitlePlugin/TopPlugin）
declare module '*.scss?inline' {
  const css: string;
  export default css;
}

// ?url 后缀导入（资源转 URL，如 @mediapipe 的 wasm 加载器）
declare module '*?url' {
  const url: string;
  export default url;
}

// 图片资源声明
declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.webp' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.jpeg' {
  const src: string;
  export default src;
}

declare module '*.gif' {
  const src: string;
  export default src;
}