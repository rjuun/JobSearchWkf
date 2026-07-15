import { AppShell } from '@/components/app-shell';
import { Card, PageHeader } from '@/components/ui';
import { ProfileBack } from '@/components/profile-back';
import { EvidenceEditor, type FieldDef } from '@/components/evidence-editor';
import { getCareerGraph } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const FIELDS: FieldDef[] = [
  { name: 'refCode', label: 'Ref code', half: true, placeholder: 'auto (R-…)' },
  { name: 'positionRef', label: 'Position ref', half: true, placeholder: 'A' },
  { name: 'text', label: 'Responsibility', type: 'textarea' },
  { name: 'skills', label: 'Skills', type: 'list', placeholder: 'Leadership, Shared Services' },
];

export default async function ResponsibilitiesPage() {
  const g = await getCareerGraph();
  return (
    <AppShell>
      <ProfileBack />
      <div className="mt-3">
        <PageHeader
          eyebrow="Career Graph"
          title="Responsibilities"
          count={g.responsibilities.length}
          subtitle="Role-level duties — lighter than STAR stories, useful for the generic responsibilities lines of a CV."
        />
      </div>
      <Card className="p-4 sm:p-5">
        <EvidenceEditor
          kind="responsibilities"
          rows={g.responsibilities}
          fields={FIELDS}
          addLabel="Add responsibility"
          emptyText="No responsibilities yet."
        />
      </Card>
    </AppShell>
  );
}
