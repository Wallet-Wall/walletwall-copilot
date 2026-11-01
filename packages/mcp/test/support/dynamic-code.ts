import { transformSync } from "esbuild";

/**
 * The PRIV-015 tripwire for the shipped bundle: literal `eval(`, `new Function` and `Function(` text. It is a bounded check.
 * It cannot see a Function constructor that is reached through another binding, so it is not evidence that no dependency
 * generates code at runtime.
 */
export const LITERAL_TRIPWIRE = /\beval\s*\(|new\s+Function\b|\bFunction\s*\(/;

/** The forms the inventory looks for. Vendored Zod uses the second one: `const F = Function; new F(...)`. */
export const DYNAMIC_CODE_FORMS: readonly (readonly [string, RegExp])[] = [
  ["eval call", /(?<![.\w$])eval\s*\(/],
  ["Function constructor call", /\bnew\s+(?:globalThis\.)?Function\b|(?<![.\w$])Function\s*\(/],
  ["Function bound to a name", /(?<![.\w$])(?:const|let|var)\s+[\w$]+\s*=\s*(?:globalThis\.)?Function\s*[;,\n]/],
  ["Reflect on Function", /Reflect\.(?:construct|apply)\s*\(\s*(?:globalThis\.)?Function\b/],
];

export const dynamicCodeForms = (code: string): string[] => DYNAMIC_CODE_FORMS.filter(([, re]) => re.test(code)).map(([label]) => label);

/** Comments removed by the esbuild parser, so a comment that mentions `new Function` is not counted. */
export const withoutComments = (js: string): string => transformSync(js, { loader: "js", legalComments: "none" }).code;

/** The bundle split at the module markers esbuild writes (`// node_modules/zod/v4/core/util.js`, `// packages/mcp/src/server.ts`). */
export function bundleSections(bundle: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current = "(preamble)";
  for (const line of bundle.split("\n")) {
    const marker = /^\/\/ ((?:node_modules\/|packages\/|walletwall-stub:).*)$/.exec(line);
    if (marker !== null) current = marker[1] as string;
    sections.set(current, `${sections.get(current) ?? ""}${line}\n`);
  }
  return sections;
}
