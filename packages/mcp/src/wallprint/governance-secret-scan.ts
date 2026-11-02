import { parseStrictJson } from "./strict-json.ts";
import type { SecretScanCode } from "./governance-vocabulary.ts";

/**
 * A scanner for secret-looking material in ceremony outputs, fixtures and documents. It exists so that a private key, a seed, a recovery
 * phrase or a credential accidentally placed in something that will be published is caught by a test or by the operator before it is. It is
 * a tripwire with narrow, named patterns, not a proof that nothing is hidden: a secret that does not look like one passes. Its findings are
 * a fixed code and a position (a line number for text, a dotted path for JSON); the matched text is never returned, never logged and never
 * echoed, so the scanner cannot itself be the leak.
 *
 * Patterns are deliberately specific (a PEM private-key header, the Ed25519 PKCS#8 header, an age secret key, a 64-hex value next to a secret
 * word, an upper-case environment-secret name, a secret-bearing field name in JSON) so that ordinary prose, digests and public keys, which are
 * also 64 hex characters, are not flagged. The public-key slots of the public artifacts are checked structurally by their schemas instead.
 *
 * Pure: no clock, no I/O, no randomness. It reads only the text it is given.
 */

export interface SecretFinding {
  code: SecretScanCode;
  /** `line 12` for text, or a dotted path such as `root.privateKey` for JSON. Never a matched value. */
  at: string;
}

interface TextRule {
  code: SecretScanCode;
  re: RegExp;
}

// Written so that this file does not itself contain a PEM header, an age key or a credential: the repository's own public-release scan reads every tracked file.
const TEXT_RULES: readonly TextRule[] = [
  { code: "PEM_PRIVATE_KEY_BLOCK", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/ },
  { code: "PKCS8_ED25519_HEADER", re: /302e020100300506032b657004220420|MC4CAQAwBQYDK2VwBCIEI/i },
  { code: "AGE_SECRET_IDENTITY", re: /AGE-SECRET-KEY-1[0-9A-Z]{20,}/ },
  { code: "SEED_HEX_NEAR_SECRET_WORD", re: /\b(?:seed|priv|private[_ -]?key|secret[_ -]?key|signing[_ -]?key|entropy)\b[^\n]{0,40}?(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/i },
  { code: "ENV_SECRET_NAME", re: /\b(?:[A-Z][A-Z0-9]*_)*(?:PRIVATE_KEY|SECRET_KEY|SIGNING_KEY|SEED|MNEMONIC|PASSPHRASE)\b|\b(?:WALLETWALL|WALLPRINT|GOVERNANCE|CHECKPOINT)_[A-Z0-9_]*(?:KEY|SEED|SECRET|PASSPHRASE|MNEMONIC)\b/ },
  { code: "CI_SECRET_REFERENCE", re: /\$\{\{\s*secrets\./ },
  { code: "SECRET_VALUE_ASSIGNMENT", re: /\b(?:privateKey|private_key|secretKey|secret_key|seedPhrase|seed_phrase|mnemonic|passphrase|entropy)\b["']?\s*[:=]\s*["']?[^\s"',}{]{8,}/i },
  { code: "SEED_PHRASE_SHAPE", re: /\b(?:mnemonic|seed phrase|recovery phrase|backup phrase)\b\s*[:=]\s*["']?(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/i },
];

/** The words that make a JSON field a place a secret could sit. Compared after lower-casing and removing separators. */
const SECRET_FIELD_NAMES: ReadonlySet<string> = new Set([
  "privatekey",
  "privateseed",
  "privatescalar",
  "secretkey",
  "secret",
  "seed",
  "seedphrase",
  "mnemonic",
  "recoveryphrase",
  "passphrase",
  "password",
  "entropy",
  "signingkey",
  "rootprivatekey",
  "encryptedkey",
  "encryptedprivatekey",
  "backupblob",
  "backupcontents",
  "wrappedkey",
]);

const normaliseField = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A string of 12, 15, 18, 21 or 24 short lower-case words is the shape of a seed phrase. */
const looksLikeSeedPhrase = (value: string): boolean => {
  const words = value.split(" ");
  return [12, 15, 18, 21, 24].includes(words.length) && words.every((w) => /^[a-z]{3,8}$/.test(w));
};

/** Scan text line by line. Findings carry the 1-based line; the line itself is never returned. */
export function scanCeremonyText(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const rule of TEXT_RULES) if (rule.re.test(line)) findings.push({ code: rule.code, at: `line ${i + 1}` });
  });
  return findings;
}

function walk(value: unknown, path: string, out: SecretFinding[], depth: number): void {
  if (depth > 16) return;
  if (typeof value === "string") {
    if (looksLikeSeedPhrase(value)) out.push({ code: "SEED_PHRASE_SHAPE", at: path });
    for (const rule of TEXT_RULES) if (rule.code !== "SEED_HEX_NEAR_SECRET_WORD" && rule.code !== "SECRET_VALUE_ASSIGNMENT" && rule.re.test(value)) out.push({ code: rule.code, at: path });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, out, depth + 1));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const at = path === "" ? key : `${path}.${key}`;
      if (SECRET_FIELD_NAMES.has(normaliseField(key))) out.push({ code: "SECRET_FIELD_NAME", at });
      walk(item, at, out, depth + 1);
    }
  }
}

/** Scan a parsed JSON value: every field name at every depth, and every string value. Findings carry a dotted path, never a value. */
export function scanCeremonyJson(value: unknown): SecretFinding[] {
  const findings: SecretFinding[] = [];
  walk(value, "", findings, 0);
  return findings;
}

/**
 * Scan one file's text. A `.json` file is read as JSON (strictly: a duplicate key or malformed text falls back to the text rules, so a
 * hostile file cannot hide behind a parse failure) and as text; anything else is text only.
 */
export function scanCeremonyFile(path: string, text: string): SecretFinding[] {
  const findings = scanCeremonyText(text);
  if (path.endsWith(".json")) {
    const read = parseStrictJson(text, 32);
    if (read.ok) findings.push(...scanCeremonyJson(read.value));
  }
  return findings;
}
