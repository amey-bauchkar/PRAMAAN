import { KeyObject, randomBytes } from 'crypto';

/** Roles offered in the mock drive and the coding problems each one samples from (one per language). */
export const MOCK_ROLES: Record<string, { problems: string[]; languages: ('javascript' | 'sql')[] }> = {
  'Backend Developer': { problems: ['two-sum', 'balanced-brackets', 'dept-headcount', 'second-highest-salary'], languages: ['javascript', 'sql'] },
  'Data Analyst': { problems: ['dept-headcount', 'high-paying-departments', 'employee-departments', 'second-highest-salary'], languages: ['sql', 'sql'] },
  'Software Engineer Trainee': { problems: ['two-sum', 'balanced-brackets', 'merge-intervals', 'second-largest'], languages: ['javascript', 'javascript'] },
  'Cloud Support Engineer': { problems: ['balanced-brackets', 'second-largest', 'employee-departments'], languages: ['javascript', 'sql'] },
  'ML Engineer Intern': { problems: ['merge-intervals', 'two-sum', 'high-paying-departments'], languages: ['javascript', 'sql'] },
  'Embedded Systems Engineer': { problems: ['balanced-brackets', 'second-largest', 'merge-intervals'], languages: ['javascript', 'javascript'] },
  'Design Engineer (GET)': { problems: ['second-largest', 'merge-intervals', 'two-sum'], languages: ['javascript', 'javascript'] },
  'Junior Site Engineer': { problems: ['second-largest', 'employee-departments', 'merge-intervals'], languages: ['javascript', 'sql'] },
  'Solar Installation Technician': { problems: ['second-largest', 'merge-intervals', 'two-sum'], languages: ['javascript', 'javascript'] },
};

export const BRANCH_CORE_SKILLS: Record<string, string[]> = {
  CSE: ['sql', 'data-structures', 'python', 'java', 'git'],
  IT: ['sql', 'data-structures', 'java', 'excel'],
  ENTC: ['c', 'embedded-c', 'microcontrollers'],
  MECH: ['autocad', 'solidworks', 'gdt'],
  DCE: ['autocad', 'estimation-costing'],
  DEE: ['electrical-design', 'solar-pv'],
};

export interface IssuerConfig {
  privateKey: KeyObject;
  publicKeyPem: string;
  /** Base URL of the public verification page, e.g. https://pramaan.example/verify */
  verifyBaseUrl: string;
}

export interface ExternalProfileCheck {
  ownershipConfirmed: boolean;
  source: 'live' | 'demo_fixture';
  stats: Record<string, number | string> | null;
  note: string;
}

/**
 * Ownership-token linking (v2 B2). The student puts a one-time token in their public profile; we read the
 * public profile and confirm the token is present. Live mode calls the providers' public endpoints:
 * Codeforces has an official public API; LeetCode has no official API, so its public GraphQL endpoint is
 * used read-only and may change. Demo mode uses a labelled fixture and never contacts any service.
 */
export interface ExternalProfileAdapter {
  check(provider: 'leetcode' | 'codeforces', handle: string, token: string): Promise<ExternalProfileCheck>;
}

export class DemoFixtureProfiles implements ExternalProfileAdapter {
  async check(provider: 'leetcode' | 'codeforces', handle: string): Promise<ExternalProfileCheck> {
    const seed = [...handle].reduce((s, c) => s + c.charCodeAt(0), 0);
    const stats: Record<string, number | string> = provider === 'leetcode'
      ? (handle.startsWith('rahul') ? { solved: 200, easy: 92, medium: 88, hard: 20, contestRating: 1612 }
        : { solved: 40 + (seed % 160), easy: 30 + (seed % 60), medium: 10 + (seed % 80), hard: seed % 12, contestRating: 1300 + (seed % 400) })
      : { rating: 1100 + (seed % 600), maxRating: 1200 + (seed % 700), rank: 'pupil' };
    return { ownershipConfirmed: true, source: 'demo_fixture', stats, note: 'Demo only: the account check is simulated and no outside service was contacted.' };
  }
}

export class LiveProfiles implements ExternalProfileAdapter {
  async check(provider: 'leetcode' | 'codeforces', handle: string, token: string): Promise<ExternalProfileCheck> {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(handle)) return { ownershipConfirmed: false, source: 'live', stats: null, note: 'Invalid handle.' };
    if (provider === 'codeforces') {
      const res = await fetch(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(handle)}`, { signal: AbortSignal.timeout(8000) });
      const body: any = await res.json();
      const u = body?.result?.[0];
      if (!u) return { ownershipConfirmed: false, source: 'live', stats: null, note: 'Handle not found.' };
      const confirmed = [u.firstName, u.lastName, u.organization].some((f: unknown) => typeof f === 'string' && f.includes(token));
      return { ownershipConfirmed: confirmed, source: 'live', stats: { rating: u.rating ?? 0, maxRating: u.maxRating ?? 0, rank: u.rank ?? 'unrated' },
        note: confirmed ? 'Token found in your Codeforces profile.' : 'Token not found: put it in your Codeforces "organization" field and try again.' };
    }
    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ query: 'query($u:String!){ matchedUser(username:$u){ profile { aboutMe } submitStatsGlobal { acSubmissionNum { difficulty count } } } }', variables: { u: handle } }),
    });
    const body: any = await res.json();
    const m = body?.data?.matchedUser;
    if (!m) return { ownershipConfirmed: false, source: 'live', stats: null, note: 'Handle not found.' };
    const counts = Object.fromEntries((m.submitStatsGlobal?.acSubmissionNum ?? []).map((x: any) => [String(x.difficulty).toLowerCase(), x.count]));
    const confirmed = String(m.profile?.aboutMe ?? '').includes(token);
    return { ownershipConfirmed: confirmed, source: 'live', stats: { solved: counts.all ?? 0, easy: counts.easy ?? 0, medium: counts.medium ?? 0, hard: counts.hard ?? 0 },
      note: confirmed ? 'Token found in your LeetCode summary.' : 'Token not found: add it to your LeetCode profile summary and try again.' };
  }
}

export const newToken = () => `PRAMAAN-${randomBytes(4).toString('hex').toUpperCase()}`;
