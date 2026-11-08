import pg from 'pg';
import { OrganizationDiscovery, Student, SessionContext } from '@pramaan/contracts';
import { withTenantTransaction, getDbPool } from '../db/pool.js';
import { TenantStore } from '../services/tenant-store.js';

export interface ITenantRepository {
  getOrganization(context: SessionContext, id: string): Promise<OrganizationDiscovery | null>;
  listOrganizations(context: SessionContext): Promise<OrganizationDiscovery[]>;
  listStudents(context: SessionContext): Promise<Student[]>;
  getStudent(context: SessionContext, studentId: string): Promise<Student | null>;
  getStudentByUserId(context: SessionContext, userId: string): Promise<Student | null>;
}

export class InMemoryTenantRepository implements ITenantRepository {
  constructor(private store: TenantStore = new TenantStore()) {}

  public async getOrganization(context: SessionContext, id: string): Promise<OrganizationDiscovery | null> {
    const callerOrg = this.store.getOrganization(context.orgId);
    const targetOrg = this.store.getOrganization(id);
    if (!targetOrg) return null;

    // RLS Invariant: Caller can discover own organization, parent university, or affiliated colleges
    const isSelf = targetOrg.id === context.orgId;
    const isParentUni = Boolean(callerOrg?.parentId && callerOrg.parentId === targetOrg.id);
    const isAffiliatedCollege = targetOrg.parentId === context.orgId;

    if (!isSelf && !isParentUni && !isAffiliatedCollege) {
      return null;
    }

    return {
      id: targetOrg.id,
      parentId: targetOrg.parentId,
      kind: targetOrg.kind,
      name: targetOrg.name,
      createdAt: targetOrg.createdAt,
      updatedAt: targetOrg.updatedAt
    };
  }

  public async listOrganizations(context: SessionContext): Promise<OrganizationDiscovery[]> {
    const callerOrg = this.store.getOrganization(context.orgId);
    return this.store.listOrganizations()
      .filter(targetOrg => {
        const isSelf = targetOrg.id === context.orgId;
        const isParentUni = Boolean(callerOrg?.parentId && callerOrg.parentId === targetOrg.id);
        const isAffiliatedCollege = targetOrg.parentId === context.orgId;
        return isSelf || isParentUni || isAffiliatedCollege;
      })
      .map(org => ({
        id: org.id,
        parentId: org.parentId,
        kind: org.kind,
        name: org.name,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt
      }));
  }

  public async listStudents(context: SessionContext): Promise<Student[]> {
    return this.store.listStudents(context);
  }

  public async getStudent(context: SessionContext, studentId: string): Promise<Student | null> {
    return this.store.getStudent(context, studentId);
  }

  public async getStudentByUserId(context: SessionContext, userId: string): Promise<Student | null> {
    return this.store.getStudentByUserId(context, userId);
  }
}

export class PgTenantRepository implements ITenantRepository {
  constructor(private pool: pg.Pool = getDbPool()) {}

  /**
   * Tenant-scoped organization query:
   * Executes strictly inside withTenantTransaction under app_api role.
   * Kernel RLS enforces that a college cannot query another college's record.
   * Returns sanitized discovery metadata only (never internal config, keys, or rate limits).
   */
  public async getOrganization(context: SessionContext, id: string): Promise<OrganizationDiscovery | null> {
    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT id, parent_id, kind, name, created_at, updated_at
        FROM organizations
        WHERE id = $1;
      `;
      const res = await client.query(query, [id]);
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        id: row.id,
        parentId: row.parent_id,
        kind: row.kind,
        name: row.name,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      };
    }, this.pool);
  }

  /**
   * Tenant-scoped organization discovery:
   * Executes strictly inside withTenantTransaction under app_api role.
   * Kernel RLS policy (tenant_isolation_organizations: id = current_app_org_id() OR id = current_app_parent_org_id() OR parent_id = current_app_org_id())
   * guarantees that a college cannot discover foreign colleges or unrelated universities.
   * Returns sanitized discovery metadata only.
   */
  public async listOrganizations(context: SessionContext): Promise<OrganizationDiscovery[]> {
    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT id, parent_id, kind, name, created_at, updated_at
        FROM organizations
        ORDER BY name;
      `;
      const res = await client.query(query);
      return res.rows.map(row => ({
        id: row.id,
        parentId: row.parent_id,
        kind: row.kind,
        name: row.name,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      }));
    }, this.pool);
  }

  public async listStudents(context: SessionContext): Promise<Student[]> {
    // RLS-06: University admin gets 0 student-level rows
    if (context.role === 'university_admin') {
      return [];
    }

    return withTenantTransaction(context, async (client) => {
      let query = `
        SELECT id, org_id, user_id, department_id, enrollment_no, graduating_year, program_level, is_minor, age_verified_at, created_at
        FROM students
      `;
      const params: any[] = [];

      // Student role restriction: Can only view their own student row
      if (context.role === 'student') {
        query += ` WHERE user_id = $1`;
        params.push(context.userId);
      }

      query += ` ORDER BY created_at DESC;`;

      const res = await client.query(query, params);
      return res.rows.map(row => ({
        id: row.id,
        orgId: row.org_id,
        userId: row.user_id,
        departmentId: row.department_id,
        enrollment_no: row.enrollment_no,
        graduating_year: row.graduating_year,
        program_level: row.program_level,
        is_minor: row.is_minor,
        age_verified_at: row.age_verified_at ? new Date(row.age_verified_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString()
      }));
    }, this.pool);
  }

  public async getStudent(context: SessionContext, studentId: string): Promise<Student | null> {
    // RLS-06: University admin gets 0 student-level rows
    if (context.role === 'university_admin') {
      return null;
    }

    return withTenantTransaction(context, async (client) => {
      let query = `
        SELECT id, org_id, user_id, department_id, enrollment_no, graduating_year, program_level, is_minor, age_verified_at, created_at
        FROM students
        WHERE id = $1
      `;
      const params: any[] = [studentId];

      if (context.role === 'student') {
        query += ` AND user_id = $2`;
        params.push(context.userId);
      }

      const res = await client.query(query, params);
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        id: row.id,
        orgId: row.org_id,
        userId: row.user_id,
        departmentId: row.department_id,
        enrollment_no: row.enrollment_no,
        graduating_year: row.graduating_year,
        program_level: row.program_level,
        is_minor: row.is_minor,
        age_verified_at: row.age_verified_at ? new Date(row.age_verified_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString()
      };
    }, this.pool);
  }

  public async getStudentByUserId(context: SessionContext, userId: string): Promise<Student | null> {
    // RLS-06: University admin gets 0 student-level rows
    if (context.role === 'university_admin') {
      return null;
    }

    return withTenantTransaction(context, async (client) => {
      const query = `
        SELECT id, org_id, user_id, department_id, enrollment_no, graduating_year, program_level, is_minor, age_verified_at, created_at
        FROM students
        WHERE user_id = $1 AND org_id = current_app_org_id()
      `;
      const params: any[] = [userId];

      if (context.role === 'student' && userId !== context.userId) {
        return null;
      }

      const res = await client.query(query, params);
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        id: row.id,
        orgId: row.org_id,
        userId: row.user_id,
        departmentId: row.department_id,
        enrollment_no: row.enrollment_no,
        graduating_year: row.graduating_year,
        program_level: row.program_level,
        is_minor: row.is_minor,
        age_verified_at: row.age_verified_at ? new Date(row.age_verified_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString()
      };
    }, this.pool);
  }
}
