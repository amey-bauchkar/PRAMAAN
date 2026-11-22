import { createHash } from 'crypto';
import {
  parseGitHubProfile, matchProject, nameTokens, readmeTitle, scrubSecrets, techFromText, KitQuestion, ProjectFacts, ResumeProject, RepoMatch,
} from '@pramaan/domain';
import { Router, HttpError, requireUuid, membershipId } from './http.js';
import { audit } from './audit.js';
import { displayName } from './services.js';
import { grantFor, SHAREABLE } from './routes-recruiter.js';
import { FailoverLlm } from './llm.js';
import { extractResumeProjects, generateProjectQuestions } from './kit-ai.js';
import { createGhFetch, deepScanRepo, DeepRepo, GhFetch, looksLikeGithubToken, pool, RepoMeta, scanProfile } from './github-scan.js';

/**
 * Project interview kit (recruiter workspace). The recruiter picks a candidate who chose to share with recruiters, pastes the candidate's
 * GitHub profile and resume; PRAMAAN scans the public repositories, finds each highlighted project among them, and drafts easy, medium
 * and hard questions. Nothing here scores the candidate. GitHub and the model are called OUTSIDE any database transaction.
 */

export interface KitDeps {
  llm: FailoverLlm | null;
  /** Builds a GitHub fetcher for a token (the recruiter's sign-in, else the server's). Tests pass a stand-in so nothing touches the network. */
  githubFetch?: (token?: string) => GhFetch;
  pdfToText?: (buf: Buffer) => Promise<string>;
  /** Optional server-wide read-only token for GitHub's higher request limit. */
  serverToken?: string;
}

export async function defaultPdfToText(buf: Buffer): Promise<string> {
  const { default: pdf } = await import('pdf-parse/lib/pdf-parse.js');
  return String((await pdf(buf, { max: 8 })).text ?? '');
}

const R = ['recruiter'] as const;
const MAX_PDF_BYTES = 3 * 1024 * 1024;
const DEEP_CAP = 10;
/** READMEs read (one request each) to find projects whose repository is named differently. */
const PROBE_CAP = 14;
const CALLS_PER_REPO = 11;
const iso = (v: any) => (v ? new Date(v).toISOString() : null);

interface StoredProject {
  index: number; name: string; summary: string; tech: string[];
  match: { repo: string; url: string; description: string | null; language: string | null; stars: number; fork: boolean; pushedAt: string | null; score: number; strength: 'strong' | 'possible'; reasons: string[]; alternatives: { repo: string; score: number }[] } | null;
  facts: ProjectFacts;
  questions: { items: KitQuestion[]; source: string; model: string | null; perLevel: number; generatedAt: string } | null;
}

/** What the browser sees: what was found and what it is based on, without the stored code excerpts. */
function view(k: any) {
  return {
    id: k.id, createdAt: iso(k.created_at), github: k.profile, studentId: k.student_id,
    scan: { reposTotal: k.repos_total, reposDeep: k.repos_deep, rateLimited: k.rate_limited, token: k.token_used },
    extraction: k.models?.extraction ?? null,
    projects: (k.projects as StoredProject[]).map(p => ({
      index: p.index, name: p.name, summary: p.summary, tech: p.tech, match: p.match,
      status: !p.match ? 'not_found' : p.match.strength === 'strong' ? 'matched' : 'possible',
      scanned: { files: p.facts.files.length, samplePaths: p.facts.samples.map(s => s.path), hasTests: p.facts.hasTests, hasCI: p.facts.hasCI, hasDocker: p.facts.hasDocker, commits: p.facts.commits, repoTech: p.facts.tech },
      questions: p.questions,
    })),
  };
}

function buildFacts(p: ResumeProject, meta: RepoMeta | null, deep: DeepRepo | null, login: string, strong: boolean): ProjectFacts {
  const tech = [...new Set([...p.tech, ...(deep?.tech ?? [])])].slice(0, 16);
  return {
    name: p.name, summary: p.summary, tech,
    repo: meta ? { name: meta.name, description: meta.description, url: meta.url, fork: meta.fork, matched: strong } : null,
    readmeExcerpt: deep?.readme ? deep.readme.slice(0, 2500) : null,
    files: deep?.files.slice(0, 80) ?? [], samples: deep?.samples ?? [],
    hasTests: deep?.hasTests ?? false, hasCI: deep?.hasCI ?? false, hasDocker: deep?.hasDocker ?? false,
    commits: deep?.commits ? { seen: deep.commits.seen, byCandidate: deep.commits.byCandidate, first: deep.commits.first, last: deep.commits.last } : null,
  };
}

