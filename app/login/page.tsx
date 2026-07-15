import Link from 'next/link';
import { loginAction } from '@/app/actions/auth';
import { Field, Input, Button } from '@/components/ui';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  const error = searchParams.error;
  const next = searchParams.next ?? '/profile';
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl2 bg-brand-600 text-lg font-bold text-white shadow-elevated">
            R
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">RoleProof</h1>
          <p className="mt-1 text-sm text-ink-muted">Sign in to your pipeline</p>
        </div>

        <form
          action={loginAction}
          className="space-y-4 rounded-card border border-hairline bg-surface p-6 shadow-card"
        >
          <input type="hidden" name="next" value={next} />
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </Field>
          {error && (
            <p className="rounded-field bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-100">
              Invalid email or password.
            </p>
          )}
          <Button type="submit" block size="lg">
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-muted">
          New here?{' '}
          <Link href="/signup" className="font-medium text-brand-600 hover:text-brand-700">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
