import { WallPrintError, finding, type Finding } from "./errors.ts";
import { isReservedIdentity as isReservedIdentityV01, isReservedPolicyId as isReservedPolicyIdV01 } from "./language.ts";
import { WALLPRINT_VERSIONS, type AssessorRole, type WallPrintVersion } from "./vocabulary.ts";

/**
 * External-assessor ADMISSION, versioned.
 *
 *   WalletWall isn't always right. WallPrint keeps the record.
 *
 * An external assessment is attribution: who said what, under which policy, as stated. Admission decides only whether a
 * name or a policy id may be attributed AT ALL, because some of them are not the assessor's to claim: WalletWall's own
 * identity, WalletWall's own policy and rule namespaces, and an authority the registry or the engine names. It does not
 * prove anyone is who they say they are (no signature, key or authentication exists), and it never rewrites what the
 * assessor supplied: a refused spelling is refused, an admitted one is recorded exactly as stated.
 *
 * VERSIONING. The rules are part of the WallPrint contract, so they are selected by the record's own `wallprintVersion`
 * through ONE table (ADMISSION_RULES). Every consumer that applies them (the builder, `validateWallPrintRecord`, replay
 * through the builder, and the import boundary) goes through `externalAssessmentFindings` with an explicit version, so
 * native and imported assessments are judged by the same code for the same target version.
 *
 *   0.1  the rules the contract shipped with (language.ts, frozen): a run of whole separator-delimited words equal to a
 *        stem; the literal prefix `wwap` | `wwdr` | `wwvr` + separator for policies; an exact case-folded match for a
 *        registry authority under a role other than ISSUER.
 *   0.2  the same three questions answered by one deterministic model of "the same spelling" (below). Strictly
 *        stricter: everything 0.1 refuses 0.2 refuses (pinned by test), and a record committed under 0.1 stays valid
 *        under 0.1.
 *
 * THE MODEL (0.2). Security-sensitive identity matching compares SKELETONS of what was supplied; nothing is rewritten.
 *   fold       ASCII A-Z to a-z. Nothing else: no Unicode normalization, no confusable or leet folding, no edit distance, no
 *              phonetics. Assessor and policy ids are ASCII by construction (ID_RE, POLICY_ID_RE).
 *   separators `.` `_` `:` `-` and `/`, the punctuation the id grammars admit (`/` only in a policy id). A run of
 *              separators is one separator. A "word" is a maximal run between separators.
 *   skeleton   the words joined without separators.
 *
 * Three questions, one model:
 *   1. Does an ASSESSOR ID read as WalletWall or WallPrint (reserved stems `walletwall`, `wallprint`)? Yes if
 *      (a) some run of whole words spells a stem, optionally followed by a number (`wallet-wall`, `wall.print`,
 *          `wallet-wall2`, `wall-print-2024`), or
 *      (b) some word BEGINS with a stem (`walletwall2`, `walletwallprint`, `wallprinters`): a stem fused with more
 *          letters is the reserved name with decoration, the omitted-separator spelling of `walletwall-official`.
 *      A stem buried inside a word does not count (`firewall-print-shop`, `stonewall`, `officialwalletwall`), and a stem
 *      that would have to end inside a later word does not either (`wallet-wallpaper`): the supplied separators are the
 *      only word boundaries WalletWall has, and it will not segment words without a lexicon.
 *   2. Does a POLICY ID sit in a WalletWall namespace? Only at its START: the leading words spell `wwap`, `wwdr` or `wwvr`
 *      (separators allowed anywhere inside: `ww-ap`, `WW.DR`) and an optional number that belongs to the namespace
 *      (`wwap2`); or the leading word(s) read as WalletWall or WallPrint by 1. The namespace ends at the next separator or
 *      the end, so `wwapi`, `wwapp` and `wwap2x` are not in it, and neither is `acme/walletwall-review`.
 *   3. Is an ASSESSOR ID a spelling of a registry or engine authority identity (`issuer:circle`, `protocol:sky`,
 *      `canonical-chain-state`, `issuer-publication`)? Yes if its skeleton equals that identity's skeleton, for every role
 *      other than ISSUER. An ISSUER must still be spelled exactly as the registry spells its authority. Equality of the
 *      whole skeleton only: `issuer:circle-labs` and `circle` are not `issuer:circle`.
 *
 * What does NOT change in any version: one assessor assesses once per policy, compared case-insensitively. Spelling
 * variants of one name (`reviewer-y`, `reviewer.y`) remain DIFFERENT assessors, deliberately: folding them would be
 * inventing identity resolution, which needs authentication. So the guards protect reserved identities, namespaces and
 * authority roles, and nothing more:
 *
 *   assessor agreement != independent corroboration
 *   assessor count != authority
 *   assessor identity != issuer identity
 *   attribution != authentication
 */

