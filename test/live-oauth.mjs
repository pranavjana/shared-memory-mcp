// Run manually: node --env-file=.env.local test/live-oauth.mjs
// Uses an isolated, disposable Clerk test user and OAuth client. Never prints tokens.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClerkClient } from '@clerk/express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.CLERK_PUBLISHABLE_KEY });
const resource = `${process.env.PUBLIC_URL}/mcp`;
const metadata = await fetch(`${process.env.PUBLIC_URL}/.well-known/oauth-protected-resource/mcp`).then(r => r.json());
assert.equal(metadata.resource, resource);
const discovery = await fetch(`${metadata.authorization_servers[0]}/.well-known/oauth-authorization-server`).then(r => r.json());
assert(discovery.code_challenge_methods_supported.includes('S256'));
const verifier = randomBytes(32).toString('base64url');
const state = randomBytes(24).toString('base64url');
const clientName = `Shared Memory verification ${Date.now()}`;
let user;
let oauthApp;
let client;
let redirect;
let finish;
const callback = new Promise((resolve, reject) => { finish = {resolve,reject}; });
const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/start') { res.writeHead(302, {Location: redirect}); res.end(); return; }
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
  if (url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid state'); return; }
  if (url.searchParams.get('error')) { finish.reject(new Error('OAuth authorization rejected')); res.writeHead(400).end('Authorization failed'); return; }
  finish.resolve(url.searchParams.get('code'));
  res.end('OAuth callback received. You can close this test tab.');
});
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${http.address().port}`;
const timeout = setTimeout(() => finish.reject(new Error('OAuth browser test timed out')), 10 * 60_000);
try {
  const registrationResponse = await fetch(discovery.registration_endpoint, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({client_name:clientName, redirect_uris:[`${base}/callback`], grant_types:['authorization_code','refresh_token'], response_types:['code'], token_endpoint_auth_method:'none', scope:'openid profile email offline_access'}),
  });
  const registered = await registrationResponse.json();
  if (!registrationResponse.ok) throw new Error(`Dynamic registration rejected: ${registered.error ?? registrationResponse.status}`);
  assert(registered.client_id);
  console.log('PASS: Dynamic client registration');
  const apps = await clerk.oauthApplications.list({nameQuery:clientName});
  oauthApp = apps.data.find(a => a.clientId === registered.client_id);
  user = await clerk.users.createUser({emailAddress:[`connection-${Date.now()}+clerk_test@example.com`], firstName:'Connection', lastName:'Verification', skipPasswordRequirement:true});
  const ticket = await clerk.signInTokens.createSignInToken({userId:user.id,expiresInSeconds:600});
  const auth = new URL(discovery.authorization_endpoint);
  for (const [key,value] of Object.entries({client_id:registered.client_id, redirect_uri:`${base}/callback`, response_type:'code',scope:'openid profile email offline_access', state, code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource})) auth.searchParams.set(key,value);
  const signIn = new URL(`${process.env.CLERK_ACCOUNT_PORTAL_URL}/sign-in`);
  signIn.searchParams.set('__clerk_ticket',ticket.token);
  signIn.searchParams.set('redirect_url',auth.href);
  redirect = signIn.href;
  console.log(`Open test login: ${base}/start`);
  const code = await callback;
  assert(code);
  const tokenResponse = await fetch(discovery.token_endpoint, {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:`${base}/callback`,client_id:registered.client_id,code_verifier:verifier,resource})});
  const tokens = await tokenResponse.json();
  if(!tokenResponse.ok) throw new Error(`Token exchange rejected: ${tokens.error ?? tokenResponse.status}`);
  assert(tokens.access_token);
  assert(tokens.refresh_token);
  const verified = await clerk.idPOAuthAccessToken.verify(tokens.access_token,{audience:resource});
  assert.equal(verified.subject,user.id);
  console.log('PASS: PKCE exchange, refresh token issuance, and audience verification');
  await assert.rejects(clerk.idPOAuthAccessToken.verify(tokens.access_token,{audience:'https://wrong.example/mcp'}));
  console.log('PASS: Wrong audience rejected');
  client = new Client({name:'shared-memory-live-verification',version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:`Bearer ${tokens.access_token}`}}}));
  const result = await client.callTool({name:'get_connection_status',arguments:{}});
  assert.equal(result.structuredContent.user.id,user.id);
  console.log('PASS: Authenticated MCP handshake and user-scoped tool call');
  const refreshed = await fetch(discovery.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:registered.client_id,resource})});
  const fresh = await refreshed.json();
  if (!refreshed.ok) throw new Error(`Refresh rejected: ${fresh.error ?? refreshed.status}`);
  assert(fresh.access_token);
  console.log('PASS: Token refresh');
  await clerk.oauthApplications.revokeToken({oauthApplicationId:oauthApp.id,token:fresh.refresh_token ?? tokens.refresh_token});
  const denied = await fetch(resource,{method:'POST',headers:{Authorization:`Bearer ${fresh.access_token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:99,method:'tools/list'})});
  assert.equal(denied.status,401);
  console.log('PASS: Revoked token rejected by deployed MCP');
} catch(error) {
  console.error(`FAIL: ${error.message || error.errors?.map(e => e.code).join(', ') || error.constructor.name}`);
  process.exitCode=1;
} finally {
  clearTimeout(timeout);
  await client?.close();
  if(user) await clerk.users.deleteUser(user.id);
  if(oauthApp) await clerk.oauthApplications.delete(oauthApp.id);
  http.closeAllConnections();
  await new Promise(resolve => http.close(resolve));
  console.log('Cleaned up isolated verification user and OAuth client.');
}
