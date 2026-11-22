import { isSensitivePath, scrubSecrets, techFromManifests, techFromText, ManifestFile, RepoLite } from '@pramaan/domain';
import { HttpError } from './http.js';

/**
 * Reads a person's PUBLIC GitHub profile and repositories for the project interview kit. Public data only: with no sign-in the
 * candidate's private repositories are never visible, and the token used (a recruiter's read-only sign-in, or the server's) is never
 * stored or logged. The host is fixed, and every name is checked before it is placed in a URL.
 */

export type GhResponse = { status: number; json?: any; text?: string; rateRemaining?: number; rateLimit?: number; rateReset?: number };
export type GhFetch = (path: string, opts?: { raw?: boolean }) => Promise<GhResponse>;

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
const SAFE_PATH = /^[A-Za-z0-9._@+ /()-]{1,300}$/;

/** A fetcher for api.github.com. `token` may be undefined (60 requests an hour per address, shared). */
export function createGhFetch(opts: { token?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): GhFetch {
  const f = opts.fetchImpl ?? fetch;
  return async (path, o = {}) => {
    if (!path.startsWith('/') || path.includes('..') || path.includes('//')) throw new Error('Bad GitHub path.');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 9000);
    try {
      const res = await f(`https://api.github.com${path}`, {
        headers: {
          Accept: o.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'PRAMAAN-project-kit',
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        },
        signal: ac.signal,
      });
      const n = (h: string) => { const v = res.headers.get(h); return v === null ? undefined : Number(v); };
      const meta = { rateRemaining: n('x-ratelimit-remaining'), rateLimit: n('x-ratelimit-limit'), rateReset: n('x-ratelimit-reset') };
      if (!res.ok) return { status: res.status, ...meta };
      if (o.raw) return { status: res.status, text: (await res.text()).slice(0, 400_000), ...meta };
      return { status: res.status, json: await res.json(), ...meta };
    } catch { return { status: 0 }; } finally { clearTimeout(timer); }
  };
}

/** True when the token has the shape of a GitHub token. We never log or store it; this only rejects obvious junk. */
export function looksLikeGithubToken(t: unknown): t is string {
  return typeof t === 'string' && t.length >= 20 && t.length <= 255 && /^(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|[a-f0-9]{40})$/.test(t);
}

export interface RepoMeta extends RepoLite {
  fullName: string; url: string; defaultBranch: string; sizeKb: number; createdAt: string | null; archived: boolean; homepage: string | null; forks: number;
}

export interface ProfileScan {
  login: string; name: string | null; bio: string | null; publicRepos: number; followers: number; createdAt: string | null;
  repos: RepoMeta[]; truncated: boolean; rateRemaining: number | null; rateLimited: boolean;
}

function rateError(r: GhResponse): HttpError | null {
  if (r.status === 403 || r.status === 429) {
    if (r.rateRemaining === 0 || r.status === 429) {
      const when = r.rateReset ? ` It resets around ${new Date(r.rateReset * 1000).toISOString().slice(11, 16)} UTC.` : '';
      return new HttpError(429, `GitHub's request limit has been reached.${when} Sign in with GitHub, or ask your administrator to set a GitHub token, to scan with a higher limit.`);
    }
  }
  return null;
}

/** The profile and the list of public repositories (up to 200, newest push first). */
export async function scanProfile(gh: GhFetch, login: string): Promise<ProfileScan> {
  if (!LOGIN.test(login)) throw new HttpError(400, 'That is not a valid GitHub username.');
  const u = await gh(`/users/${login}`);
  const limited = rateError(u);
  if (limited) throw limited;
  if (u.status === 404) throw new HttpError(404, `No GitHub user named "${login}". Check the link.`);
  if (u.status !== 200 || !u.json) throw new HttpError(502, 'GitHub could not be reached. Try again in a moment.');
  if (u.json.type && u.json.type !== 'User') throw new HttpError(400, 'That GitHub address is an organisation. Paste the candidate’s own profile.');

  const repos: RepoMeta[] = [];
  let truncated = false, remaining: number | null = u.rateRemaining ?? null;
  for (const page of [1, 2]) {
    const r = await gh(`/users/${login}/repos?per_page=100&sort=pushed&type=owner&page=${page}`);
    const lim = rateError(r);
    if (lim) { if (repos.length === 0) throw lim; truncated = true; break; }
    if (r.status !== 200 || !Array.isArray(r.json)) { if (repos.length === 0) throw new HttpError(502, 'GitHub could not list the repositories. Try again in a moment.'); truncated = true; break; }
    remaining = r.rateRemaining ?? remaining;
    for (const x of r.json) {
      if (!x || typeof x.name !== 'string' || !REPO.test(x.name)) continue;
      repos.push({
        name: x.name, fullName: String(x.full_name ?? `${login}/${x.name}`), url: /^https:\/\/github\.com\//.test(String(x.html_url)) ? String(x.html_url) : `https://github.com/${login}/${x.name}`,
        description: typeof x.description === 'string' ? x.description.slice(0, 300) : null, language: typeof x.language === 'string' ? x.language : null,
        topics: Array.isArray(x.topics) ? x.topics.filter((t: unknown) => typeof t === 'string').slice(0, 12) : [], fork: !!x.fork, archived: !!x.archived,
        stars: Number(x.stargazers_count) || 0, forks: Number(x.forks_count) || 0, sizeKb: Number(x.size) || 0, pushedAt: x.pushed_at ?? null, createdAt: x.created_at ?? null,
        defaultBranch: BRANCH.test(String(x.default_branch ?? '')) ? String(x.default_branch) : 'main', homepage: typeof x.homepage === 'string' && x.homepage ? x.homepage.slice(0, 200) : null,
      });
    }
    if (r.json.length < 100) break;
    if (page === 2) truncated = Number(u.json.public_repos) > repos.length;
  }
  return {
    login: String(u.json.login ?? login), name: typeof u.json.name === 'string' ? u.json.name : null, bio: typeof u.json.bio === 'string' ? u.json.bio.slice(0, 300) : null,
    publicRepos: Number(u.json.public_repos) || repos.length, followers: Number(u.json.followers) || 0, createdAt: u.json.created_at ?? null,
    repos, truncated, rateRemaining: remaining, rateLimited: false,
  };
}

