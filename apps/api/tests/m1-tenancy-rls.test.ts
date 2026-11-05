import { describe, it, expect, beforeEach } from 'vitest';
import { TenantStore } from '../src/services/tenant-store.js';
import { SessionContext, Student } from '@pramaan/contracts';

describe('M1: Tenancy and RLS Foundation (P0-01)', () => {
  let store: TenantStore;

  const tenantA: SessionContext = {
    orgId: '00000000-0000-0000-0000-000000000001', // Apex Institute
    userId: '20000000-0000-0000-0000-000000000001',
    role: 'officer'
  };

  const tenantB: SessionContext = {
    orgId: '00000000-0000-0000-0000-000000000002', // Zenith College
    userId: '20000000-0000-0000-0000-000000000099',
    role: 'officer'
  };

  const studentA: Student = {
    id: '40000000-0000-0000-0000-000000000001',
    orgId: tenantA.orgId,
    userId: '20000000-0000-0000-0000-000000000003',
    departmentId: '10000000-0000-0000-0000-000000000001',
    enrollment_no: 'APEX-2023-CS-001',
    graduating_year: 2027,
    program_level: 'undergraduate',
    is_minor: false,
    createdAt: new Date().toISOString()
  };

  const studentB: Student = {
    id: '40000000-0000-0000-0000-000000000002',
    orgId: tenantB.orgId,
    userId: '20000000-0000-0000-0000-000000000004',
    departmentId: '10000000-0000-0000-0000-000000000003',
    enrollment_no: 'ZENITH-2023-CE-001',
    graduating_year: 2027,
    program_level: 'undergraduate',
    is_minor: false,
    createdAt: new Date().toISOString()
  };

  beforeEach(() => {
    store = new TenantStore();
    store.addStudent(tenantA, studentA);
    store.addStudent(tenantB, studentB);
  });

  it('RLS-01: Verifies two synthetic college tenants are seeded', () => {
    const orgs = store.listOrganizations();
    expect(orgs).toHaveLength(2);
    expect(orgs.map(o => o.name)).toContain('Apex Institute of Technology');
    expect(orgs.map(o => o.name)).toContain('Zenith Engineering College');
  });

  it('RLS-02: Tenant A officer cannot read student record from Tenant B (returns 0 rows)', () => {
    const fetched = store.getStudent(tenantA, studentB.id);
    expect(fetched).toBeNull();
  });

  it('RLS-02: Tenant B officer cannot read student record from Tenant A (returns 0 rows)', () => {
    const fetched = store.getStudent(tenantB, studentA.id);
    expect(fetched).toBeNull();
  });

  it('RLS-03: Rejects insertion when student orgId conflicts with active session orgId', () => {
    const rogueStudent: Student = {
      id: '40000000-0000-0000-0000-000000000099',
      orgId: tenantB.orgId, // College B
      userId: 'user-rogue',
      departmentId: 'dept-1',
      enrollment_no: 'ROGUE-01',
      graduating_year: 2027,
      program_level: 'undergraduate',
      is_minor: false,
      createdAt: new Date().toISOString()
    };

    // Attempt to insert into tenant A session context
    expect(() => store.addStudent(tenantA, rogueStudent)).toThrow(/RLS Violation/);
  });

  it('RLS-06: University Admin querying student-level tables receives 0 rows', () => {
    const univAdminContext: SessionContext = {
      orgId: tenantA.orgId,
      userId: 'univ-admin-1',
      role: 'university_admin'
    };

    const students = store.listStudents(univAdminContext);
    expect(students).toEqual([]);
    const single = store.getStudent(univAdminContext, studentA.id);
    expect(single).toBeNull();
  });
});

