import { WallPrintError, finding } from "./errors.ts";
import { RESERVED_ASSURANCE_TERMS, RESERVED_IDENTITY_STEMS } from "./vocabulary.ts";

/**
 * Assurance-language and identity guard. WallPrint may not manufacture assurance: WalletWall-authored free text
 * (lifecycle reasons, correction reasons) may not contain the reserved terms, and no WalletWall verdict is ever one
 * of them (WalletWall's verdict is the WWEP SupportState, a closed enum). An external assessor's attributed statement
 * is recorded verbatim; the assurance guard is never applied to it.
 *
 *   BAD:    WallPrint verdict = CERTIFIED
 *   VALID:  assessor "issuer:circle" (role ISSUER) asserted "CERTIFIED"
 *
 * Polarity is not parsed: "not verified" is refused like "verified". WalletWall says it in codes.
 *
 * Identity (the WallPrint 0.1 admission rules, frozen: a record committed under 0.1 is judged by exactly these, for ever;
 * 0.2's stricter rules are admission.ts, selected by the record's own `wallprintVersion`): no external assessor may read
 * as WalletWall or WallPrint (stem runs across `.`, `_`, `-` and `:` separators, so `wallet-wall` and `wall.print` are
 * reserved while `firewall-print-shop` is not), and no external policy may sit in a WalletWall policy or rule namespace
 * (`wwap/`, `wwdr.`, `wwvr.` in any case or separator).
 *
 * Credential-shaped text is refused in every slot, attributed or not.
 */

export { RESERVED_ASSURANCE_TERMS, RESERVED_IDENTITY_STEMS };

const TERM_MATCHERS: readonly { term: (typeof RESERVED_ASSURANCE_TERMS)[number]; re: RegExp }[] = RESERVED_ASSURANCE_TERMS.map((term) => ({
  term,
  re: term === "INVESTMENT-GRADE" ? /\binvestment[-_ ]grade\b/i : new RegExp(`\\b${term.toLowerCase()}\\b`, "i"),
}));

const RESERVED_CODES: ReadonlySet<string> = new Set([...RESERVED_ASSURANCE_TERMS, "INVESTMENT_GRADE"]);

/** Reserved terms present in a text, in canonical spelling and order. */
export function findReservedAssuranceTerms(text: unknown): string[] {
  if (typeof text !== "string" || text === "") return [];
  return TERM_MATCHERS.filter(({ re }) => re.test(text)).map(({ term }) => term);
}

/** True when a structured code is one of the reserved terms (either spelling of INVESTMENT-GRADE). */
export function isReservedAssuranceCode(code: unknown): boolean {
  return typeof code === "string" && RESERVED_CODES.has(code.toUpperCase());
}

/**
 * WallPrint 0.1 identity rule (frozen). True when an identifier reads as WalletWall or WallPrint: some run of consecutive
 * separator-delimited tokens, joined, equals a reserved stem (`wallet-wall`, `the.walletwall.desk`, `WallPrint:audit`),
 * while a stem buried inside a longer token (`firewall-print-shop`, `stonewall`) does not count.
 */
export function isReservedIdentity(id: unknown): boolean {
  if (typeof id !== "string") return false;
  const tokens = id.toLowerCase().split(/[._:-]+/).filter((t) => t !== "");
  for (let i = 0; i < tokens.length; i++) {
    let run = "";
    for (let j = i; j < tokens.length; j++) {
      run += tokens[j];
      if ((RESERVED_IDENTITY_STEMS as readonly string[]).includes(run)) return true;
      if (run.length > 10) break;
    }
  }
  return false;
}

/** WallPrint 0.1 policy-namespace rule (frozen): the literal prefix `wwap`, `wwdr` or `wwvr` followed by a separator or the end, in any letter case. */
const RESERVED_POLICY_RE = /^ww(?:ap|dr|vr)(?:[/._:-]|$)/i;

/** True when a policy id sits in a WalletWall policy or rule namespace under the 0.1 rule. */
export function isReservedPolicyId(policy: unknown): boolean {
  return typeof policy === "string" && RESERVED_POLICY_RE.test(policy);
}

// Credential-shaped text has no place in a disclosure record. Coarse on purpose; review stays with the human.
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|password|passwd|token)\s*[:=]\s*\S{8,}/i,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./,
];

/** "SUSPECTED_SECRET" when the text looks like a credential, else null. */
export function findSecretLike(text: unknown): "SUSPECTED_SECRET" | null {
  if (typeof text !== "string") return null;
  return SECRET_PATTERNS.some((re) => re.test(text)) ? "SUSPECTED_SECRET" : null;
}

/**
 * Admit WalletWall-authored text or throw. The error names the path and a fixed message; it never echoes the text.
 * @param text   the text to admit
 * @param path   where it sits, built from fixed field names only (e.g. "lifecycle.reason")
 */
export function assertWalletWallText(text: unknown, path: string): void {
  if (findReservedAssuranceTerms(text).length > 0) throw new WallPrintError("MANUFACTURED_ASSURANCE", [finding("MANUFACTURED_ASSURANCE", path)]);
  const secret = findSecretLike(text);
  if (secret !== null) throw new WallPrintError("SUSPECTED_SECRET", [finding(secret, path)]);
}
