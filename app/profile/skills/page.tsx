import { AppShell } from '@/components/app-shell';
import { Card, PageHeader } from '@/components/ui';
import { ProfileBack } from '@/components/profile-back';
import { EvidenceEditor, type FieldDef } from '@/components/evidence-editor';
import { getCareerGraph } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const FIELDS: FieldDef[] = [
  { name: 'refCode', label: 'Ref code', half: true, placeholder: 'auto (SKL-…)' },
  { name: 'proficiency', label: 'Proficiency', half: true, placeholder: 'Expert' },
  { name: 'skill', label: 'Skill' },
  { name: 'atsKeywordVariants', label: 'ATS keyword variants', type: 'list', placeholder: 'Corporate Governance, Governance Digitisation' },
  { name: 'starEvidence', label: 'STAR evidence refs', type: 'list', placeholder: '5-3, 7-1' },
];

export default async function SkillsPage() {
  const g = await getCareerGraph();
  return (
    <AppShell>
      <ProfileBack />
      <div className="mt-3">
        <PageHeader
          eyebrow="Career Graph"
          title="Skills"
          count={g.skills.length}
          subtitle="Your skill inventory. ATS keyword variants let tailoring mirror a job's exact wording — only where it's genuinely supported."
        />
      </div>
      <Card className="p-4 sm:p-5">
        <EvidenceEditor
          kind="skills"
          rows={g.skills}
          fields={FIELDS}
          addLabel="Add skill"
          emptyText="No skills yet."
        />
      </Card>
    </AppShell>
  );
}
