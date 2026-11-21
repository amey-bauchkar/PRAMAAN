export function bootstrapCollege(
  q: { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> },
  opts: { collegeName: string; departments: { code: string; name: string }[]; adminName?: string; adminEmail?: string; parentId?: string | null; webUrl?: string; inviteDays?: number }
): Promise<{ orgId: string; reusedCollege: boolean; departmentIds: Record<string, string>; adminInvite: { id: string; email: string; claimUrl: string } | null }>;
