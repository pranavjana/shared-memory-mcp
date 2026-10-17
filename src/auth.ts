import { createClerkClient } from '@clerk/express';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

export const requiredScopes = ['profile', 'email'];
export type TokenVerifier = (token: string) => Promise<AuthInfo | undefined>;

export function createClerkVerifier(secretKey: string, publishableKey: string, resource: string): TokenVerifier {
  const clerk = createClerkClient({ secretKey, publishableKey });
  return async (token) => {
    // Clerk's instance-scoped introspection checks validity and revocation.
    // Passing an audience also rejects tokens issued for another resource.
    try {
      const verified = await clerk.idPOAuthAccessToken.verify(token, { audience: resource });
      if (verified.revoked || verified.expired || !verified.subject.startsWith('user_') ||
          !verified.expiration || verified.expiration <= Date.now() / 1000 ||
          !requiredScopes.every(scope => verified.scopes.includes(scope))) return;
      return {
        token,
        clientId: verified.clientId,
        scopes: verified.scopes,
        expiresAt: verified.expiration,
        resource: new URL(resource),
        extra: { userId: verified.subject },
      };
    } catch {
      // Never include a token or provider response in an error or log.
      return;
    }
  };
}
