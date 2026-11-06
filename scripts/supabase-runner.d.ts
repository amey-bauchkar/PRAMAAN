export declare const INSTITUTIONAL_ORG_IDS: readonly string[];
export declare const APPROVED_LOCAL_HOSTS: readonly string[];
export declare const DEFAULT_APPROVED_SUPABASE_PROJECT_REFS: readonly string[];
export declare const DEFAULT_APPROVED_DB_NAMES: readonly string[];
export declare const DEFAULT_APPROVED_TEST_PATTERNS: readonly string[];

export declare function isApprovedSupabaseProjectRef(projectRef?: string): boolean;
export declare function isProductionDatabaseTarget(dbUrl?: string): boolean;
export declare function isApprovedTestDatabase(dbUrl?: string): boolean;
export declare function assertApprovedDatabaseTarget(targetUrl?: string, operation?: string): void;
export declare function assertSafeTestEnvironment(operation?: string, targetUrl?: string): void;
export declare function assertNotInstitutionalTenant(orgId: string, operation?: string): void;
export declare function cleanSqlForInspection(sql: string): string;
export declare function hasSideEffectingFunction(sql: string): boolean;
export declare function hasTransactionControl(sql: string): boolean;
export declare function isMutationQuery(sql: string): boolean;
export declare function isDestructiveQuery(sql: string): boolean;
export declare function isSafeReadOnlyQuery(sql: string): boolean;

export interface SafeCleanupTestAuditParams {
  orgId: string;
  seq: number;
  action: string;
  objectType: string;
  id: string;
}

export declare function safeCleanupTestAuditEvents(params: SafeCleanupTestAuditParams): Promise<number>;
export declare function runQuery<T = any>(sql: string): Promise<T>;
export declare function runTestTransaction<T = any>(sql: string): Promise<T>;
