import { WwError } from "./errors.ts";

/** uint256 maximum, the largest atomic amount any ERC-20 balance can hold. */
export const UINT256_MAX = (1n << 256n) - 1n;
export const MAX_DECIMALS = 36;

const ATOMIC_RE = /^(0|[1-9][0-9]{0,77})$/;
const DECIMALS_RE = /^(0|[1-9][0-9]?)$/;

function bad(): never {
  throw new WwError("INVALID_QUANTITY", "Quantity is not a canonical atomic-unit decimal string.");
}

/** Parses a canonical non-negative atomic-unit integer string. JavaScript Number is never used. */
export function parseAtomic(text: string): bigint {
  if (!ATOMIC_RE.test(text)) bad();
  const v = BigInt(text);
  if (v > UINT256_MAX) bad();
  return v;
}

/** Decimals are metadata, not an evidence quantity, so a small JS integer is safe here. */
export function parseDecimals(text: string): number {
  if (!DECIMALS_RE.test(text)) bad();
  const n = Number.parseInt(text, 10);
  if (n > MAX_DECIMALS) bad();
  return n;
}

/** Exact decimal rendering of an atomic amount. No rounding, no floating point. */
export function formatAtomic(amount: bigint, decimals: number): string {
  if (amount < 0n || decimals < 0 || decimals > MAX_DECIMALS) bad();
  const digits = amount.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return frac.length === 0 ? whole : `${whole}.${frac}`;
}

const PRICE_RE = /^(0|[1-9][0-9]{0,40})(\.[0-9]{1,18})?$/;

/** Parses a USD price decimal string into an integer scaled by 10^18. */
export function parsePriceScaled18(text: string): bigint {
  if (!PRICE_RE.test(text)) bad();
  const [whole = "0", frac = ""] = text.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, "0"));
}

/**
 * USD value scaled by 10^18, rounded toward zero (documented rule wwdr.usd-value 0.1.0-draft):
 * floor(atomic * priceScaled18 / 10^decimals).
 */
export function usdValueScaled18(atomic: bigint, decimals: number, priceScaled18: bigint): bigint {
  return (atomic * priceScaled18) / 10n ** BigInt(decimals);
}
