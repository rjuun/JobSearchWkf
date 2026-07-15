import { AppShell } from '@/components/app-shell';
import { Card, PageHeader } from '@/components/ui';
import { ProfileBack } from '@/components/profile-back';
import { EvidenceEditor, type FieldDef } from '@/components/evidence-editor';
import { getCareerGraph } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const FIELDS: FieldDef[] = [
  { name: 'refCode', label: 'Ref code', half: true, placeholder: 'auto (BB-…)' },
  { name: 'version', label: 'Version', half: true, placeholder: '1.0' },
  { name: 'text', label: 'Bullet', type: 'textarea' },
  { name: 'tags', label: 'Tags', type: 'list', placeholder: 'Leadership, Governance' },
  { name: 'cvPosition', label: 'CV position', half: true, placeholder: 'A1 or full template slot' },
];

export default async function BulletsPage() {
  const g = await getCareerGraph();
  return (
    <AppShell>
      <ProfileBack />
      <div className="mt-3">
        <PageHeader
          eyebrow="Career Graph"
          title="Bullet bank"
          count={g.bullets.length}
          subtitle="Your strongest, hand-curated bullets. Screening (B6) scores role fit against these without tailoring bias."
        />
      </div>
      <Card className="p-4 sm:p-5">
        <EvidenceEditor
          kind="bullets"
          rows={g.bullets}
          fields={FIELDS}
          addLabel="Add bullet"
          emptyText="No bullets yet."
        />
      </Card>
    </AppShell>
  );
}