export interface DeepRepo {
  name: string; languages: { name: string; pct: number }[]; readme: string | null; files: string[]; filesTruncated: boolean;
  tech: string[]; hasTests: boolean; hasCI: boolean; hasDocker: boolean;
  samples: { path: string; excerpt: string }[];
  commits: { seen: number; byCandidate: number; first: string | null; last: string | null; messages: string[] } | null;
  /** True when GitHub's limit stopped the scan part-way, so some facts may be missing. */
  partial: boolean;
}

const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|py|java|kt|go|rs|php|rb|cs|cpp|cc|c|h|dart|swift|sql|vue|svelte|ino)$/i;
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|out|target|\.next|\.git|__pycache__|venv|\.venv|env|coverage|migrations?|assets|static|public\/vendor|bower_components|\.idea|\.vscode)(\/|$)/i;
const SKIP_FILE = /(\.min\.|\.d\.ts$|\.lock$|package-lock\.json|yarn\.lock|\.map$|\.svg$|\.(test|spec)[.-]|(^|\/)tests?\.[a-z]+$|_test\.|(^|\/)tests?\/|__tests__|(^|\/)mocks?\/|fixtures?\/|\.stories\.)/i;
const MANIFESTS = /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|pom\.xml|build\.gradle(\.kts)?|go\.mod|Cargo\.toml|composer\.json|pubspec\.yaml|Dockerfile|docker-compose\.ya?ml)$/i;
const KEY_WORDS = /(route|router|controller|service|handler|api|model|schema|store|reducer|middleware|auth|main|app|server|index|core|engine|logic|view|activity|manager)/i;

interface TreeEntry { path: string; type: string; size?: number }

/** Picks up to `n` source files worth reading: central by name, mid-sized, not tests, vendor code or generated files. */
export function pickSampleFiles(tree: TreeEntry[], n = 4): string[] {
  const scored = tree
    .filter(e => e.type === 'blob' && CODE_EXT.test(e.path) && !SKIP_DIR.test(e.path) && !SKIP_FILE.test(e.path) && !isSensitivePath(e.path) && SAFE_PATH.test(e.path) && (e.size ?? 0) >= 250 && (e.size ?? 0) <= 60_000)
    .map(e => {
      const base = e.path.split('/').pop() ?? '';
      const depth = e.path.split('/').length - 1;
      const size = e.size ?? 0;
      let s = 0;
      if (KEY_WORDS.test(base)) s += 3;
      if (KEY_WORDS.test(e.path)) s += 1;
      s += Math.max(0, 2 - depth * 0.5);
      s += size >= 1000 && size <= 15_000 ? 2 : size > 15_000 ? 1 : 0;
      return { path: e.path, s, dir: e.path.split('/').slice(0, -1).join('/') };
    })
    .sort((a, b) => b.s - a.s || a.path.localeCompare(b.path));
  const out: string[] = [], dirs = new Map<string, number>();
  for (const c of scored) {
    if ((dirs.get(c.dir) ?? 0) >= 2) continue; // spread across the project
    out.push(c.path); dirs.set(c.dir, (dirs.get(c.dir) ?? 0) + 1);
    if (out.length >= n) break;
  }
  return out;
}

