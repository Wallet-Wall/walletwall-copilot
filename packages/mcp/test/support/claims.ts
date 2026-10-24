/**
 * Claims WalletWall must not make about itself. Each is matched case-insensitively. A document may name a claim only to
 * deny it (see the public-claims test, which allows a match on a line that also negates it).
 */
export const PROHIBITED_CLAIM_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ["100% private", /100\s*%\s*private/i],
  ["nothing leaves the machine", /nothing\s+leaves\s+(?:the|your)\s+(?:machine|computer|device)/i],
  ["guaranteed accurate", /guaranteed?\s+(?:to\s+be\s+)?accura(?:te|cy)/i],
  ["N% accurate", /\d+(?:\.\d+)?\s*%\s*accura/i],
  ["verified truth", /verified\s+truth/i],
  ["truth engine", /truth\s+engine/i],
  ["tamper-proof", /tamper[\s-]*proof/i],
  ["compliance-grade", /compliance[\s-]*grade/i],
  ["regulator-approved", /regulator[\s-]*approved/i],
  ["NIST certified", /NIST[\s-]*(?:certified|compliant|approved)/i],
  ["anonymous", /\banonymous(?:ly)?\b|\banonymi[sz]/i],
  ["secure", /\bsecure(?:ly)?\b/i],
  ["registry presented as live", /registry[^\n.]{0,30}\b(?:is|are|stays|kept|remains)\s+(?:live|current|up[- ]to[- ]date|real[- ]time)\b/i],
];

export const PROHIBITED_CLAIMS = new RegExp(PROHIBITED_CLAIM_PATTERNS.map(([, r]) => r.source).join("|"), "i");
