import { canonicalize, evidenceDigest } from "./canonical.ts";
import { WwError } from "./errors.ts";
import { formatAtomic, parseAtomic, parseDecimals } from "./quantity.ts";
import type { Observation } from "./schemas.ts";

export interface ObservationDraft {
  id: string;
  sourceId: string;
  origin: Observation["origin"];
  observedAt: string;
  finality: Observation["finality"];
  result: Observation["result"];
  chainId: string;
  token: string;
  holder: string;
  blockNumber: string;
  blockHash: string;
  balanceAtomic?: string | undefined;
  decimals?: string | undefined;
}

export interface NormalizedObservation {
  observation: Observation;
  canonicalJson: string;
  evidenceDigest: string;
  contentDigest: string;
  balanceDecimal: string | null;
}

/**
 * Normalizes a balance-at-block observation draft. Addresses and hashes are lowercased, quantities are
 * validated as canonical atomic strings, and the decimal rendering is computed with BigInt only.
 */
export function normalizeObservation(draft: ObservationDraft): NormalizedObservation {
  const subject = {
    chainId: draft.chainId,
    token: draft.token.toLowerCase(),
    holder: draft.holder.toLowerCase(),
    blockNumber: draft.blockNumber,
    blockHash: draft.blockHash.toLowerCase(),
  };
  let payload: Record<string, string> = {};
  let balanceDecimal: string | null = null;
  if (draft.result === "VALUE") {
    if (draft.balanceAtomic === undefined || draft.decimals === undefined) {
      throw new WwError("INVALID_QUANTITY", "VALUE observations require balanceAtomic and decimals.");
    }
    const atomic = parseAtomic(draft.balanceAtomic);
    const decimals = parseDecimals(draft.decimals);
    payload = { balanceAtomic: atomic.toString(), decimals: String(decimals) };
    balanceDecimal = formatAtomic(atomic, decimals);
  }
  const observation: Observation = {
    id: draft.id,
    sourceId: draft.sourceId,
    origin: draft.origin,
    observedAt: draft.observedAt,
    finality: draft.finality,
    result: draft.result,
    subject,
    payload,
  };
  return {
    observation,
    canonicalJson: canonicalize(observation),
    evidenceDigest: evidenceDigest(observation),
    contentDigest: evidenceDigest({ result: draft.result, subject, payload }),
    balanceDecimal,
  };
}
