/**
 * Skill Passport (PS p2: Open Badges 3.0 / W3C VC). Builds an OpenBadgeCredential for one Verified skill
 * and signs it with Ed25519 over a deterministic serialisation of the credential.
 *
 * Scope note: the proof is a detached Ed25519 signature over the stable JSON of the credential
 * (`proofValue`, base64url). It is verifiable with the issuer's published key, but it is not a JSON-LD
 * Data Integrity (eddsa-rdfc-2022) proof; conformance with that suite is future work and is not claimed.
 */
import { createPrivateKey, createPublicKey, sign, verify, KeyObject } from 'crypto';
import { stableStringify } from './eligibility-evaluator.js';

export interface PassportSubject {
  credentialId: string;
  issuer: { id: string; name: string };
  student: { id: string; name: string };
  skill: { id: string; name: string; esco?: string | null };
  proofLevel: string;
  method: string;
  evidence: { id: string; kind: string; description: string }[];
  issuedAt: string;
  validUntil: string;
}

const PROOF_TEXT: Record<string, string> = {
  L1_code_backed: 'Code-backed: substantial code in a consented repository, or an issuer-confirmed certificate',
  L2_assessed: 'Assessed: passed a platform assessment',
  L3_defended: 'Defended: explained and modified the student’s own code under test',
  L3_attested: 'Attested: faculty mentor sign-off against a rubric',
};

export function buildOpenBadge(s: PassportSubject, verifyBaseUrl: string): Record<string, unknown> {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json'],
    id: `${verifyBaseUrl}/${s.credentialId}`,
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    issuer: { id: s.issuer.id, type: ['Profile'], name: s.issuer.name },
    validFrom: s.issuedAt,
    validUntil: s.validUntil,
    name: `${s.skill.name} — ${s.proofLevel.replace('_', ' ')}`,
    credentialSubject: {
      id: `urn:pramaan:student:${s.student.id}`,
      type: ['AchievementSubject'],
      name: s.student.name,
      achievement: {
        id: `urn:pramaan:skill:${s.skill.id}:${s.proofLevel}`,
        type: ['Achievement'],
        name: s.skill.name,
        description: PROOF_TEXT[s.proofLevel] ?? s.proofLevel,
        criteria: { narrative: `${PROOF_TEXT[s.proofLevel] ?? s.proofLevel}. Method: ${s.method}.` },
        ...(s.skill.esco ? { alignment: [{ type: ['Alignment'], targetName: s.skill.name, targetUrl: s.skill.esco, targetFramework: 'ESCO' }] } : {}),
      },
    },
    evidence: s.evidence.map(e => ({ id: `urn:pramaan:evidence:${e.id}`, type: ['Evidence'], name: e.kind, description: e.description })),
  };
}

/** Ed25519 private key from a 32-byte seed (hex). */
export function issuerKeyFromSeed(seedHex: string): { privateKey: KeyObject; publicKeyPem: string } {
  const seed = Buffer.from(seedHex, 'hex');
  if (seed.length !== 32) throw new Error('Issuer seed must be 32 bytes of hex.');
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicKeyPem = createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }).toString();
  return { privateKey, publicKeyPem };
}

export function signCredential(payload: Record<string, unknown>, privateKey: KeyObject): string {
  return sign(null, Buffer.from(stableStringify(payload), 'utf8'), privateKey).toString('base64url');
}

export interface CredentialCheck { valid: boolean; signatureValid: boolean; status: string; expired: boolean; reasons: string[] }

export function verifyCredential(input: {
  payload: Record<string, unknown>; proofValue: string; publicKeyPem: string; status: string; validUntil: string; now?: string;
}): CredentialCheck {
  const reasons: string[] = [];
  let signatureValid: boolean;
  try {
    signatureValid = verify(null, Buffer.from(stableStringify(input.payload), 'utf8'), createPublicKey(input.publicKeyPem), Buffer.from(input.proofValue, 'base64url'));
  } catch { signatureValid = false; }
  if (!signatureValid) reasons.push('Signature does not match the issuer key: the credential was altered or not issued by this college.');
  const expired = Date.parse(input.validUntil) <= Date.parse(input.now ?? new Date().toISOString());
  if (expired) reasons.push(`Expired on ${input.validUntil.slice(0, 10)}; the skill needs re-verification.`);
  if (input.status !== 'active') reasons.push(`Status is ${input.status}.`);
  return { valid: signatureValid && !expired && input.status === 'active', signatureValid, status: input.status, expired, reasons };
}
