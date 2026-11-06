export declare function runQuery<T = any>(sql: string): Promise<T>;
export declare function assertSafeTestEnvironment(operation?: string): void;
export declare const INSTITUTIONAL_ORG_IDS: readonly string[];
export declare function assertNotInstitutionalTenant(orgId: string, operation?: string): void;
