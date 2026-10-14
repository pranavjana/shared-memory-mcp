import { createApp } from './app.js';

for (const key of ['CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'CLERK_ACCOUNT_PORTAL_URL']) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}
const publicUrl = process.env.PUBLIC_URL ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000');
if (process.env.NODE_ENV === 'production' && !publicUrl.startsWith('https://')) throw new Error('PUBLIC_URL must use HTTPS in production');
const port = Number(process.env.PORT ?? 3000);
const server = createApp({
  publicUrl,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY!,
  secretKey: process.env.CLERK_SECRET_KEY!,
  accountPortalUrl: process.env.CLERK_ACCOUNT_PORTAL_URL!,
}).listen(port, '0.0.0.0', () => console.log(`Shared Memory MCP listening on port ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
