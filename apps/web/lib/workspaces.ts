/**
 * Workspace and module map. Every module of the problem statement (PS p4–p6) has a screen; `roles`
 * limits a module to some roles inside the workspace (the API enforces the same rules).
 */
export type WorkspaceKey = 'student' | 'tpo' | 'recruiter' | 'university';

export interface ModuleDef { slug: string; title: string; req: string; summary: string; roles?: string[] }
export interface WorkspaceDef { key: WorkspaceKey; title: string; audience: string; modules: ModuleDef[] }

const OFFICERS = ['officer', 'college_admin', 'dept_coordinator', 'platform_admin'];

export const WORKSPACES: Record<WorkspaceKey, WorkspaceDef> = {
  student: {
    key: 'student', title: 'Student', audience: 'Your skills, proof of your work and company drives',
    modules: [
      { slug: 'profile', title: 'Skills & Resume', req: 'ST-01', summary: 'See every skill, how well it is proven and when to check it again. Create a resume from your verified skills.' },
      { slug: 'import', title: 'Add Your Work', req: 'ST-02', summary: 'Connect GitHub (read-only), link LeetCode or Codeforces, and add lab work, certificates and contest results.' },
      { slug: 'proofs', title: 'Prove a Skill', req: 'ST-03', summary: 'See why each skill has its status and how to improve it, including a short check on your own code.' },
      { slug: 'targets', title: 'Companies & Skill Gaps', req: 'ST-04', summary: 'See roles that suit you best and which skills you still need for each.' },
      { slug: 'mock-drive', title: 'Practice Drive', req: 'ST-05', summary: 'Practise a full campus drive: aptitude (30 questions), coding test (2 problems) and interview. Then see your weak topics.' },
      { slug: 'learning-path', title: 'Learning Plan', req: 'ST-06', summary: 'Tasks picked for your skill gaps and weak topics. Each one you pass adds new proof to your profile.' },
      { slug: 'drives', title: 'My Drives', req: 'ST-07', summary: 'See whether you are eligible for each drive, with a reason for every rule, and the quickest way to qualify for more.' },
      { slug: 'offers', title: 'My Offers', req: 'New', summary: 'Offers signed by recruiters. Accept by signing, and keep a receipt that proves your placement.' },
      { slug: 'passes', title: 'Eligibility Pass', req: 'New', summary: 'Show a recruiter that you meet a drive’s requirements while sharing only what you choose.' },
      { slug: 'privacy', title: 'Privacy & Consent', req: 'ST-08', summary: 'Choose what you share, take it back at any time, download or delete your data, and see how scores work.' },
    ],
  },
  tpo: {
    key: 'tpo', title: 'Placement Office', audience: 'Batch readiness, eligibility rules, drives and records',
    modules: [
      { slug: 'cohort', title: 'Batch Dashboard', req: 'AD-01', summary: 'Skill map for the batch, six key numbers with how they are calculated, practice drive results, and before/after training results.', roles: OFFICERS },
      { slug: 'demand', title: 'Industry Skill Gaps', req: 'AD-02', summary: 'Compare the skills companies ask for with the skills your batch has proven, with alerts for big gaps.', roles: OFFICERS },
      { slug: 'readiness', title: 'Placement Readiness', req: 'AD-03', summary: 'A forecast range for placements and a private list of students who need support, with the reasons shown.', roles: OFFICERS },
      { slug: 'mock-setup', title: 'Practice Drive Setup', req: 'AD-04', summary: 'Manage question banks and coding problems, and approve drafted interview questions.', roles: OFFICERS },
      { slug: 'outreach', title: 'Bulk Mailing', req: 'AD-05', summary: 'Send one email template to many companies and track delivery and replies.', roles: OFFICERS },
      { slug: 'drives', title: 'Drives & Calendar', req: 'AD-06', summary: 'One calendar for all drives, warnings for clashes, and company emails turned into suggested time slots.', roles: OFFICERS },
      { slug: 'rules', title: 'Eligibility Rules & Appeals', req: 'AD-07', summary: 'Write rules, preview who would qualify and whether it is fair, publish them, and review student appeals.', roles: OFFICERS },
      { slug: 'applications', title: 'Shortlists & Offers', req: 'BR-19', summary: 'Move candidates through each stage and send offers. Every change is recorded.', roles: OFFICERS },
      { slug: 'proposals', title: 'Proposals', req: 'AD-09', summary: 'Anything an automated helper (a fixed rule or, where configured, a language model) drafts waits here until you approve it.', roles: OFFICERS },
      { slug: 'fairness', title: 'Fairness Check', req: 'AD-10', summary: 'Compare selection rates between groups at each stage. Very small groups are hidden to protect privacy.', roles: OFFICERS },
      { slug: 'ledger', title: 'Trust Ledger', req: 'New', summary: 'Placements signed by recruiters and students in a public log where any later change shows up in the checks an auditor can run.', roles: OFFICERS },
      { slug: 'accreditation', title: 'Accreditation Reports', req: 'AD-11', summary: 'Placement tables for NAAC and NIRF reports in one click.', roles: OFFICERS },
      { slug: 'roles', title: 'Team & Activity Log', req: 'AD-12', summary: 'Who has access to this college’s account, and a record of what each person did that cannot be edited.', roles: OFFICERS },
      { slug: 'reviews', title: 'Evidence Reviews', req: 'ST-02', summary: 'Review students’ lab work, certificates and projects and approve them against a checklist.', roles: [...OFFICERS, 'mentor'] },
    ],
  },
  recruiter: {
    key: 'recruiter', title: 'Recruiter', audience: 'Candidates with checked skills from approved drives',
    modules: [
      { slug: 'search', title: 'Candidate Search', req: 'AD-08', summary: 'Filter by verified skill, level of proof and how recent it is. Every match comes with a reason.' },
      { slug: 'pipeline', title: 'Hiring Stages & Feedback', req: 'BR-19', summary: 'See candidates by stage and give feedback after each round.' },
    ],
  },
  university: {
    key: 'university', title: 'University', audience: 'Results across colleges',
    modules: [{ slug: 'outcomes', title: 'Outcomes Across Colleges', req: 'AD-12', summary: 'Placement results and verified skills for each college. Totals only, no individual students.' },
      { slug: 'witness', title: 'Ledger Witness', req: 'New', summary: 'Sign each college’s placement log with your own key, so a rewrite of history shows up even if the log is signed again.' }],
  },
};

export function isWorkspaceKey(v: string): v is WorkspaceKey { return v in WORKSPACES; }
export function modulesFor(ws: WorkspaceKey, role: string | null): ModuleDef[] {
  return WORKSPACES[ws].modules.filter(m => !m.roles || !role || m.roles.includes(role));
}
