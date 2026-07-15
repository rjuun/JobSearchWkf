'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  profiles,
  positions,
  stars,
  starActions,
  starResults,
  starCompetences,
  starAttributes,
  responsibilities,
  education,
  languages,
  bulletBank,
  skillsMaster,
} from '@/lib/db/schema';
import { currentOwnerId } from '@/lib/auth';
import { normalizeCvPosition } from '@/lib/cv-slots';

const txt = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s.length ? s : null;
};
const list = (v: FormDataEntryValue | null) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Whitelisted CRUD over the evidence tables. Each entry knows how to build a row from a form.
 * The table type is a union at the call site, so we cast locally — `build` is table-specific and
 * the only fields written are the ones it returns.
 */
const REGISTRY = {
  positions: {
    table: positions,
    path: '/profile/positions',
    build: (f: FormData) => ({
      refCode: txt(f.get('refCode')),
      company: txt(f.get('company')),
      title: txt(f.get('title')),
      startDate: txt(f.get('startDate')),
      endDate: txt(f.get('endDate')),
      summary: txt(f.get('summary')),
    }),
  },
  stars: {
    table: stars,
    path: '/profile/stars',
    build: (f: FormData) => ({
      refCode: txt(f.get('refCode')),
      positionRef: txt(f.get('positionRef')),
      title: txt(f.get('title')),
      summary: txt(f.get('summary')),
    }),
  },
  actions: {
    table: starActions,
    path: '/profile/stars',
    build: (f: FormData) => ({
      refCode: txt(f.get('refCode')),
      starRef: txt(f.get('starRef')),
      text: txt(f.get('text')),
      skills: list(f.get('skills')),
      atsKeywords: list(f.get('atsKeywords')),
    }),
  },
  results: {
    table: starResults,
    path: '/profile/stars',
    build: (f: FormData) => ({
      refCode: txt(f.get('refCode')),
      starRef: txt(f.get('starRef')),
      text: txt(f.get('text')),
      metric: txt(f.get('metric')),
      impactType: txt(f.get('impactType')),
    }),
  },
  competences: {
    table: starCompetences,
    path: '/profile/stars',
    build: (f: FormData) => ({
      refCode: txt(f.get('refCode')),
      starRef: txt(f.get('starRef')),
      competence: txt(f.get('competence')),
    }),
  },
  attributes: {
    table: starAttributes,
    path: '/profile/stars',
    build: (f: FormData) => ({
      refCode: txt(f.get('refCode')),
      starRef: txt(f.get('starRef')),
      attribute: txt(f.get('attribute')),
    }),
  },
  responsibilities: {
    table: responsibilities,
    path: '/profile/responsibilities',
    build: (f: FormData) => ({
      refCode: txt(f.get('refCode')),
      positionRef: txt(f.get('positionRef')),
      text: txt(f.get('text')),
      skills: list(f.get('skills')),
    }),
  },
  education: {
    table: education,
    path: '/profile/education',
    build: (f: FormData) => ({
      refCode: txt(f.get('refCode')),
      institution: txt(f.get('institution')),
      qualification: txt(f.get('qualification')),
      type: txt(f.get('type')),
      year: txt(f.get('year')),
    }),
  },
  languages: {
    table: languages,
    path: '/profile/languages',
    build: (f: FormData) => ({
      refCode: txt(f.get('refCode')),
      language: txt(f.get('language')),
      cefrLevel: txt(f.get('cefrLevel')),
    }),
  },
  skills: {
    table: skillsMaster,
    path: '/profile/skills',
    build: (f: FormData) => ({
      refCode: txt(f.get('refCode')),
      skill: txt(f.get('skill')),
      proficiency: txt(f.get('proficiency')),
      atsKeywordVariants: list(f.get('atsKeywordVariants')),
      starEvidence: list(f.get('starEvidence')),
    }),
  },
  bullets: {
    table: bulletBank,
    path: '/profile/bullets',
    build: (f: FormData) => ({
      refCode: txt(f.get('refCode')),
      text: txt(f.get('text')),
      tags: list(f.get('tags')),
      cvPosition: normalizeCvPosition(txt(f.get('cvPosition'))),
      version: txt(f.get('version')),
    }),
  },
} as const;

type Kind = keyof typeof REGISTRY;

async function nextRef(kind: Kind, table: { ownerId: unknown }, starRef: string | null): Promise<string> {
  const owner = await currentOwnerId();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table as never)
    .where(eq((table as never as typeof positions).ownerId, owner));
  const i = (n ?? 0) + 1;
  switch (kind) {
    case 'positions':
      return String.fromCharCode(64 + Math.min(i, 26)); // A, B, C…
    case 'stars':
      return String(i);
    case 'actions':
      return starRef ? `${starRef}-${i}` : `ACT-${i}`;
    case 'results':
      return starRef ? `${starRef}-R${i}` : `RES-${i}`;
    case 'competences':
      return starRef ? `${starRef}-C${i}` : `CMP-${i}`;
    case 'attributes':
      return starRef ? `${starRef}-A${i}` : `ATT-${i}`;
    case 'responsibilities':
      return `R-${i}`;
    case 'education':
      return `EDU-${i}`;
    case 'languages':
      return `LANG-${i}`;
    case 'skills':
      return `SKL-${i}`;
    case 'bullets':
      return `BB-${i}`;
    default:
      return `REF-${i}`;
  }
}

export async function saveRow(formData: FormData) {
  const kind = String(formData.get('__kind') ?? '') as Kind;
  const spec = REGISTRY[kind];
  if (!spec) return;
  const owner = await currentOwnerId();
  const id = String(formData.get('id') ?? '');
  const values = spec.build(formData) as Record<string, unknown>;

  if (id) {
    await db
      .update(spec.table as never)
      .set({ ...values, updatedAt: new Date() } as never)
      .where(and(eq((spec.table as typeof positions).id, id), eq((spec.table as typeof positions).ownerId, owner)));
  } else {
    if (!values.refCode) {
      values.refCode = await nextRef(kind, spec.table, (values.starRef as string) ?? null);
    }
    values.ownerId = owner;
    await db.insert(spec.table as never).values(values as never);
  }
  revalidatePath(spec.path);
  revalidatePath('/profile');
}

export async function deleteRow(formData: FormData) {
  const kind = String(formData.get('__kind') ?? '') as Kind;
  const spec = REGISTRY[kind];
  const id = String(formData.get('id') ?? '');
  if (!spec || !id) return;
  const owner = await currentOwnerId();
  await db
    .delete(spec.table as never)
    .where(and(eq((spec.table as typeof positions).id, id), eq((spec.table as typeof positions).ownerId, owner)));
  revalidatePath(spec.path);
  revalidatePath('/profile');
}

/** Identity is the single profile row (id = owner id) — upsert it. */
export async function saveIdentity(formData: FormData) {
  const owner = await currentOwnerId();
  const values = {
    name: txt(formData.get('name')) ?? 'Me',
    headline: txt(formData.get('headline')),
    email: txt(formData.get('email')),
    phone: txt(formData.get('phone')),
    location: txt(formData.get('location')),
    languagesSummary: txt(formData.get('languagesSummary')),
  };
  const existing = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, owner));
  if (existing.length) {
    await db.update(profiles).set({ ...values, updatedAt: new Date() }).where(eq(profiles.id, owner));
  } else {
    await db.insert(profiles).values({ id: owner, ownerId: owner, ...values });
  }
  revalidatePath('/profile');
  revalidatePath('/profile/identity');
}
