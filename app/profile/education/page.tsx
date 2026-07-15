import { AppShell } from '@/components/app-shell';
import { Card, PageHeader } from '@/components/ui';
import { ProfileBack } from '@/components/profile-back';
import { EvidenceEditor, type FieldDef } from '@/components/evidence-editor';
import { getCareerGraph } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const FIELDS: FieldDef[] = [
  { name: 'refCode', label: 'Ref code', half: true, placeholder: 'auto (EDU-…)' },
  { name: 'year', label: 'Year', half: true, placeholder: '2015' },
  { name: 'qualification', label: 'Qualification', placeholder: 'MBA' },
  { name: 'institution', label: 'Institution', half: true },
  { name: 'type', label: 'Type', half: true, placeholder: 'formal / executive / certification' },
];

export default async function EducationPage() {
  const g = await getCareerGraph();
  return (
    <AppShell>
      <ProfileBack />
      <div className="mt-3">
        <PageHeader
          eyebrow="Career Graph"
          title="Education"
          count={g.education.length}
          subtitle="Degrees, executive education and certifications."
        />
      </div>
      <Card className="p-4 sm:p-5">
        <EvidenceEditor
          kind="education"
          rows={g.education}
          fields={FIELDS}
          addLabel="Add education"
          emptyText="No education yet."
        />
      </Card>
    </AppShell>
  );
}
