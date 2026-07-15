import Link from 'next/link';
import { signupAction } from '@/app/actions/auth';
import { Field, Input, Button } from '@/components/ui';

export default function SignupPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl2 bg-brand-600 text-lg font-bold text-white shadow-elevated">
            R
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Create your account</h1>
          <p className="mt-1 text-sm text-ink-muted">Start building your Career Graph</p>
        </div>

        <form action={signupAction} className="space-y-4 rounded-card border border-hairline bg-surface p-6 shadow-card">
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" autoComplete="name" placeholder="Alex Rivera" />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </Field>
          <Field label="Password" htmlFor="password" hint="At least 6 characters.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </Field>
          {searchParams.error && (
            <p className="rounded-field bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-100">
              {searchParams.error}
            </p>
          )}
          <Button type="submit" block size="lg">
            Create account
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-muted">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
