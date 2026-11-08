import {
  Organization,
  User,
  Membership,
  Student,
  SessionContext
} from '@pramaan/contracts';

/**
 * Tenant-Isolated In-Memory Store for unit/integration tests and fast local runtime.
 * Implements strict PostgreSQL Row-Level Security (RLS) invariants:
 * - Queries executed within a session context can NEVER observe rows from other organizations (RLS-01, RLS-02, RLS-03).
 * - University admins cannot read individual student-level PII (RLS-06).
 */
export class TenantStore {
  private organizations: Map<string, Organization> = new Map();
  private users: Map<string, User> = new Map();
  private memberships: Map<string, Membership> = new Map();
  private students: Map<string, Student> = new Map();

  constructor() {
    this.seedDefaultTenants();
  }

  private seedDefaultTenants() {
    // Apex Institute of Technology
    const apexOrg: Organization = {
      id: '00000000-0000-0000-0000-000000000001',
      kind: 'college',
      name: 'Apex Institute of Technology',
      config: { tier: 1 },
      rateLimitConfig: { maxRequestsPerMin: 100 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Zenith Engineering College
    const zenithOrg: Organization = {
      id: '00000000-0000-0000-0000-000000000002',
      kind: 'college',
      name: 'Zenith Engineering College',
      config: { tier: 2 },
      rateLimitConfig: { maxRequestsPerMin: 60 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.organizations.set(apexOrg.id, apexOrg);
    this.organizations.set(zenithOrg.id, zenithOrg);
  }

  public getOrganization(id: string): Organization | undefined {
    return this.organizations.get(id);
  }

  public listOrganizations(): Organization[] {
    return Array.from(this.organizations.values());
  }

  public registerUser(user: User): User {
    this.users.set(user.id, user);
    return user;
  }

  public addMembership(membership: Membership): Membership {
    this.memberships.set(membership.id, membership);
    return membership;
  }

  public addStudent(context: SessionContext, student: Student): Student {
    // RLS Enforcement: Student orgId MUST match current tenant
    if (student.orgId !== context.orgId) {
      throw new Error(`RLS Violation: Cannot insert student with orgId '${student.orgId}' into tenant context '${context.orgId}'.`);
    }
    this.students.set(student.id, student);
    return student;
  }

  public getStudent(context: SessionContext, studentId: string): Student | null {
    const student = this.students.get(studentId);
    if (!student) return null;

    // RLS-02: Tenant A cannot query Tenant B
    if (student.orgId !== context.orgId) {
      return null; // Equivalent to PostgreSQL RLS 0 rows
    }

    // RLS-06: University Admin cannot read student-level rows
    if (context.role === 'university_admin') {
      return null;
    }

    // Student can only read own record
    if (context.role === 'student' && student.userId !== context.userId) {
      return null;
    }

    return student;
  }

  public getStudentByUserId(context: SessionContext, userId: string): Student | null {
    // RLS-06: University Admin cannot read student-level rows
    if (context.role === 'university_admin') {
      return null;
    }

    // Student can only read own record
    if (context.role === 'student' && userId !== context.userId) {
      return null;
    }

    return (
      Array.from(this.students.values()).find(
        (student) => student.orgId === context.orgId && student.userId === userId
      ) ?? null
    );
  }

  public listStudents(context: SessionContext): Student[] {
    // RLS-06: University admin gets 0 student-level rows
    if (context.role === 'university_admin') {
      return [];
    }

    return Array.from(this.students.values()).filter(student => {
      // Must match tenant org_id
      if (student.orgId !== context.orgId) return false;

      // If student role, can only see self
      if (context.role === 'student') {
        return student.userId === context.userId;
      }

      // Officer and mentor can view cohort
      return true;
    });
  }
}

