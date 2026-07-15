// Dev-only helper: mint a valid session cookie for smoke-testing the gated app.
import './_env';
import { SignJWT } from 'jose';

(async () => {
  const sec = process.env.SESSION_SECRET ?? '';
  const token = await new SignJWT({ email: process.env.APP_EMAIL ?? 'demo@local' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(sec));
  process.stdout.write(token);
})();