/** What an assessment carries that admission needs. */
export interface ExternalLike {
  assessor: string;
  assessorRole: AssessorRole;
  policy: string;
  evidenceRefs: readonly string[];
}

/** One version's answers to the three identity questions. Pure and deterministic. */
export interface AdmissionRules {
  readonly version: WallPrintVersion;
  /** Does this assessor id read as WalletWall or WallPrint? */
  readonly readsAsReservedIdentity: (assessor: string) => boolean;
  /** Does this policy id sit in a WalletWall policy or rule namespace? */
  readonly inReservedPolicyNamespace: (policy: string) => boolean;
  /** Is this assessor id (under any role but ISSUER) a registry or engine authority identity? */
  readonly collidesWithAuthorityIdentity: (assessor: string) => boolean;
}

// ─── the 0.2 model ───────────────────────────────────────────────────────────

const SEPARATORS = /[._:/-]+/;
const DIGITS = /^[0-9]*$/;

/** ASCII A-Z to a-z and nothing else. */
export const foldIdentity = (s: string): string => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/** The words of an identifier: folded, split on separator runs, empty words dropped. */
export const identityWords = (s: string): string[] => foldIdentity(s).split(SEPARATORS).filter((w) => w !== "");

/** The words joined without separators: what two spellings of one identity share. */
export const identitySkeleton = (s: string): string => identityWords(s).join("");

const STEMS: readonly string[] = Object.freeze(["walletwall", "wallprint"]);
const NAMESPACES: readonly string[] = Object.freeze(["wwap", "wwdr", "wwvr"]);
const NAMESPACE_RE = new RegExp(`^(?:${NAMESPACES.join("|")})[0-9]*$`);

/** Whole words from `from` that spell a stem and then only digits (`wallet-wall`, `wall.print.2`). Stops as soon as no stem can follow. */
function wordsSpellStem(words: readonly string[], from: number): boolean {
  let run = "";
  for (let j = from; j < words.length; j++) {
    run += words[j];
    const stem = STEMS.find((s) => run.length >= s.length && run.startsWith(s));
    if (stem !== undefined) return DIGITS.test(run.slice(stem.length));
    if (!STEMS.some((s) => s.length > run.length && s.startsWith(run))) return false;
  }
  return false;
}

/** Does the identity read as a reserved stem from word `from` on: the word begins with a stem, or whole words spell one? */
function readsAsStemFrom(words: readonly string[], from: number): boolean {
  const first = words[from];
  return first !== undefined && (STEMS.some((s) => first.startsWith(s)) || wordsSpellStem(words, from));
}

/** 0.2 question 1: does an assessor id read as WalletWall or WallPrint? */
export function readsAsReservedIdentity(id: string): boolean {
  const words = identityWords(id);
  return words.some((_, i) => readsAsStemFrom(words, i));
}

/** 0.2 question 2: does a policy id sit in a WalletWall namespace? Only its start counts. */
export function inReservedPolicyNamespace(policy: string): boolean {
  const words = identityWords(policy);
  let run = "";
  for (const word of words) {
    run += word;
    if (NAMESPACE_RE.test(run)) return true;
    if (!NAMESPACES.some((ns) => ns.length > run.length && ns.startsWith(run))) break;
  }
  return readsAsStemFrom(words, 0);
}

/**
 * The authority identities each version reserves, as literals frozen with the version. A rule table must not read a
 * mutable source: if a version derived its reserved set from the live registry, adding a deployment authority to the
 * registry would silently reinterpret every record already committed under that version (a valid `issuer-future`
 * reviewer would become invalid the day the registry gained `issuer:future`). A registry change that adds an authority is
 * therefore a conscious decision, pinned by `admission-versions.test.ts`, which compares these lists with the registry's
 * and the engine's own authorities and fails when they differ: protect the new authority in the next WallPrint version.
 */
const AUTHORITY_IDS_V01: readonly string[] = Object.freeze(["issuer:circle", "issuer:tether", "protocol:sky"]);
/**
 * 0.2: the registry's deployment authorities and the engine's (`issuer-publication`, `canonical-chain-state`). Not
 * `walletwall-rules`, which is reserved as an identity already, and not `none`, which names the absence of an authority.
 */
