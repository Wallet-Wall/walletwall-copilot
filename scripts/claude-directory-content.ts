import { createHash } from "node:crypto";
import { INTEGRITY_POLICY } from "./integrity-policy.ts";

/**
 * Skill text that only applies to another host (today: the Copilot canvas) sits between these markers in the shared
 * `plugin/skills/` files. The Claude Directory build removes each such section, markers included; the multi-host
 * `plugin/` package keeps it.
 */
export const COPILOT_ONLY_START = "<!-- copilot-only:start -->";
export const COPILOT_ONLY_END = "<!-- copilot-only:end -->";

/** Remove every copilot-only section. Unbalanced or nested markers throw, so half a section can never ship. */
export function stripCopilotOnly(text: string): { text: string; removed: number } {
  let out = "";
  let rest = text;
  let removed = 0;
  for (;;) {
    const start = rest.indexOf(COPILOT_ONLY_START);
    const end = rest.indexOf(COPILOT_ONLY_END);
    if (start < 0 && end < 0) return { text: out + rest, removed };
    if (start < 0 || (end >= 0 && end < start)) throw new Error("a copilot-only end marker has no start marker before it");
    if (end < 0) throw new Error("a copilot-only start marker has no end marker after it");
    const nested = rest.indexOf(COPILOT_ONLY_START, start + COPILOT_ONLY_START.length);
    if (nested >= 0 && nested < end) throw new Error("copilot-only sections cannot be nested");
    out += rest.slice(0, start);
    rest = rest.slice(end + COPILOT_ONLY_END.length);
    // Drop the end marker's own line break, and one more where the section stood between two blank lines, so the
    // surrounding text keeps a single blank line.
    rest = rest.replace(/^\r?\n/, "");
    if (/(?:\r?\n){2}$/.test(out)) rest = rest.replace(/^\r?\n/, "");
    removed += 1;
  }
}

/** The directory's listing-icon rule, as `claude plugin validate` states it: a square PNG, 512 to 2048 px a side, under 2 MB. */
export const ICON_MIN_SIDE = 512;
export const ICON_MAX_SIDE = 2048;
export const ICON_MAX_BYTES = 2_000_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface DirectoryIconCheck {
  width: number;
  height: number;
  bytes: number;
  /** Digest under the current integrity algorithm (security/integrity-policy.json), compared with the record's `sha512`. */
  digest: string;
  problems: string[];
}

export function checkDirectoryIcon(png: Buffer): DirectoryIconCheck {
  const isPng = png.length >= 24 && png.subarray(0, 8).equals(PNG_SIGNATURE) && png.toString("latin1", 12, 16) === "IHDR";
  const width = isPng ? png.readUInt32BE(16) : 0;
  const height = isPng ? png.readUInt32BE(20) : 0;
  const problems: string[] = [];
  if (!isPng) problems.push("not a PNG file");
  else {
    if (width !== height) problems.push(`not square (${width} x ${height} px)`);
    if (width < ICON_MIN_SIDE || width > ICON_MAX_SIDE) problems.push(`side of ${width} px is outside ${ICON_MIN_SIDE}..${ICON_MAX_SIDE}`);
  }
  if (png.length >= ICON_MAX_BYTES) problems.push(`${png.length} bytes is not under ${ICON_MAX_BYTES}`);
  return { width, height, bytes: png.length, digest: createHash(INTEGRITY_POLICY.currentAlgorithm).update(png).digest("hex"), problems };
}
