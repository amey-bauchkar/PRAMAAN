import { createHash, randomBytes, randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { Router, HttpError, requireUuid, membershipId } from './http.js';
import { audit } from './audit.js';
import { Mailer } from './mailer.js';
import { Db } from './db.js';

/**
 * Onboarding by invitation. A college officer invites a person; the person gets a one-time link at their college email, signs in
 * (password, magic link or GitHub) and opens the link to claim the record. Nothing about a login alone grants a role or a college.
 */

const INVITE_DAYS = 14;
const MAX_BATCH = 500;
const STUDENT_ROLES = ['student', 'mentor', 'dept_coordinator', 'recruiter'];
const ADMIN_ONLY_ROLES = ['officer', 'college_admin'];
const EMAIL = /^[^@\s]{1,100}@[^@\s]+\.[^@\s]{2,}$/;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
/** The token travels in the URL fragment, which browsers never send to servers, logs or other sites. */
const claimUrl = (base: string, token: string) => `${base.replace(/\/$/, '')}/claim#t=${token}`;

const OFFICER = ['officer', 'college_admin', 'platform_admin'] as const;

export function registerInviteRoutes(r: Router, deps: { mailer: Mailer; webUrl: string }) {
  r.get('/api/v2/tpo/invitations', OFFICER, async ({ sql }) => {
    const rows = (await sql.query<any>(`SELECT i.id, i.email, i.full_name, i.role, i.status, i.expires_at, i.created_at, i.claimed_at, i.enrollment_no, d.code AS department
      FROM pending_invites i LEFT JOIN departments d ON d.id = i.department_id ORDER BY i.created_at DESC LIMIT 500`)).rows;
    const departments = (await sql.query<any>(`SELECT id, code, name FROM departments ORDER BY code`)).rows;
    return { invitations: rows.map(x => ({ ...x, expired: x.status === 'pending' && new Date(x.expires_at) < new Date() })), departments };
  });

  r.post('/api/v2/tpo/invitations', OFFICER, async ({ ctx, sql, body }) => {
    const list = Array.isArray(body.invitations) ? body.invitations : null;
    if (!list || list.length === 0 || list.length > MAX_BATCH) throw new HttpError(400, `Send between 1 and ${MAX_BATCH} invitations.`);
    const inviter = await membershipId(sql, ctx);
    const results: any[] = [];
    for (const raw of list) {
      const email = String(raw?.email ?? '').trim().toLowerCase();
      const role = String(raw?.role ?? 'student');
      const fail = (error: string) => results.push({ email, status: 'invalid', error });
      if (!EMAIL.test(email)) { fail('That is not a valid email address.'); continue; }
      if (![...STUDENT_ROLES, ...ADMIN_ONLY_ROLES].includes(role)) { fail('Role must be student, mentor, dept_coordinator, recruiter, officer or college_admin.'); continue; }
      if (ADMIN_ONLY_ROLES.includes(role) && ctx.role === 'officer' && role === 'college_admin') { fail('Only a college admin can invite another college admin.'); continue; }
      const fullName = String(raw?.fullName ?? '').trim();
      if (fullName.length < 2 || fullName.length > 200) { fail('Name is required.'); continue; }
      const departmentId = raw?.departmentId ? String(raw.departmentId) : null;
      if (departmentId) {
        try { requireUuid(departmentId, 'departmentId'); } catch { fail('Department is not valid.'); continue; }
        const dep = await sql.query(`SELECT 1 FROM departments WHERE id = $1`, [departmentId]); // row-level security limits this to this college
        if (dep.rows.length === 0) { fail('That department is not in this college.'); continue; }
      }
      let enrollmentNo: string | null = null, gradYear: number | null = null, dob: string | null = null;
      const level = ['undergraduate', 'diploma', 'postgraduate'].includes(raw?.programLevel) ? raw.programLevel : 'undergraduate';
      if (role === 'student') {
        enrollmentNo = String(raw?.enrollmentNo ?? '').trim();
        gradYear = Number(raw?.graduatingYear);
        dob = String(raw?.dateOfBirth ?? '').trim();
        if (!enrollmentNo || enrollmentNo.length > 50) { fail('Enrolment number is required.'); continue; }
        if (!Number.isInteger(gradYear) || gradYear < 2000 || gradYear > 2100) { fail('Graduating year is required.'); continue; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob)) || new Date(dob) > new Date()) { fail('Date of birth is required (YYYY-MM-DD). It decides which test checks apply.'); continue; }
        if (!departmentId) { fail('Department is required for a student.'); continue; }
      }
      if (role === 'dept_coordinator' && !departmentId) { fail('Department is required for a department coordinator.'); continue; }

      const token = newToken();
      const id = randomUUID();
      try {
        // A savepoint-free insert: a duplicate raises 23505 inside the transaction, so check first instead.
        const dup = await sql.query(`SELECT 1 FROM pending_invites WHERE lower(email) = $1 AND role = $2 AND status = 'pending'`, [email, role]);
        if (dup.rows.length) { results.push({ email, status: 'duplicate', error: 'An invitation for this person and role is already waiting. Use Resend to issue a new link.' }); continue; }
        await sql.query(`INSERT INTO pending_invites (id, org_id, email, full_name, role, department_id, enrollment_no, graduating_year, program_level, date_of_birth, token_hash, invited_by, expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + ($13 * interval '1 day'))`,
          [id, ctx.orgId, email, fullName, role, departmentId, enrollmentNo, gradYear, level, dob, sha256(token), inviter, INVITE_DAYS]);
      } catch (e: any) {
        if (e?.code === '23505') { results.push({ email, status: 'duplicate', error: 'This enrolment number or invitation already exists.' }); continue; }
        throw e;
      }
      await audit(sql, ctx, 'INVITATION_CREATED', 'pending_invite', id, { role });
      results.push({ id, email, status: 'created', claimUrl: claimUrl(deps.webUrl, token), ...(await deliver(deps.mailer, email, fullName, claimUrl(deps.webUrl, token))) });
    }
    return { results, note: deps.mailer.transport === 'smtp' ? 'Links were also emailed.' : 'No mail server is set up, so nothing was emailed. Copy each link and send it to the person yourself. A link is shown only now.' };
  });

  r.post('/api/v2/tpo/invitations/:id/revoke', OFFICER, async ({ ctx, sql, params }) => {
    const id = requireUuid(params.id, 'id');
    const res = await sql.query(`UPDATE pending_invites SET status = 'revoked' WHERE id = $1 AND status = 'pending' RETURNING id`, [id]);
    if (res.rows.length === 0) throw new HttpError(404, 'No waiting invitation with this id.');
    await audit(sql, ctx, 'INVITATION_REVOKED', 'pending_invite', id, {});
    return { ok: true };
  });

  /** Issues a fresh link. The old link stops working at once. */
  r.post('/api/v2/tpo/invitations/:id/resend', OFFICER, async ({ ctx, sql, params }) => {
    const id = requireUuid(params.id, 'id');
    const token = newToken();
    const res = await sql.query<any>(`UPDATE pending_invites SET token_hash = $2, expires_at = now() + ($3 * interval '1 day') WHERE id = $1 AND status = 'pending' RETURNING email, full_name`, [id, sha256(token), INVITE_DAYS]);
    if (res.rows.length === 0) throw new HttpError(404, 'No waiting invitation with this id.');
    await audit(sql, ctx, 'INVITATION_REISSUED', 'pending_invite', id, {});
    const url = claimUrl(deps.webUrl, token);
    return { claimUrl: url, ...(await deliver(deps.mailer, res.rows[0].email, res.rows[0].full_name, url)) };
  });
}

