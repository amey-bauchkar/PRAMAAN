import { z } from 'zod';

export const UserRoleSchema = z.enum([
  'student',
  'mentor',
  'officer',
  'university_admin',
  'recruiter',
  'platform_admin'
]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const OrgKindSchema = z.enum(['university', 'college']);
export type OrgKind = z.infer<typeof OrgKindSchema>;

export const MembershipStatusSchema = z.enum(['active', 'suspended', 'revoked']);
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  kind: OrgKindSchema,
  name: z.string().min(2).max(255),
  config: z.record(z.unknown()).default({}),
  keyRef: z.string().nullable().optional(),
  rateLimitConfig: z.object({
    maxRequestsPerMin: z.number().int().positive().default(60),
  }).default({ maxRequestsPerMin: 60 }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  authSubject: z.string().min(1),
  email: z.string().email(),
  fullName: z.string().min(1).max(255),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const MembershipSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  departmentId: z.string().uuid().nullable().optional(),
  role: UserRoleSchema,
  status: MembershipStatusSchema.default('active'),
  createdAt: z.string().datetime(),
});
export type Membership = z.infer<typeof MembershipSchema>;

export const StudentSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  departmentId: z.string().uuid(),
  enrollment_no: z.string(),
  graduating_year: z.number().int(),
  program_level: z.string().default('undergraduate'),
  is_minor: z.boolean().default(false),
  age_verified_at: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type Student = z.infer<typeof StudentSchema>;

export const SessionContextSchema = z.object({
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  role: UserRoleSchema,
  departmentId: z.string().uuid().nullable().optional(),
});
export type SessionContext = z.infer<typeof SessionContextSchema>;

