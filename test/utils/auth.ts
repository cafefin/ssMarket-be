import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { GoogleIdentity } from '../../src/modules/auth/auth.types.js';

export type TestAgent = ReturnType<typeof request.agent>;

export function identityFor(name: string): GoogleIdentity {
  return {
    googleId: `google-${name}`,
    email: `${name}@example.com`,
    emailVerified: true,
    hostedDomain: 'example.com',
    name,
    avatarUrl: null,
  };
}

/** Signs in as the given person and returns an agent holding their cookies. */
export async function signIn(
  app: NestExpressApplication,
  identityRef: { current: GoogleIdentity | null },
  name: string,
): Promise<TestAgent> {
  identityRef.current = identityFor(name);
  const agent = request.agent(app.getHttpServer());
  await agent.get('/auth/google/callback').expect(302);
  return agent;
}
