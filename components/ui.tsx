import clsx from 'clsx';
import Link from 'next/link';
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import {
  TONE_BADGE,
  TONE_DOT,
  rankTone,
  recommendationMeta,
  scoreSolid,
  statusMeta,
  type Tone,
} from '@/lib/ui';

export function cn(...a: Parameters<typeof clsx>) {
  return clsx(...a);
}

// Re-export tone helpers so `@/components/ui` stays the single UI import surface.
export { rankTone, statusMeta, recommendationMeta, TONE_BADGE, type Tone } from '@/lib/ui';

// ── Buttons ──────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-xs hover:bg-brand-700 ring-1 ring-inset ring-brand-700/20',
  secondary:
    'bg-surface text-ink shadow-xs ring-1 ring-inset ring-hairline hover:bg-raised hover:ring-slate-300',
  ghost: 'text-ink-muted hover:bg-raised hover:text-ink',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  danger: 'bg-rose-600 text-white shadow-xs hover:bg-rose-700',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-[13px]',
  md: 'h-9 gap-2 px-3.5 text-sm',
  lg: 'h-11 gap-2 px-5 text-sm',
};

export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', block = false) {
  return cn(
    'inline-flex select-none items-center justify-center whitespace-nowrap rounded-field font-medium',
    'transition duration-150 ease-out-soft active:scale-[.985]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/55 focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    VARIANT[variant],
    SIZE[size],
    block && 'w-full'
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

export function Button({
  variant,
  size,
  block,
  loading,
  leftIcon,
  rightIcon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClasses(variant, size, block), className)}
    >
      {loading ? <Spinner /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: Variant;
  size?: Size;
  block?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

export function ButtonLink({
  href,
  variant,
  size,
  block,
  leftIcon,
  rightIcon,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const external = /^https?:/.test(href) || rest.target === '_blank';
  const cls = cn(buttonClasses(variant, size, block), className);
  const inner = (
    <>
      {leftIcon}
      {children}
      {rightIcon}
    </>
  );
  if (external) {
    return (
      <a href={href} className={cls} {...rest}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {inner}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-20" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-card border border-hairline bg-surface shadow-card', className)}>
      {children}
    </div>
  );
}

// ── Badges & status ──────────────────────────────────────────────────────────

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONE_BADGE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral', className }: { tone?: Tone; className?: string }) {
  return <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[tone], className)} />;
}

export function StatusBadge({ status }: { status: string }) {
  const meta = statusMeta(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONE_BADGE[meta.tone]
      )}
    >
      <Dot tone={meta.tone} />
      {meta.label}
    </span>
  );
}

/** Colours a 0–10 fit score, matching the B6 recommendation tiers. */
export function ScorePill({
  score,
  size = 'md',
}: {
  score: number | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (score == null) {
    return <span className="text-sm text-ink-subtle">—</span>;
  }
  const sz =
    size === 'lg'
      ? 'min-w-[3.25rem] px-2.5 py-1.5 text-lg'
      : size === 'sm'
        ? 'min-w-[2.25rem] px-1.5 py-0.5 text-xs'
        : 'min-w-[2.75rem] px-2 py-1 text-sm';
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-md font-semibold tabular-nums text-white shadow-xs',
        scoreSolid(score),
        sz
      )}
    >
      {score.toFixed(1)}
    </span>
  );
}

// ── Metric tile ──────────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="eyebrow">{label}</div>
        {icon && <span className="text-ink-subtle">{icon}</span>}
      </div>
      <div
        className={cn(
          'mt-1.5 text-[26px] font-semibold leading-none tracking-tight tabular-nums',
          accent ? 'text-brand-600' : 'text-ink'
        )}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && <div className="mt-1.5 text-xs text-ink-subtle">{sub}</div>}
    </Card>
  );
}

// ── Page header ──────────────────────────────────────────────────────────────

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  count,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Optional tally rendered as an oversized serif numeral beside the title —
   *  borrows the hero's type-contrast so the flat sub-pages read less plain. */
  count?: number;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <div className="flex items-baseline gap-3">
          {count != null && (
            <span className="font-serif text-[38px] leading-none text-proof tabular-nums">{count}</span>
          )}
          <h1 className="font-serif text-[30px] leading-tight text-ink">{title}</h1>
        </div>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Forms ────────────────────────────────────────────────────────────────────

const fieldBase =
  'w-full rounded-field border border-hairline bg-surface px-3 text-sm text-ink shadow-xs ' +
  'placeholder:text-ink-subtle transition ' +
  'focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-500/12 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">
      {children}
    </label>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-rose-600">{error}</p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-ink-subtle">{hint}</p>
      )}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(fieldBase, 'h-10', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(fieldBase, 'py-2.5 leading-relaxed', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(fieldBase, 'h-10 pr-8', className)}>
      {children}
    </select>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-raised text-ink-subtle ring-1 ring-hairline">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-subtle">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Tooltip (CSS-only, server-renderable) ────────────────────────────────────

export function Tooltip({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('group/tip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-white opacity-0 shadow-pop transition group-hover/tip:translate-y-0 group-hover/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

// ── Skeleton (loading) ───────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-raised',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.5s_infinite] after:bg-gradient-to-r after:from-transparent after:via-white/60 after:to-transparent',
        className
      )}
    />
  );
}