/** True for a path that holds tests, in the layouts students and open-source projects use. */
export function looksLikeTestPath(p: string): boolean {
  return /(^|\/)(tests?|__tests__|spec|specs|cypress|e2e)\//i.test(p) || /\.(test|spec)[.-][a-z.]+$/i.test(p) || /(^|\/)tests?\.[a-z]+$/i.test(p) || /(^|\/)test_[^/]+\.py$/i.test(p) || /_test\.(go|py|rb)$/i.test(p) || /(^|\/)[A-Za-z0-9]+Tests?\.(java|kt|cs)$/.test(p);
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** Reads one repository in depth: languages, README, file list, dependency files, a few central source files and a commit sample. */
export async function deepScanRepo(gh: GhFetch, login: string, repo: RepoMeta, opts: { maxSamples?: number } = {}): Promise<DeepRepo> {
  if (!LOGIN.test(login) || !REPO.test(repo.name)) throw new Error('Bad repository name.');
  const base = `/repos/${login}/${repo.name}`;
  let partial = false;
  const stop = (r: GhResponse) => { if ((r.status === 403 || r.status === 429) && (r.rateRemaining === 0 || r.status === 429)) partial = true; return r; };

  const [langs, readmeRes, treeRes, commitsRes] = await Promise.all([
    gh(`${base}/languages`), gh(`${base}/readme`, { raw: true }), gh(`${base}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`), repo.fork ? Promise.resolve<GhResponse>({ status: 0 }) : gh(`${base}/commits?per_page=30`),
  ].map(p => p.then(stop)));

  const total = Object.values(langs.json ?? {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
  const languages = Object.entries(langs.json ?? {}).map(([name, v]) => ({ name, pct: total ? Math.round((Number(v) / total) * 1000) / 10 : 0 })).sort((a, b) => b.pct - a.pct).slice(0, 6);
  const readme = readmeRes.status === 200 && readmeRes.text ? scrubSecrets(readmeRes.text).slice(0, 5000) : null;

  const tree: TreeEntry[] = Array.isArray(treeRes.json?.tree) ? treeRes.json.tree.filter((e: any) => e && typeof e.path === 'string' && !isSensitivePath(e.path)).map((e: any) => ({ path: e.path, type: e.type, size: e.size })) : [];
  const filesTruncated = !!treeRes.json?.truncated;
  const paths = tree.filter(e => e.type === 'blob').map(e => e.path);
  const hasTests = paths.some(looksLikeTestPath);
  const hasCI = paths.some(p => /^\.github\/workflows\//.test(p) || /(^|\/)(\.gitlab-ci\.yml|Jenkinsfile|\.travis\.yml)$/.test(p));
  const hasDocker = paths.some(p => /(^|\/)(Dockerfile|docker-compose\.ya?ml)$/i.test(p));

  // Dependency files (at most 4, smallest depth first) and source files, fetched a few at a time.
  const manifestPaths = tree.filter(e => e.type === 'blob' && MANIFESTS.test(e.path) && !SKIP_DIR.test(e.path) && (e.size ?? 0) <= 40_000).sort((a, b) => a.path.split('/').length - b.path.split('/').length).slice(0, 4).map(e => e.path);
  const samplePaths = pickSampleFiles(tree, opts.maxSamples ?? 4);
  const fetchFile = async (p: string): Promise<string | null> => {
    if (!SAFE_PATH.test(p)) return null;
    const r = stop(await gh(`${base}/contents/${encodePath(p)}?ref=${encodeURIComponent(repo.defaultBranch)}`, { raw: true }));
    return r.status === 200 && typeof r.text === 'string' ? r.text : null;
  };
  const manifests: ManifestFile[] = [];
  const samples: { path: string; excerpt: string }[] = [];
  await Promise.all([
    ...manifestPaths.map(async p => { const t = await fetchFile(p); if (t) manifests.push({ path: p, text: t.slice(0, 20_000) }); }),
    ...samplePaths.map(async p => { const t = await fetchFile(p); if (t) samples.push({ path: p, excerpt: scrubSecrets(t).slice(0, 3500) }); }),
  ]);
  samples.sort((a, b) => samplePaths.indexOf(a.path) - samplePaths.indexOf(b.path));

  let commits: DeepRepo['commits'] = null;
  if (Array.isArray(commitsRes.json)) {
    const list = commitsRes.json;
    const dates = list.map((c: any) => c?.commit?.author?.date).filter(Boolean).sort();
    commits = {
      seen: list.length, byCandidate: list.filter((c: any) => String(c?.author?.login ?? '').toLowerCase() === login.toLowerCase()).length,
      first: dates[0] ?? null, last: dates[dates.length - 1] ?? null,
      messages: list.map((c: any) => String(c?.commit?.message ?? '').split('\n')[0].slice(0, 100)).filter(Boolean).slice(0, 8),
    };
  }
  const tech = [...new Set([...techFromManifests(manifests), ...languages.slice(0, 3).flatMap(l => techFromText(l.name)), ...techFromText(`${repo.description ?? ''} ${repo.topics.join(' ')}`), ...(readme ? techFromText(readme.slice(0, 2500)) : []), ...(hasDocker ? ['Docker'] : [])])].slice(0, 20);
  return { name: repo.name, languages, readme, files: paths.slice(0, 200), filesTruncated, tech, hasTests, hasCI, hasDocker, samples, commits, partial };
}

/** Runs `fn` over `items` with at most `n` at a time, keeping the order of results. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
