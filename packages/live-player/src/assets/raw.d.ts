/** Vite `?raw` 导入声明：把 SVG 文件作为字符串引入。 */
declare module '*.svg?raw' {
  const content: string;
  export default content;
}
