/** Turns imported repository files into skill signals. Pure: no database, no network. */
const EXT_SKILL: Record<string, string> = {
  py: 'python', java: 'java', js: 'javascript', jsx: 'react', mjs: 'javascript', ts: 'typescript', tsx: 'react', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp', go: 'go', rs: 'rust', kt: 'kotlin', php: 'php', html: 'html', css: 'css', sql: 'sql',
};
const FILE_SKILL: Record<string, string> = { dockerfile: 'docker' };

export interface ImportedFile { path: string; rawFileHash: string; bytes: Buffer | Uint8Array | null; repo: string }
export interface SkillSignal { skillSlug: string; files: number; lines: number; repos: string[]; examplePaths: string[]; contentHash: string }

const IGNORED = /(^|\/)(node_modules|vendor|dist|build|\.git|__pycache__)\//;

/** Groups imported files by the skill their extension or name shows. Counts files and non-blank lines. */
export function signalsFromFiles(files: ImportedFile[], sha256: (s: string) => string): SkillSignal[] {
  const by = new Map<string, { files: ImportedFile[]; lines: number }>();
  for (const f of files) {
    if (IGNORED.test(f.path)) continue;
    const base = f.path.split('/').pop()!.toLowerCase();
    const ext = base.includes('.') ? base.split('.').pop()! : '';
    const slug = FILE_SKILL[base] ?? EXT_SKILL[ext];
    if (!slug) continue;
    const text = f.bytes ? Buffer.from(f.bytes).toString('utf8') : '';
    const lines = text.split('\n').filter(l => l.trim().length > 0).length;
    const g = by.get(slug) ?? { files: [], lines: 0 };
    g.files.push(f); g.lines += lines;
    by.set(slug, g);
  }
  return [...by.entries()].map(([skillSlug, g]) => ({
    skillSlug, files: g.files.length, lines: g.lines,
    repos: [...new Set(g.files.map(f => f.repo))],
    examplePaths: g.files.map(f => f.path).slice(0, 3),
    contentHash: sha256(`${skillSlug}:${g.files.map(f => f.rawFileHash).sort().join(',')}`),
  })).sort((a, b) => b.lines - a.lines);
}