function nameCheck(profileName: string | null, candidate: string): 'same' | 'different' | 'unknown' {
  if (!profileName) return 'unknown';
  const a = nameTokens(profileName), b = nameTokens(candidate);
  if (!a.length || !b.length) return 'unknown';
  return a.some(t => b.includes(t)) ? 'same' : 'different';
}

export function registerKitRoutes(r: Router, deps: KitDeps) {
  const pdfToText = deps.pdfToText ?? defaultPdfToText;
  const ghFor = (token?: string) => (deps.githubFetch ? deps.githubFetch(token) : createGhFetch({ token }));

  r.getOutside('/api/v2/recruiter/kit/candidates', R, async ({ ctx, query, tx }) => {
    const driveId = requireUuid(query.driveId, 'driveId');
    return tx(async sql => {
      const mid = await membershipId(sql, ctx);
      await grantFor(sql, mid, driveId);
      const rows = (await sql.query<any>(`SELECT s.id, u.full_name, d.code AS branch FROM students s JOIN users u ON u.id = s.user_id JOIN departments d ON d.id = s.department_id WHERE ${SHAREABLE} ORDER BY u.full_name`, [driveId])).rows;
      return { candidates: rows.map(x => ({ id: x.id, name: displayName(x.full_name), branch: x.branch })), llm: deps.llm ? 'configured' : 'none', githubToken: deps.serverToken ? 'server' : 'none' };
    });
  });

  r.getOutside('/api/v2/recruiter/kit', R, async ({ ctx, query, tx }) => {
    return tx(async sql => {
      const mid = await membershipId(sql, ctx);
      const rows = (await sql.query<any>(`SELECT id, student_id, github_login, repos_total, created_at, jsonb_array_length(projects) AS n FROM project_kits WHERE recruiter_membership_id = $1 AND ($2::uuid IS NULL OR student_id = $2) ORDER BY created_at DESC LIMIT 30`,
        [mid, query.studentId ? requireUuid(query.studentId, 'studentId') : null])).rows;
      return { kits: rows.map(x => ({ id: x.id, studentId: x.student_id, github: x.github_login, repos: x.repos_total, projects: x.n, createdAt: iso(x.created_at) })) };
    });
  });

  r.getOutside('/api/v2/recruiter/kit/:id', R, async ({ ctx, params, tx }) => {
    const id = requireUuid(params.id, 'id');
    return tx(async sql => {
      const mid = await membershipId(sql, ctx);
      const k = (await sql.query<any>(`SELECT * FROM project_kits WHERE id = $1 AND recruiter_membership_id = $2`, [id, mid])).rows[0];
      if (!k) throw new HttpError(404, 'No interview kit with this id.');
      return view(k);
    });
  });

  r.postOutside('/api/v2/recruiter/kit/scan', R, async ({ ctx, body, tx }) => {
    const driveId = requireUuid(body.driveId, 'driveId');
    const studentId = requireUuid(body.studentId, 'studentId');
    const login = parseGitHubProfile(String(body.githubProfile ?? ''));
    if (!login) throw new HttpError(400, 'Paste the candidate’s GitHub profile link, for example https://github.com/username.');

    let resumeText = typeof body.resumeText === 'string' ? body.resumeText : '';
    let source: 'paste' | 'pdf' = 'paste';
    if (!resumeText.trim() && typeof body.resumePdfBase64 === 'string' && body.resumePdfBase64) {
      const buf = Buffer.from(body.resumePdfBase64, 'base64');
      if (buf.length > MAX_PDF_BYTES) throw new HttpError(413, 'The PDF is larger than 3 MB. Paste the text of the Projects section instead.');
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'That file is not a PDF.');
      try { resumeText = await pdfToText(buf); } catch { throw new HttpError(422, 'The PDF could not be read. Paste the resume text instead.'); }
      source = 'pdf';
    }
    if (resumeText.length > 80_000) throw new HttpError(413, 'The resume text is too long. Paste only the Projects section.');
    if (resumeText.trim().length < 40) throw new HttpError(400, 'Paste the candidate’s resume text, or upload it as a PDF. A scanned image of a resume cannot be read.');

    // 1. Access: an approved grant for this drive, and a candidate who chose to share with recruiters.
    const { mid, cand } = await tx(async sql => {
      const mid = await membershipId(sql, ctx);
      await grantFor(sql, mid, driveId);
      const cand = (await sql.query<any>(`SELECT s.id, u.full_name FROM students s JOIN users u ON u.id = s.user_id WHERE ${SHAREABLE} AND s.id = $2`, [driveId, studentId])).rows[0];
      if (!cand) throw new HttpError(403, 'This candidate is not available to you for this drive. They must be eligible or have applied, and must have agreed to share with recruiters.');
      return { mid, cand };
    });

    // 2. Outside work, with no database transaction held open.
    const token = looksLikeGithubToken(body.githubToken) ? body.githubToken : undefined;
    const used: 'recruiter' | 'server' | 'none' = token ? 'recruiter' : deps.serverToken ? 'server' : 'none';
    const gh = ghFor(token ?? deps.serverToken);
    const [scan, extracted] = await Promise.all([scanProfile(gh, login), extractResumeProjects(deps.llm, resumeText)]);
    if (extracted.projects.length === 0) throw new HttpError(422, 'No projects were found in the resume. Paste the text of its Projects section.');

    // 3. Match each resume project to repositories by what GitHub lists, read the best candidates in depth, then match again with their README and technology.
    // 3a. A README often names a project better than its repository does ("Warrant" lives in a repository called "Mindspark"). For projects
    // without a strong match, read a few README files, one request each, and look again with their titles and words.
    let remaining = scan.rateRemaining;
    const probed = new Map<string, { readme: string; title: string | null; tech: string[] }>();
    const metaOnly = extracted.projects.map(p => matchProject(p, scan.repos));
    if (metaOnly.some(m => !m[0] || m[0].strength !== 'strong')) {
      const strong = new Set(metaOnly.flatMap(m => m.filter(x => x.strength === 'strong').map(x => x.repo)));
      const room = remaining === null ? PROBE_CAP : Math.max(0, Math.min(PROBE_CAP, remaining - 20));
      const toRead = scan.repos.filter(x => !x.fork && !strong.has(x.name)).slice(0, room);
      await pool(toRead, 3, async r => {
        const res = await gh(`/repos/${login}/${r.name}/readme`, { raw: true });
        if (res.status === 200 && res.text) { const text = scrubSecrets(res.text).slice(0, 4000); probed.set(r.name, { readme: text, title: readmeTitle(text), tech: techFromText(text.slice(0, 2500)) }); }
      });
      if (remaining !== null) remaining -= toRead.length;
    }
    const lite = scan.repos.map(x => ({ ...x, readme: probed.get(x.name)?.readme ?? null, title: probed.get(x.name)?.title ?? null, tech: probed.get(x.name)?.tech }));
    const first = extracted.projects.map(p => matchProject(p, lite));
    const wanted = [...new Set(first.flatMap(m => m.filter(x => x.score >= 0.3).slice(0, 2).map(x => x.repo)))];
    const recent = scan.repos.filter(x => !x.fork && !x.archived && !wanted.includes(x.name)).map(x => x.name);
    const budget = remaining === null ? DEEP_CAP : Math.max(0, Math.min(DEEP_CAP, Math.floor((remaining - 8) / CALLS_PER_REPO)));
    const deepNames = [...wanted, ...recent].slice(0, budget);
    const deepList = await pool(deepNames, 3, async name => { const meta = scan.repos.find(x => x.name === name)!; try { return await deepScanRepo(gh, login, meta); } catch { return null; } });
    const deep = new Map<string, DeepRepo>();
    deepList.forEach((d, i) => { if (d) deep.set(deepNames[i], d); });
    const rateLimited = budget < Math.min(DEEP_CAP, wanted.length) || [...deep.values()].some(d => d.partial);
    const enriched = scan.repos.map(x => ({ ...x, readme: deep.get(x.name)?.readme ?? probed.get(x.name)?.readme ?? null, title: probed.get(x.name)?.title ?? readmeTitle(deep.get(x.name)?.readme), tech: deep.get(x.name)?.tech ?? probed.get(x.name)?.tech }));

    const projects: StoredProject[] = extracted.projects.map((p, index) => {
      const m: RepoMatch[] = matchProject(p, enriched);
      const best = m[0];
      const meta = best ? scan.repos.find(x => x.name === best.repo) ?? null : null;
      return {
        index, name: p.name, summary: p.summary, tech: p.tech,
        match: best && meta ? { repo: meta.name, url: meta.url, description: meta.description, language: meta.language, stars: meta.stars, fork: meta.fork, pushedAt: meta.pushedAt, score: best.score, strength: best.strength, reasons: best.reasons, alternatives: m.slice(1).map(x => ({ repo: x.repo, score: x.score })) } : null,
        facts: buildFacts(p, meta, meta ? deep.get(meta.name) ?? null : null, login, best?.strength === 'strong'),
        questions: null,
      };
    });

    const languageCount = new Map<string, number>();
    for (const x of scan.repos) if (x.language && !x.fork) languageCount.set(x.language, (languageCount.get(x.language) ?? 0) + 1);
    const profile = {
      login: scan.login, name: scan.name, bio: scan.bio, publicRepos: scan.publicRepos, followers: scan.followers, createdAt: scan.createdAt,
      nameCheck: nameCheck(scan.name, displayName(cand.full_name)), candidateName: displayName(cand.full_name),
      topLanguages: [...languageCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, repos]) => ({ name, repos })),
      forks: scan.repos.filter(x => x.fork).length,
      recent: scan.repos.slice(0, 12).map(x => ({ name: x.name, language: x.language, stars: x.stars, fork: x.fork, pushedAt: x.pushedAt, url: x.url })),
      truncated: scan.truncated,
    };

    // 4. Save only derived data. The resume text is not kept, only its hash.
    const id = await tx(async sql => {
      const row = (await sql.query<any>(`INSERT INTO project_kits (org_id, student_id, drive_id, recruiter_membership_id, github_login, resume_sha256, resume_source, repos_total, repos_deep, rate_limited, token_used, profile, projects, models)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [ctx.orgId, studentId, driveId, mid, scan.login, createHash('sha256').update(resumeText).digest('hex'), source, scan.repos.length, deep.size, rateLimited, used, JSON.stringify(profile), JSON.stringify(projects), JSON.stringify({ extraction: extracted.by })])).rows[0];
      await audit(sql, ctx, 'PROJECT_KIT_SCANNED', 'project_kit', row.id, { studentId, github: scan.login, repos: scan.repos.length, deep: deep.size, projects: projects.length, token: used });
      return row.id as string;
    });
    return tx(async sql => view((await sql.query<any>(`SELECT * FROM project_kits WHERE id = $1`, [id])).rows[0]));
  }, { bodyLimit: 5 * 1024 * 1024 });

  r.postOutside('/api/v2/recruiter/kit/:id/questions', R, async ({ ctx, params, body, tx }) => {
    const id = requireUuid(params.id, 'id');
    const index = Number(body.projectIndex);
    const perLevel = Math.max(1, Math.min(4, Math.round(Number(body.perLevel ?? 2)) || 2));
    const proj = await tx(async sql => {
      const mid = await membershipId(sql, ctx);
      const k = (await sql.query<any>(`SELECT projects FROM project_kits WHERE id = $1 AND recruiter_membership_id = $2`, [id, mid])).rows[0];
      if (!k) throw new HttpError(404, 'No interview kit with this id.');
      const p = (k.projects as StoredProject[])[index];
      if (!Number.isInteger(index) || !p) throw new HttpError(400, 'That project is not in this kit.');
      return p;
    });
    const out = await generateProjectQuestions(deps.llm, proj.facts, perLevel);
    const stored = { items: out.questions, source: out.source, model: out.model, perLevel, generatedAt: new Date().toISOString() };
    await tx(async sql => {
      const res = await sql.query(`UPDATE project_kits SET projects = jsonb_set(projects, ARRAY[$2::text, 'questions'], $3::jsonb), models = jsonb_set(models, '{questions}', to_jsonb($4::text)), updated_at = now() WHERE id = $1 RETURNING id`,
        [id, String(index), JSON.stringify(stored), out.source + (out.model ? `:${out.model}` : '')]);
      if (res.rows.length === 0) throw new HttpError(404, 'No interview kit with this id.');
      await audit(sql, ctx, 'PROJECT_KIT_QUESTIONS', 'project_kit', id, { project: index, source: out.source, model: out.model, dropped: out.dropped });
    });
    return { index, questions: stored };
  });
}
