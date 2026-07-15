'use server';

import { redirect } from 'next/navigation';
import { createSession, destroySession, verifyCredentials, signupUser } from '@/lib/auth';

export async function loginAction(formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/profile');
  const safeNext = next.startsWith('/') ? next : '/profile';

  const user = await verifyCredentials(email, password);
  if (!user) {
    redirect(`/login?error=1&next=${encodeURIComponent(safeNext)}`);
  }
  await createSession(user.id, user.email);
  redirect(safeNext);
}

export async function signupAction(formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '');

  const result = await signupUser(email, password, name);
  if ('error' in result) {
    redirect(`/signup?error=${encodeURIComponent(result.error)}`);
  }
  await createSession(result.user.id, result.user.email);
  // A fresh user starts with an empty graph — send them straight into onboarding.
  redirect('/start');
}

export async function logoutAction() {
  destroySession();
  redirect('/login');
}
