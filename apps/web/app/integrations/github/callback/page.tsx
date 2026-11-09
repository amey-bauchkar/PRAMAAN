'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface CallbackState {
  status: 'idle' | 'processing' | 'success' | 'error';
  githubUsername?: string;
  githubUserId?: string;
  error?: string;
}

function GitHubCallbackContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const errorParam = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  const [callbackState, setCallbackState] = useState<CallbackState>({
    status: 'idle',
  });

  const hasTriggered = useRef(false);

  useEffect(() => {
    // 1. Explicitly handle GitHub authorization denial
    if (errorParam) {
      setCallbackState({
        status: 'error',
        error: `GitHub authorization was denied: ${errorDescription || errorParam}`,
      });
      return;
    }

    if (!code || !state) {
      setCallbackState({
        status: 'error',
        error: 'Missing required OAuth parameters: code and state must be present in the callback URL.',
      });
      return;
    }

    // 2. StrictMode Guard: prevent double-invocation under React development mode
    if (hasTriggered.current) {
      return;
    }
    hasTriggered.current = true;

    // Read active session token and tenant header from client storage if available
    const win = typeof globalThis !== 'undefined' ? (globalThis as any) : null;
    const sessionToken: string | null =
      win?.sessionStorage?.getItem('pramaan_session_token') ||
      win?.localStorage?.getItem('pramaan_session_token') ||
      null;

    const orgId: string | null =
      win?.sessionStorage?.getItem('pramaan_org_id') ||
      win?.localStorage?.getItem('pramaan_org_id') ||
      null;

    if (!sessionToken) {
      setCallbackState({
        status: 'error',
        error:
          'No authenticated session found. Please sign in to PRAMAAN before completing GitHub connection.',
      });
      return;
    }

    setCallbackState({ status: 'processing' });

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';

    fetch(`${apiUrl}/api/integrations/github/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        ...(orgId ? { 'x-org-id': orgId } : {}),
      },
      body: JSON.stringify({ code, state }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as any;
        if (!res.ok) {
          throw new Error(data.error || `Server responded with HTTP ${res.status}`);
        }

        // 3. Clear sensitive temporary code and state query parameters from browser URL
        if (win?.history?.replaceState) {
          const cleanUrl = win?.location?.pathname || '/integrations/github/callback';
          win.history.replaceState({}, win?.document?.title || '', cleanUrl);
        }

        setCallbackState({
          status: 'success',
          githubUsername: data.githubUsername,
          githubUserId: data.githubUserId,
        });
      })
      .catch((err: Error) => {
        setCallbackState({
          status: 'error',
          error: err.message,
        });
      });
  }, [code, state, errorParam, errorDescription]);

  return (
    <div style={{ maxWidth: '600px', margin: '4rem auto', padding: '2rem', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
      <h2 style={{ marginBottom: '1rem' }}>GitHub Integration Callback</h2>
      {callbackState.status === 'processing' && (
        <p>Verifying GitHub authorization and completing secure connection...</p>
      )}
      {callbackState.status === 'success' && (
        <div>
          <p style={{ color: '#16a34a', fontWeight: 'bold' }}>
            GitHub account connected successfully!
          </p>
          <p>
            Connected as: <strong>{callbackState.githubUsername}</strong> (ID: {callbackState.githubUserId})
          </p>
        </div>
      )}
      {callbackState.status === 'error' && (
        <div>
          <p style={{ color: '#dc2626', fontWeight: 'bold' }}>Connection Failed</p>
          <p>{callbackState.error}</p>
        </div>
      )}
    </div>
  );
}

export default function GitHubCallbackPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem' }}>Loading callback handler...</div>}>
      <GitHubCallbackContent />
    </Suspense>
  );
}

