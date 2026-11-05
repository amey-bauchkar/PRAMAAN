import pg from 'pg';
import { Organization, Student, SessionContext } from '@pramaan/contracts';
import { withTenantTransaction, getDbPool } from '../db/pool.js';
import { TenantStore } from '../services/tenant-store.js';

export interface ITenantRepository {
  getOrganization(id: string): Promise<Organization | null>;
  listOrganizations(): Promise<Organization[]>;
  listStudents(context: SessionContext): Promise<Student[]>;
  getStudent(context: SessionContext, studentId: string): Promise<Student | null>;
}

export class InMemoryTenantRepository implements ITenantRepository {
  constructor(private store: TenantStore = new TenantStore()) {}

  public async getOrganization(id: string): Promise<Organization | null> {
    return this.store.getOrganization(id) ?? null;
  }

  public async listOrganizations(): Promise<Organization[]> {
    return this.store.listOrganizations();
  }

  public async listStudents(context: SessionContext): Promise<Student[]> {
    return this.store.listStudents(context);
  }

  public async getStudent(context: SessionContext, studentId: string): Promise<Student | null> {
    return this.store.getStudent(context, studentId);
  }
}

export class PgTenantRepository implements ITenantRepository {
  constructor(private pool: pg.Pool = getDbPool()) {}

  public async getOrganization(id: string): Promise<Organization | null> {
    const query = `
      SELECT id, parent_id, kind, name, config, key_ref, rate_limit_config, created_at, updated_at
      FROM organizations
      WHERE id = $1;
    `;
    const res = await this.pool.query(query, [id]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      parentId: row.parent_id,
      kind: row.kind,
      name: row.name,
      config: row.config,
      keyRef: row.key_ref,
      rateLimitConfig: row.rate_limit_config,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  public async listOrganizations(): Promise<Organization[]> {
    const query = `
      SELECT id, parent_id, kind, name, config, key_ref, rate_limit_config, created_at, updated_at
      FROM organizations
      ORDER BY name;
    `;
    const res = await this.pool.query(query);
    return res.rows.map(row => ({
      id: row.id,
      parentId: row.parent_id,
      kind: row.kind,
      name: row.name,
      config: row.config,
      keyRef: row.key_ref,
      rateLimitConfig: row.rate_limit_config,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    }));
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

      // If student role, restrict strictly to their own user_id
      if (context.role === 'student') {
        query += ` WHERE user_id = $1`;
        params.push(context.userId);
      }

      query += ` ORDER BY enrollment_no;`;

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
}
