import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import {
  DEFAULT_APPROVED_SUPABASE_PROJECT_REFS,
  isApprovedTestDatabase,
  assertSafeTestEnvironment,
  assertApprovedDatabaseTarget,
  isProductionDatabaseTarget,
} from '../../scripts/supabase-runner.mjs';

describe('CI Live Supabase Workflow Safety-Gate & Configuration Invariants', () => {
  const workflowPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
  const workflowContent = fs.readFileSync(workflowPath, 'utf8');
  const workflowDoc = YAML.parse(workflowContent);

  it('1. Workflow YAML is valid and contains expected jobs', () => {
    expect(workflowDoc).toBeDefined();
    expect(workflowDoc.jobs).toBeDefined();
    expect(workflowDoc.jobs['live-supabase-verification']).toBeDefined();
    expect(workflowDoc.jobs['isolated-postgres-integration']).toBeDefined();
    expect(workflowDoc.jobs['build-and-unit-tests']).toBeDefined();
  });

  it('2. ALLOW_DESTRUCTIVE_DB_TESTS is NEVER defined at the global workflow level', () => {
    // Setting ALLOW_DESTRUCTIVE_DB_TESTS globally would defeat defensive safety guards
    expect(workflowDoc.env?.ALLOW_DESTRUCTIVE_DB_TESTS).toBeUndefined();
  });

  it('3. ALLOW_DESTRUCTIVE_DB_TESTS is configured specifically at live-supabase-verification job level', () => {
    const liveJob = workflowDoc.jobs['live-supabase-verification'];
    expect(liveJob).toBeDefined();
    expect(liveJob.env).toBeDefined();
    expect(String(liveJob.env.ALLOW_DESTRUCTIVE_DB_TESTS)).toBe('true');
  });

  it('4. Credential-presence gate (check-secrets) is strictly preserved', () => {
    const liveJob = workflowDoc.jobs['live-supabase-verification'];
    const checkSecretsStep = liveJob.steps.find((s: any) => s.id === 'check-secrets');

    expect(checkSecretsStep).toBeDefined();
    expect(checkSecretsStep.run).toContain('has_secrets=true');
    expect(checkSecretsStep.run).toContain('has_secrets=false');

    // Verify all 5 credentials are evaluated
    expect(checkSecretsStep.env.SUPABASE_URL).toBeDefined();
    expect(checkSecretsStep.env.SUPABASE_ANON_KEY).toBeDefined();
    expect(checkSecretsStep.env.SUPABASE_SERVICE_ROLE_KEY).toBeDefined();
    expect(checkSecretsStep.env.DATABASE_URL).toBeDefined();
    expect(checkSecretsStep.env.DATABASE_URL_ADMIN).toBeDefined();
  });

  it('5. Live test execution step is gated behind steps.check-secrets.outputs.has_secrets == true', () => {
    const liveJob = workflowDoc.jobs['live-supabase-verification'];
    const testStep = liveJob.steps.find(
      (s: any) => s.name === 'Run Genuine Supabase JWT, ES256 & Auth Membership Tests'
    );

    expect(testStep).toBeDefined();
    expect(testStep.if).toBe("steps.check-secrets.outputs.has_secrets == 'true'");
    expect(String(testStep.env.ALLOW_DESTRUCTIVE_DB_TESTS)).toBe('true');
    expect(testStep.run).toContain('real-supabase-jwt.test.ts');
    expect(testStep.run).toContain('pg-auth-integration.test.ts');
  });

  it('6. Approved Supabase project allowlist contains designated non-production project', () => {
    expect(DEFAULT_APPROVED_SUPABASE_PROJECT_REFS).toContain('qshujrddrzoemlzmleru');
    expect(DEFAULT_APPROVED_SUPABASE_PROJECT_REFS).not.toContain('production');
    expect(DEFAULT_APPROVED_SUPABASE_PROJECT_REFS).not.toContain('prod');
  });

  it('7. Safety guard rejects recognized production targets regardless of ALLOW_DESTRUCTIVE_DB_TESTS', () => {
    const prodUrl = 'postgresql://postgres:secret@db.prod.pramaan.internal:5432/pramaan_production';
    expect(isProductionDatabaseTarget(prodUrl)).toBe(true);
    expect(isApprovedTestDatabase(prodUrl)).toBe(false);

    // assertApprovedDatabaseTarget directly validates target without needing opt-in flag
    expect(() => {
      assertApprovedDatabaseTarget(prodUrl, 'Destructive test execution');
    }).toThrow(/production/i);

    // When opt-in is enabled, assertSafeTestEnvironment must STILL reject production target
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    try {
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
      expect(() => {
        assertSafeTestEnvironment('Destructive test execution', prodUrl);
      }).toThrow(/production/i);
    } finally {
      if (prev !== undefined) {
        process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
      } else {
        delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
      }
    }
  });

  it('8. Safety guard strictly throws when ALLOW_DESTRUCTIVE_DB_TESTS is absent or false', () => {
    const originalDbTests = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    const originalTests = process.env.ALLOW_DESTRUCTIVE_TESTS;
    try {
      // 1. Both variables absent -> assertSafeTestEnvironment() rejects
      delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
      delete process.env.ALLOW_DESTRUCTIVE_TESTS;
      expect(() => {
        assertSafeTestEnvironment('Destructive query execution');
      }).toThrow(/requires explicit opt-in via ALLOW_DESTRUCTIVE_DB_TESTS=true/);

      // 2. ALLOW_DESTRUCTIVE_DB_TESTS=false with legacy variable absent -> rejects
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'false';
      delete process.env.ALLOW_DESTRUCTIVE_TESTS;
      expect(() => {
        assertSafeTestEnvironment('Destructive query execution');
      }).toThrow(/requires explicit opt-in via ALLOW_DESTRUCTIVE_DB_TESTS=true/);

      // 3. No alternate legacy opt-in can bypass the requirement
      // 3a. Explicit false on ALLOW_DESTRUCTIVE_DB_TESTS cannot be overridden by legacy ALLOW_DESTRUCTIVE_TESTS=true
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'false';
      process.env.ALLOW_DESTRUCTIVE_TESTS = 'true';
      expect(() => {
        assertSafeTestEnvironment('Destructive query execution');
      }).toThrow(/requires explicit opt-in via ALLOW_DESTRUCTIVE_DB_TESTS=true/);

      // 3b. Arbitrary or non-boolean legacy opt-in values cannot bypass the requirement
      delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
      for (const invalidOptIn of ['yes', '1', 'trueish', 'force', 'bypass', '0']) {
        process.env.ALLOW_DESTRUCTIVE_TESTS = invalidOptIn;
        expect(() => {
          assertSafeTestEnvironment('Destructive query execution');
        }).toThrow(/requires explicit opt-in via ALLOW_DESTRUCTIVE_DB_TESTS=true/);
      }
    } finally {
      if (originalDbTests !== undefined) {
        process.env.ALLOW_DESTRUCTIVE_DB_TESTS = originalDbTests;
      } else {
        delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
      }
      if (originalTests !== undefined) {
        process.env.ALLOW_DESTRUCTIVE_TESTS = originalTests;
      } else {
        delete process.env.ALLOW_DESTRUCTIVE_TESTS;
      }
    }
  });
});