const AUTHORITY_IDS_V02: readonly string[] = Object.freeze([...AUTHORITY_IDS_V01, "canonical-chain-state", "issuer-publication"]);
const AUTHORITY_SKELETONS: ReadonlySet<string> = new Set(AUTHORITY_IDS_V02.map(identitySkeleton));

/** The reserved authority identities, as written, for the tests that pin them against the registry and the engine. */
export const reservedAuthorityIds = (version: WallPrintVersion): readonly string[] => (version === "0.1" ? AUTHORITY_IDS_V01 : AUTHORITY_IDS_V02);

/** The reserved authority identities of 0.2 as skeletons, for tests that pin the set. */
export const reservedAuthoritySkeletons = (): readonly string[] => [...AUTHORITY_SKELETONS].sort();

// ─── the 0.1 rules (frozen, language.ts) ─────────────────────────────────────

const REGISTRY_AUTHORITY_IDS_V01: ReadonlySet<string> = new Set(AUTHORITY_IDS_V01.map((id) => id.toLowerCase()));

// ─── the table ───────────────────────────────────────────────────────────────

const RULES_V01: AdmissionRules = Object.freeze({
  version: "0.1",
  readsAsReservedIdentity: isReservedIdentityV01,
  inReservedPolicyNamespace: isReservedPolicyIdV01,
  collidesWithAuthorityIdentity: (assessor: string): boolean => REGISTRY_AUTHORITY_IDS_V01.has(assessor.toLowerCase()),
});

const RULES_V02: AdmissionRules = Object.freeze({
  version: "0.2",
  readsAsReservedIdentity,
  inReservedPolicyNamespace,
  collidesWithAuthorityIdentity: (assessor: string): boolean => AUTHORITY_SKELETONS.has(identitySkeleton(assessor)),
});

/** The one table of admission rules by WallPrint version. A version with no row here is not a version this engine reads. */
export const ADMISSION_RULES: Readonly<Record<WallPrintVersion, AdmissionRules>> = Object.freeze({ "0.1": RULES_V01, "0.2": RULES_V02 });

export function admissionRulesFor(version: WallPrintVersion): AdmissionRules {
  const rules = (ADMISSION_RULES as Readonly<Record<string, AdmissionRules | undefined>>)[version];
  if (rules === undefined || !(WALLPRINT_VERSIONS as readonly string[]).includes(version)) throw new WallPrintError("INVALID_INPUT", [finding("UNSUPPORTED_VERSION", "wallprintVersion")]);
  return rules;
}

/**
 * The attribution rules for external assessments, applied identically at build time, at validation time and at the import
 * boundary, under the rules of one explicit WallPrint version. `knownIds` are the ids an evidence reference may name;
 * `registryAuthority` is the focal deployment's authority id.
 */
export function externalAssessmentFindings(
  version: WallPrintVersion,
  list: readonly ExternalLike[],
  knownIds: ReadonlySet<string>,
  registryAuthority: string | null,
  path: (i: number) => string,
): Finding[] {
  const rules = admissionRulesFor(version);
  const out: Finding[] = [];
  const seen = new Set<string>();
  list.forEach((a, i) => {
    const p = path(i);
    if (a.assessorRole === "WALLETWALL") out.push(finding("ASSESSOR_IDENTITY_RESERVED", `${p}.assessorRole`));
    if (rules.readsAsReservedIdentity(a.assessor)) out.push(finding("ASSESSOR_IDENTITY_RESERVED", `${p}.assessor`));
    if (a.assessorRole === "ISSUER") {
      if (registryAuthority === null) out.push(finding("ISSUER_NOT_IN_REGISTRY", `${p}.assessor`));
      else if (a.assessor !== registryAuthority) out.push(finding("ISSUER_AUTHORITY_MISMATCH", `${p}.assessor`));
    } else if (rules.collidesWithAuthorityIdentity(a.assessor)) {
      out.push(finding("ASSESSOR_IDENTITY_RESERVED", `${p}.assessor`));
    }
    if (rules.inReservedPolicyNamespace(a.policy)) out.push(finding("RESERVED_POLICY_NAMESPACE", `${p}.policy`));
    if (a.evidenceRefs.some((id) => !knownIds.has(id))) out.push(finding("UNKNOWN_EVIDENCE_REFERENCE", `${p}.evidenceRefs`));
    const key = `${a.assessor.toLowerCase()}|${a.policy.toLowerCase()}`;
    if (seen.has(key)) out.push(finding("DUPLICATE_ASSESSMENT", p));
    seen.add(key);
  });
  return out;
}
