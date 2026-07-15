import { AppShell } from '@/components/app-shell';
import { Card, PageHeader } from '@/components/ui';
import { ProfileBack } from '@/components/profile-back';
import { EvidenceEditor, type FieldDef } from '@/components/evidence-editor';
import { getCareerGraph } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const FIELDS: FieldDef[] = [
  { name: 'refCode', label: 'Ref code', half: true, placeholder: 'auto (A, B, C…)' },
  { name: 'company', label: 'Company', half: true },
  { name: 'title', label: 'Title' },
  { name: 'startDate', label: 'Start', half: true, placeholder: '2019' },
  { name: 'endDate', label: 'End', half: true, placeholder: 'Present' },
  { name: 'summary', label: 'Summary', type: 'textarea' },
];

export default async function PositionsPage() {
  const g = await getCareerGraph();
  return (
    <AppShell>
      <ProfileBack />
      <div className="mt-3">
        <PageHeader
          eyebrow="Career Graph"
          title="Positions"
          count={g.positions.length}
          subtitle="Your career history — the anchor every STAR story and responsibility hangs from."
        />
      </div>
      <Card className="p-4 sm:p-5">
        <EvidenceEditor
          kind="positions"
          rows={g.positions}
          fields={FIELDS}
          addLabel="Add position"
          emptyText="No positions yet — add your roles."
        />
      </Card>
    </AppShell>
  );
}
