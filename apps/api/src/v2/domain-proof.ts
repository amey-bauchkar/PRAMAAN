import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Proof that the holder of a recruiter key controls a company domain: the holder publishes a short file at a well-known
 * address on that domain, and the server reads it. This shows control of the domain at one moment. It does not show that the
 * company authorised this recruiter, so an auditor still confirms the key with the company.
 */
export const DOMAIN_PROOF_PATH = '/.well-known/pramaan-recruiter.txt';

/** Fetches the proof file. `expected` is passed so a demo fetcher can stand in for a company's website. */
export type DomainFetcher = (domain: string, expected: string) => Promise<string>;

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Lower-cases and validates a public host name. Returns null for IP addresses, single labels and anything odd. */
export function normaliseDomain(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const d = input.trim().toLowerCase().replace(/\.$/, '');
  if (d.length < 4 || d.length > 253 || isIP(d)) return null;
  const labels = d.split('.');
  if (labels.length < 2 || !labels.every(l => LABEL.test(l))) return null;
  if (/^(localhost|local|internal|test|invalid)$/.test(labels[labels.length - 1])) return null;
  return d;
}

export function proofText(keyId: string, challenge: string): string {
  return `pramaan-recruiter-key=${keyId} challenge=${challenge}`;
}

/** True when an address is on the public internet. Used so the server is never pointed at private or local addresses. */
export function isPublicAddress(addr: string): boolean {
  if (isIP(addr) === 4) {
    const [a, b] = addr.split('.').map(Number);
    return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
  }
  if (isIP(addr) === 6) {
    const x = addr.toLowerCase();
    if (x === '::1' || x === '::' || x.startsWith('fe80') || x.startsWith('fc') || x.startsWith('fd')) return false;
    if (x.startsWith('::ffff:')) return isPublicAddress(x.slice(7));
    return true;
  }
  return false;
}

/** The real fetcher: HTTPS only, public addresses only, no redirects, small and quick. */
export const httpsDomainFetcher: DomainFetcher = async (domain) => {
  const addrs = await lookup(domain, { all: true });
  if (addrs.length === 0 || !addrs.every(a => isPublicAddress(a.address))) throw new Error('That domain does not resolve to a public address.');
  const res = await fetch(`https://${domain}${DOMAIN_PROOF_PATH}`, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { accept: 'text/plain' } });
  if (!res.ok) throw new Error(`The file was not found (HTTP ${res.status}).`);
  const text = await res.text();
  if (text.length > 2048) throw new Error('The file is too large.');
  return text;
};
