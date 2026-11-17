/**
 * vite-plugin-lumina-compile-v2
 *
 * pre 阶段执行，默认全量处理框架 h 文件。
 * v2 自身覆盖静态骨架、文本/属性/事件/ref/内容/指令/子节点洞与 fragment；
 * 静态结构一律编译成骨架（不再回退解释执行 h()），且模板 / SSR / DOM 中
 * 不允许出现任何注释或文本占位节点。
 */
import type { Plugin } from "vite";
import { resolve } from "node:path";
import { transformCode } from "../vite-plugin-lumina-compile/transform";
import { transformV2 } from "./transform";
import type { LuminaCompileV2Options } from "./types";

const DEFAULT_EXCLUDE = [
  /node_modules/,
  /\.spec\./,
  // 框架与编译插件自身不转换，避免自举与误伤内部运行时
  /[\\/]core[\\/]/,
  /vite-plugin-lumina-compile/,
  /compiler-shared/,
];

/** 文件必须真实 import 了框架的 h，避免误转普通文件 */
const H_IMPORT_RE =
  /import\s*\{[^}]*\bh\b[^}]*\}\s*from\s*["'][^"']*(?:core|lumina|nova)[^"']*["']/;

export default function luminaCompileV2(
  options: LuminaCompileV2Options = {},
): Plugin {
  let root = process.cwd();
  let isProduction = false;
  const enabled = options.enabled ?? true;
  const pragma = options.pragma ?? "@lumina:compile";
  const internalImportSource =
    options.internalImportSource ?? "@lumina/framework/core/internal-dom";
  const v1InternalImportSource =
    options.v1InternalImportSource ?? "@lumina/framework/core/internal";
  const excludes = [
    ...DEFAULT_EXCLUDE,
    ...(options.transformTests ? [] : [/\.test\./]),
    ...(options.exclude ?? []),
  ];
  const compileFiles = options.compileFiles ?? [];

  /** 路径匹配：RegExp 直接 test；字符串支持绝对路径、项目相对路径、后缀匹配 */
  const matches = (pattern: string | RegExp, id: string): boolean => {
    if (pattern instanceof RegExp) return pattern.test(id);
    const normalizedId = id.replace(/\\/g, "/");
    const raw = pattern.replace(/\\/g, "/");
    const absolute = /^(?:[A-Za-z]:\/|\/)/.test(raw)
      ? raw
      : resolve(root, raw).replace(/\\/g, "/");
    return (
      normalizedId === absolute ||
      normalizedId === raw ||
      normalizedId.endsWith(`/${raw}`)
    );
  };

  return {
    name: "lumina-compile-v2",
    enforce: "pre",

    configResolved(config): void {
      root = config.root;
      isProduction = config.command === "build";
    },

    transform(code: string, id: string) {
      if (!enabled) return null;
      if (!/\.tsx?$/.test(id)) return null;
      if (excludes.some((pattern) => matches(pattern, id))) return null;
      // 已由 v2 处理过，保证幂等
      if (code.includes("@lumina-compiled:v2")) return null;

      // 默认全量；显式白名单时只处理命中的文件，pragma 可额外放行
      const whitelistHit =
        compileFiles.length === 0 ||
        compileFiles.some((pattern) => matches(pattern, id));
      const pragmaHit = code.slice(0, 1000).includes(pragma);
      if (!whitelistHit && !pragmaHit) return null;
      if (!H_IMPORT_RE.test(code)) return null;

      // 第一阶段：静态骨架化（h(元素) → _tmpl2 骨架 + 洞）
      // 构建期多趟执行：洞回调里的嵌套 h() 也会在后续趟变成模板工厂，
      // 避免它们留给 v1 生成 _createEl
      let v2Code = code;
      let v2Result: ReturnType<typeof transformV2> = null;
      const passes = isProduction ? 4 : 1;
      for (let pass = 0; pass < passes; pass += 1) {
        const result = transformV2(v2Code, id, {
          ...options,
          internalImportSource,
        });
        if (!result) break;
        v2Code = result.code;
        v2Result = result;
      }
      if (!v2Result) return null;
      v2Result = { code: v2Code, map: null as never };

      // 第二阶段：v1 编译收尾（无骨架化的 h() 调用照常静态编译：
      // 组件调用 → _createComp + _rp 响应式 props、元素属性/事件预分类、
      // 静态子树提升）。两阶段都只做静态编译，不存在运行时解释执行回退。
      const v1Result = transformCode(v2Result.code, id, {
        isProduction: options.v1IsProduction ?? isProduction,
        hoistStatic: true,
        compileComponentType: true,
        compileAttrs: true,
        tmplStatic: true,
        internalImportSource: options.v1InternalImportSource ?? v1InternalImportSource,
      });
      if (v1Result === null) {
        return {
          code: v2Result.code,
          map: v2Result.map as never,
        };
      }

      return {
        code: v1Result.code,
        map: (v1Result.map ?? v2Result.map) as never,
      };
    },
  };
}

export type { LuminaCompileV2Options };

