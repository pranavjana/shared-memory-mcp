import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

const origin = 'https://memory.example.com';
const config = {
  publicUrl: origin,
  publishableKey: `pk_test_${Buffer.from('test.clerk.accounts.dev$').toString('base64')}`,
  secretKey: 'sk_test_unit_test_only',
  accountPortalUrl: 'https://test.accounts.dev',
};
const identity = (id: string): AuthInfo => ({
  token: `token-${id}`, clientId: 'chatgpt-test', scopes: ['profile', 'email'],
  expiresAt: Math.floor(Date.now() / 1000) + 300, resource: new URL(`${origin}/mcp`), extra: { userId: id },
});

test('OAuth discovery, access checks, and concurrent users stay isolated', async () => {
  const app = createApp(config, {
    verifyToken: async token => {
      if (token === 'valid-a') return identity('user_a');
      if (token === 'valid-b') return identity('user_b');
      if (token === 'wrong-audience') return { ...identity('user_a'), resource: new URL('https://other.example/mcp') };
      if (token === 'missing-scopes') return { ...identity('user_a'), scopes: [] };
      if (token === 'expired') return { ...identity('user_a'), expiresAt: 1 };
    },
    getProfile: async id => ({ id, name: `Name ${id}`, email: `${id}@example.com` }),
  });
  const http = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => http.once('listening', resolve));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  try {
    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`, { headers: { Host: 'attacker.example' } });
    const body = await metadata.json();
    assert.equal(body.resource, `${origin}/mcp`);
    assert.deepEqual(body.authorization_servers, ['https://test.clerk.accounts.dev']);
    assert.equal(metadata.headers.get('access-control-allow-origin'), '*');

    for (const auth of [undefined, 'Basic valid-a', 'Bearer invalid', 'Bearer wrong-audience', 'Bearer missing-scopes', 'Bearer expired']) {
      const response = await fetch(`${base}/mcp`, {
        method: 'POST', headers: auth ? { Authorization: auth } : {},
      });
      assert.equal(response.status, 401, `expected rejection for ${auth}`);
      assert.match(response.headers.get('www-authenticate')!, /https:\/\/memory.example.com\/\.well-known\/oauth-protected-resource\/mcp/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }

    async function rpc(token: string, method: string, params: unknown, id: number) {
      const response = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      assert.equal(response.status, 200);
      return response.json();
    }
    const initialized = await rpc('valid-a', 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }, 1);
    assert.equal(initialized.result.serverInfo.name, 'shared-memory-mcp');
    const listed = await rpc('valid-a', 'tools/list', {}, 2);
    assert.equal(listed.result.tools[0].name, 'get_connection_status');
    assert.equal(listed.result.tools[0].annotations.readOnlyHint, true);
    const results = await Promise.all(Array.from({length: 8}, (_, i) => rpc(i % 2 ? 'valid-a' : 'valid-b', 'tools/call', { name: 'get_connection_status', arguments: {} }, i + 3)));
    for (const [i, result] of results.entries()) {
      assert.equal(result.result.structuredContent.user.id, i % 2 ? 'user_a' : 'user_b');
      assert.equal(result.result.structuredContent.capabilities.memory, false);
    }
    const getResponse = await fetch(`${base}/mcp`, { headers: { Authorization: 'Bearer valid-a' } });
    assert.equal(getResponse.status, 405);
  } finally {
    await new Promise<void>(resolve => http.close(() => resolve()));
  }
});
