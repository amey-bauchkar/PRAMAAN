export function canonicalJson(v: unknown): string;
export function leafHash(entry: unknown): string;
export function merkleRoot(leaves: string[]): string;
export function verifyInclusion(leaf: string, index: number, size: number, proof: string[], root: string): boolean;
export function verifyConsistency(oldSize: number, newSize: number, oldRoot: string, newRoot: string, proof: string[]): boolean;
export function checkReceipt(receipt: any, issuerPem: string | null): { label: string; ok: boolean }[];
export function verifyLedgerAt(
  getJson: (path: string) => Promise<any>,
  orgId: string,
  opts?: { seen?: { size: number; root: string } | null; issuerPem?: string | null; witnessPins?: Record<string, unknown>; receipt?: unknown },
): Promise<{ results: { label: string; ok: boolean | null; detail?: string }[]; ok: boolean; state: { size: number; root: string } }>;
