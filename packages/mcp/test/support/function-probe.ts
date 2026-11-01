/**
 * Test instrument, loaded into the MCP server process with `node --import <this file>`. It records the source text of every
 * function built through the global `Function` binding and writes the list to the file named by WW_FUNCTION_PROBE_FILE at
 * exit. It changes no behaviour and the shipped server never loads it.
 */
import { writeFileSync } from "node:fs";

const file = process.env["WW_FUNCTION_PROBE_FILE"];
const bodies: string[] = [];
const Original = globalThis.Function;

const lastArgument = (args: unknown[]): string => {
  const last = args.at(-1);
  return typeof last === "string" ? last : "";
};

globalThis.Function = new Proxy(Original, {
  construct(target, args: unknown[]) {
    bodies.push(lastArgument(args));
    return Reflect.construct(target, args) as object;
  },
  apply(target, thisArg: unknown, args: unknown[]) {
    bodies.push(lastArgument(args));
    return Reflect.apply(target, thisArg, args) as unknown;
  },
});

process.on("exit", () => {
  if (file !== undefined) writeFileSync(file, JSON.stringify(bodies));
});
