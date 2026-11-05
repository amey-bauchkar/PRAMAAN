import { User, Membership } from '@pramaan/contracts';
import pg from 'pg';

export interface UserWithMemberships {
  user: User;
  memberships: Membership[];
}

export interface IUserRepository {
  findByAuthSubjectOrEmail(authSubject: string, email?: string): Promise<UserWithMemberships | null>;
  registerUser(user: User): Promise<User>;
  addMembership(membership: Membership): Promise<Membership>;
}

export class InMemoryUserRepository implements IUserRepository {
  private users: Map<string, User> = new Map();
  private memberships: Map<string, Membership[]> = new Map(); // userId -> Membership[]

  constructor() {
    this.seedDefaults();
  }

  private seedDefaults() {
    const tpoUser: User = {
      id: '20000000-0000-0000-0000-000000000001',
      authSubject: 'auth0|tpo_priya',
      email: 'priya.sharma@apex.edu',
      fullName: 'Priya Sharma',
      createdAt: new Date().toISOString()
    };
    this.registerUserSync(tpoUser);
    this.addMembershipSync({
      id: '30000000-0000-0000-0000-000000000001',
      userId: tpoUser.id,
      orgId: '00000000-0000-0000-0000-000000000001', // Apex
      role: 'officer',
      status: 'active',
      createdAt: new Date().toISOString()
    });

    const studentUser: User = {
      id: '20000000-0000-0000-0000-000000000003',
      authSubject: 'auth0|student_aarav',
      email: 'aarav.patel@apex.edu',
      fullName: 'Aarav Patel',
      createdAt: new Date().toISOString()
    };
    this.registerUserSync(studentUser);
    this.addMembershipSync({
      id: '30000000-0000-0000-0000-000000000003',
      userId: studentUser.id,
      orgId: '00000000-0000-0000-0000-000000000001', // Apex
      departmentId: '10000000-0000-0000-0000-000000000001',
      role: 'student',
      status: 'active',
      createdAt: new Date().toISOString()
    });
  }

  private registerUserSync(user: User): User {
    this.users.set(user.id, user);
    return user;
  }

  private addMembershipSync(membership: Membership): Membership {
    const list = this.memberships.get(membership.userId) || [];
    list.push(membership);
    this.memberships.set(membership.userId, list);
    return membership;
  }

  public async registerUser(user: User): Promise<User> {
    return this.registerUserSync(user);
  }

  public async addMembership(membership: Membership): Promise<Membership> {
    return this.addMembershipSync(membership);
  }

  public async findByAuthSubjectOrEmail(authSubject: string, email?: string): Promise<UserWithMemberships | null> {
    let matchedUser: User | undefined;
    for (const u of this.users.values()) {
      if (u.authSubject === authSubject || u.id === authSubject || (email && u.email === email)) {
        matchedUser = u;
        break;
      }
    }

    if (!matchedUser) return null;

    const memberships = this.memberships.get(matchedUser.id) || [];
    return {
      user: matchedUser,
      memberships
    };
  }
}

export class PgUserRepository implements IUserRepository {
  constructor(private pool: pg.Pool) {}

  public async findByAuthSubjectOrEmail(authSubject: string, email?: string): Promise<UserWithMemberships | null> {
    const query = `
      SELECT 
        u.id as user_id, 
        u.auth_subject, 
        u.email, 
        u.full_name, 
        u.created_at as user_created_at,
        m.id as membership_id, 
        m.org_id, 
        m.department_id, 
        m.role, 
        m.status, 
        m.created_at as membership_created_at
      FROM users u
      LEFT JOIN memberships m ON m.user_id = u.id
      WHERE u.auth_subject = $1 OR u.id::text = $1 OR (u.email = $2 AND $2 IS NOT NULL);
    `;

    const res = await this.pool.query(query, [authSubject, email || null]);
    if (res.rows.length === 0) {
      return null;
    }

    const firstRow = res.rows[0];
    const user: User = {
      id: firstRow.user_id,
      authSubject: firstRow.auth_subject,
      email: firstRow.email,
      fullName: firstRow.full_name,
      createdAt: new Date(firstRow.user_created_at).toISOString()
    };

    const memberships: Membership[] = [];
    for (const row of res.rows) {
      if (row.membership_id) {
        memberships.push({
          id: row.membership_id,
          userId: user.id,
          orgId: row.org_id,
          departmentId: row.department_id,
          role: row.role,
          status: row.status,
          createdAt: new Date(row.membership_created_at).toISOString()
        });
      }
    }

    return { user, memberships };
  }

  public async registerUser(user: User): Promise<User> {
    const query = `
      INSERT INTO users (id, auth_subject, email, full_name, created_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, auth_subject, email, full_name, created_at;
    `;
    const res = await this.pool.query(query, [
      user.id,
      user.authSubject,
      user.email,
      user.fullName,
      user.createdAt
    ]);
    const row = res.rows[0];
    return {
      id: row.id,
      authSubject: row.auth_subject,
      email: row.email,
      fullName: row.full_name,
      createdAt: new Date(row.created_at).toISOString()
    };
  }

  public async addMembership(membership: Membership): Promise<Membership> {
    const query = `
      INSERT INTO memberships (id, user_id, org_id, department_id, role, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, user_id, org_id, department_id, role, status, created_at;
    `;
    const res = await this.pool.query(query, [
      membership.id,
      membership.userId,
      membership.orgId,
      membership.departmentId || null,
      membership.role,
      membership.status,
      membership.createdAt
    ]);
    const row = res.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      orgId: row.org_id,
      departmentId: row.department_id,
      role: row.role,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString()
    };
  }
}
