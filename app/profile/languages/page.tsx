import { AppShell } from '@/components/app-shell';
import { Card, PageHeader } from '@/components/ui';
import { ProfileBack } from '@/components/profile-back';
import { EvidenceEditor, type FieldDef } from '@/components/evidence-editor';
import { getCareerGraph } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const FIELDS: FieldDef[] = [
  { name: 'refCode', label: 'Ref code', half: true, placeholder: 'auto (LANG-…)' },
  { name: 'cefrLevel', label: 'CEFR level', half: true, placeholder: 'C1' },
  { name: 'language', label: 'Language' },
];

export default async function LanguagesPage() {
  const g = await getCareerGraph();
  return (
    <AppShell>
      <ProfileBack />
      <div className="mt-3">
        <PageHeader
          eyebrow="Career Graph"
          title="Languages"
          count={g.languages.length}
          subtitle="Languages and proficiency (CEFR). Used by screening to flag language roadblocks honestly."
        />
      </div>
      <Card className="p-4 sm:p-5">
        <EvidenceEditor
          kind="languages"
          rows={g.languages}
          fields={FIELDS}
          addLabel="Add language"
          emptyText="No languages yet."
        />
      </Card>
    </AppShell>
  );
}
