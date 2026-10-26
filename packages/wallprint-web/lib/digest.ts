/**
 * SHA-256 over UTF-8 text through the platform's Web Crypto implementation (browsers and Node alike), as the engine's
 * sha256Hex() computes it with node:crypto. The public resolver uses it for one thing: to check that the canonical
 * preimage it fetched digests to the digest it was asked about. It is an integrity check, not a signature and not a
 * statement about any claim.
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** Lower-case hex SHA-256 of the UTF-8 encoding of `text`. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  let out = "";
  for (const b of hash) out += HEX[b];
  return out;
}