async function deliver(mailer: Mailer, to: string, name: string, url: string): Promise<{ emailed: boolean; emailError?: string }> {
  if (mailer.transport !== 'smtp') return { emailed: false };
  const out = await mailer.send({
    to, subject: 'Your PRAMAAN invitation',
    text: `Hello ${name},\n\nYour college has invited you to PRAMAAN. Sign in (or create an account) and then open this link to join:\n\n${url}\n\nThe link works once and expires in ${INVITE_DAYS} days. If you did not expect this, ignore this email.`,
  });
  return out.ok ? { emailed: true } : { emailed: false, emailError: out.error };
}

/** Claim: a signed-in person with no record yet turns a one-time link into their record. */
export function registerClaimRoute(
  app: FastifyInstance, db: Db,
  identity: (authHeader?: string) => Promise<{ ok: true; sub: string; email: string | null; emailVerified: boolean; provider: string } | { ok: false; statusCode: number; error: string }>
) {
  const map: Record<string, [number, string]> = {
    INVITE_INVALID: [404, 'This link is not valid. Ask your placement office for a new one.'],
    INVITE_USED: [409, 'This link has already been used.'],
    INVITE_REVOKED: [410, 'This invitation was cancelled. Ask your placement office.'],
    INVITE_EXPIRED: [410, 'This link has expired. Ask your placement office for a new one.'],
    EMAIL_NOT_VERIFIED: [403, 'Confirm your email address first (check your inbox), then open the link again.'],
    INVITE_EMAIL_MISMATCH: [403, 'This invitation was sent to a different email address. Sign in with that address.'],
    EMAIL_IN_USE: [409, 'That college email already belongs to another login. Ask your placement office to help.'],
    ALREADY_MEMBER_OTHER_ROLE: [409, 'You already have a different role in this college. Ask an officer to change it.'],
  };
  app.post('/api/auth/claim', async (req, reply) => {
    const who = await identity(req.headers['authorization']);
    if (!who.ok) return reply.status(who.statusCode).send({ error: who.error });
    const token = (req.body as any)?.token;
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return reply.status(400).send({ error: 'This link is not valid. Ask your placement office for a new one.' });
    try {
      const row = await db.withPublic(async sql => (await sql.query<any>(`SELECT * FROM claim_invitation($1,$2,$3,$4)`, [sha256(token), who.sub, who.emailVerified ? who.email : null, who.provider])).rows[0]);
      const ctx = { userId: row.out_user_id, orgId: row.out_org_id, role: row.out_role, departmentId: null } as any;
      await db.withTenant(ctx, async sql => { await audit(sql, ctx, 'INVITATION_CLAIMED', 'user', row.out_user_id, { role: row.out_role, provider: who.provider }); });
      const workspace = row.out_role === 'student' ? 'student' : row.out_role === 'recruiter' ? 'recruiter' : 'tpo';
      return { orgId: row.out_org_id, role: row.out_role, workspace };
    } catch (e: any) {
      const key = Object.keys(map).find(k => String(e?.message ?? '').includes(k));
      if (key) return reply.status(map[key][0]).send({ error: map[key][1], code: key });
      req.log.error(e);
      return reply.status(500).send({ error: 'Could not complete the invitation. Try again in a moment.' });
    }
  });
}
