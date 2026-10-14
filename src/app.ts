import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createClerkClient } from '@clerk/express';
import { fetchClerkAuthorizationServerMetadata, generateClerkProtectedResourceMetadata } from '@clerk/mcp-tools/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createClerkVerifier, requiredScopes, type TokenVerifier } from './auth.js';

export interface Config {
  publicUrl: string;
  publishableKey: string;
  secretKey: string;
  accountPortalUrl: string;
}
export interface Profile { id: string; name: string | null; email: string | null }
interface Dependencies {
  verifyToken?: TokenVerifier;
  getProfile?: (userId: string) => Promise<Profile>;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function createApp(config: Config, dependencies: Dependencies = {}) {
  const app = express();
  const origin = new URL(config.publicUrl).origin;
  const resource = `${origin}/mcp`;
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;
  const clerk = createClerkClient({ secretKey: config.secretKey, publishableKey: config.publishableKey });
  const verifyToken = dependencies.verifyToken ?? createClerkVerifier(config.secretKey, config.publishableKey, resource);
  const getProfile = dependencies.getProfile ?? (async (userId: string) => {
    const user = await clerk.users.getUser(userId);
    return { id: user.id, name: user.fullName, email: user.primaryEmailAddress?.emailAddress ?? null };
  });

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ exposedHeaders: ['WWW-Authenticate', 'MCP-Protocol-Version'] }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'shared-memory-mcp', version: '0.1.0' }));
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shared Memory MCP</title>
<style>body{margin:0;background:#f6f5f1;color:#1a2425;font:17px/1.6 system-ui,sans-serif}main{max-width:700px;margin:10vh auto;padding:28px}small{color:#547267;letter-spacing:.13em}h1{font-size:clamp(38px,7vw,64px);line-height:1.08;letter-spacing:-.05em;margin:24px 0}p{color:#52615e}section{margin-top:36px;padding:26px;background:white;border:1px solid #dddfd8;border-radius:16px}h2{font-size:21px;margin-top:0}code{display:block;background:#f2f4f0;padding:14px;border-radius:8px;overflow-wrap:anywhere;font-size:14px}a{color:#1e624d}li{margin:10px 0}.links{display:flex;gap:24px;margin-top:28px}footer{font-size:14px;margin-top:32px;color:#6a7771}</style></head>
<body><main><small>SHARED MEMORY · CONNECTION SETUP</small><h1>One identity for your assistants.</h1><p>Connect your account securely with Clerk. This first release verifies your signed-in identity; memory storage comes next.</p>
<section><h2>Connect in ChatGPT</h2><ol><li>Open ChatGPT settings and enable developer mode if needed.</li><li>Create a custom app using this MCP server URL:</li></ol><code>${escapeHtml(resource)}</code><ol start="3"><li>Choose OAuth. Leave the client ID and client secret blank when using automatic registration.</li><li>Sign in through Clerk, review the consent screen, then approve the connection.</li><li>Ask ChatGPT to run <strong>get_connection_status</strong> to confirm your account.</li></ol></section>
<div class="links"><a href="${escapeHtml(config.accountPortalUrl)}/sign-in">Sign in</a><a href="${escapeHtml(config.accountPortalUrl)}/sign-up">Create an account</a><a href="${escapeHtml(config.accountPortalUrl)}/user">Manage account</a></div>
<footer>Clerk manages sign-in, users, and OAuth consent. This service returns your profile only to an authorized client. It does not store chats or memories in this release. <a href="/privacy">Privacy</a></footer></main></body></html>`));
  app.get('/privacy', (_req, res) => res.type('text').send('Shared Memory MCP connection preview. Clerk stores and manages account details and OAuth authorizations. This service verifies Clerk tokens and returns the authorized user ID, name, and primary email to the connected client. It does not store chat content or memories. Hosting providers may retain operational request metadata. Manage your account and connected applications through the Clerk account portal linked from the home page.'));

  const metadata = generateClerkProtectedResourceMetadata({
    publishableKey: config.publishableKey,
    resourceUrl: resource,
    properties: { scopes_supported: ['openid', ...requiredScopes, 'offline_access'], resource_name: 'Shared Memory MCP', bearer_methods_supported: ['header'] },
  });
  // Publish only the discovery fields used by this resource (no guessed endpoints).
  for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
    app.get(path, (_req, res) => res.json({
      resource, authorization_servers: metadata.authorization_servers,
      scopes_supported: metadata.scopes_supported, resource_name: 'Shared Memory MCP', bearer_methods_supported: ['header'],
    }));
  }
  app.get('/.well-known/oauth-authorization-server', async (_req, res, next) => {
    try { res.json(await fetchClerkAuthorizationServerMetadata({ publishableKey: config.publishableKey })); }
    catch (error) { next(error); }
  });

  app.use('/mcp', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/mcp', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') ?? '');
    const unauthorized = (error?: string) => res.status(401).set('WWW-Authenticate',
      `Bearer resource_metadata="${metadataUrl}", scope="${requiredScopes.join(' ')}"${error ? `, error="${error}"` : ''}`
    ).json({ error: 'unauthorized', message: 'Connect your account using OAuth.' });
    if (!match) { unauthorized(); return; }
    try {
      const auth = await verifyToken(match[1]);
      if (!auth || !auth.extra?.userId || !requiredScopes.every(scope => auth.scopes.includes(scope)) ||
          auth.resource?.href !== resource || !auth.expiresAt || auth.expiresAt <= Date.now() / 1000) {
        unauthorized('invalid_token'); return;
      }
      res.locals.authInfo = auth;
      next();
    } catch { unauthorized('invalid_token'); }
  });
  app.post('/mcp', express.json({ limit: '64kb' }), async (req, res, next) => {
    const auth = res.locals.authInfo as AuthInfo;
    // Each HTTP request gets its own server and transport, with no shared user state.
    const server = new McpServer({ name: 'shared-memory-mcp', version: '0.1.0' });
    server.registerTool('get_connection_status', {
      title: 'Check Shared Memory connection',
      description: 'Verify the Shared Memory MCP connection and return the profile of the user who authorized it. Memory storage is not available yet.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: requiredScopes }] },
    }, async () => {
      const user = await getProfile(auth.extra!.userId as string);
      const result = { connected: true, user, capabilities: { authentication: true, memory: false } };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) { next(error); }
  });
  app.all('/mcp', (_req, res) => res.status(405).set('Allow', 'POST, OPTIONS').json({ error: 'method_not_allowed' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    const status = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number' ? error.status : 500;
    res.status(status).json({ error: status === 500 ? 'internal_error' : 'invalid_request' });
  });
  return app;
}
