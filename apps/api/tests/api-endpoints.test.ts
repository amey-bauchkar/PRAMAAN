import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

describe('PRAMAAN Fastify HTTP Endpoints', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp();
  });

  it('GET /health returns healthy status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.status).toBe('healthy');
    expect(json.service).toBe('pramaan-api');
  });

  it('GET /api/tenants lists seeded college organizations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tenants'
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /api/consent/grant and revoke via HTTP', async () => {
    // 1. Grant consent
    const grantRes = await app.inject({
      method: 'POST',
      url: '/api/consent/grant',
      headers: {
        'x-org-id': '00000000-0000-0000-0000-000000000001',
        'x-user-id': '20000000-0000-0000-0000-000000000003',
        'x-user-role': 'student'
      },
      payload: {
        studentId: '40000000-0000-0000-0000-000000000001',
        purpose: 'repo_verification',
        noticeVersion: 1
      }
    });

    expect(grantRes.statusCode).toBe(201);
    const grant = JSON.parse(grantRes.payload);
    expect(grant.id).toBeDefined();
    expect(grant.purpose).toBe('repo_verification');

    // 2. Query audit ledger
    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: {
        'x-org-id': '00000000-0000-0000-0000-000000000001',
        'x-user-id': '20000000-0000-0000-0000-000000000001',
        'x-user-role': 'officer'
      }
    });
    expect(auditRes.statusCode).toBe(200);
    const auditEvents = JSON.parse(auditRes.payload);
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    expect(auditEvents[0].action).toBe('CONSENT_GRANTED');

    // 3. Verify cryptographic integrity
    const verifyRes = await app.inject({
      method: 'GET',
      url: '/api/audit/verify'
    });
    expect(verifyRes.statusCode).toBe(200);
    const verifyJson = JSON.parse(verifyRes.payload);
    expect(verifyJson.valid).toBe(true);

    // 4. Revoke consent
    const revokeRes = await app.inject({
      method: 'POST',
      url: '/api/consent/revoke',
      headers: {
        'x-org-id': '00000000-0000-0000-0000-000000000001',
        'x-user-id': '20000000-0000-0000-0000-000000000003',
        'x-user-role': 'student'
      },
      payload: {
        grantId: grant.id,
        reason: 'Revoking GitHub access from web portal'
      }
    });

    expect(revokeRes.statusCode).toBe(200);
    const revokeJson = JSON.parse(revokeRes.payload);
    expect(revokeJson.success).toBe(true);
  });
});

