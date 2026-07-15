import { AppShell } from '@/components/app-shell';
import { Card, PageHeader } from '@/components/ui';
import { ProfileBack } from '@/components/profile-back';
import { EvidenceEditor, type FieldDef } from '@/components/evidence-editor';
import { getCareerGraph } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const STAR_FIELDS: FieldDef[] = [
  { name: 'refCode', label: 'Ref code', half: true, placeholder: 'auto (1, 2, 3…)' },
  { name: 'positionRef', label: 'Position ref', half: true, placeholder: 'A' },
  { name: 'title', label: 'Title' },
  { name: 'summary', label: 'Situation / Task (summary)', type: 'textarea' },
];
const ACTION_FIELDS: FieldDef[] = [
  { name: 'refCode', label: 'Ref code', half: true, placeholder: 'auto (5-3)' },
  { name: 'starRef', label: 'Story ref', half: true, placeholder: '5' },
  { name: 'text', label: 'Action', type: 'textarea' },
  { name: 'skills', label: 'Skills', type: 'list', placeholder: 'Governance, Stakeholder Mgmt' },
  { name: 'atsKeywords', label: 'ATS keywords', type: 'list', placeholder: 'Corporate Governance' },
];
const RESULT_FIELDS: FieldDef[] = [
  { name: 'refCode', label: 'Ref code', half: true, placeholder: 'auto (5-R2)' },
  { name: 'starRef', label: 'Story ref', half: true, placeholder: '5' },
  { name: 'text', label: 'Result', type: 'textarea' },
  { name: 'metric', label: 'Metric', half: true, placeholder: '30% cost reduction' },
  { name: 'impactType', label: 'Impact type', half: true, placeholder: 'cost / time / people' },
];
const COMPETENCE_FIELDS: FieldDef[] = [
  { name: 'refCode', label: 'Ref code', half: true, placeholder: 'auto (5-C1)' },
  { name: 'starRef', label: 'Story ref', half: true, placeholder: '5' },
  { name: 'competence', label: 'Competence' },
];
const ATTRIBUTE_FIELDS: FieldDef[] = [
  { name: 'refCode', label: 'Ref code', half: true, placeholder: 'auto (5-A2)' },
  { name: 'starRef', label: 'Story ref', half: true, placeholder: '5' },
  { name: 'attribute', label: 'Attribute' },
];

export default async function StarsPage() {
  const g = await getCareerGraph();
  return (
    <AppShell>
      <ProfileBack />
      <div className="mt-3">
        <PageHeader
          eyebrow="Career Graph"
          title="STAR stories"
          count={g.stars.length}
          subtitle="The backbone of your evidence. A story (ref “5”) groups its actions (“5-3”), quantified results (“5-R2”), competences and attributes — link each by the story ref."
        />
      </div>

      <div className="space-y-4">
        <SectionCard title="Stories" hint="Situation · Task — the narrative arc">
          <EvidenceEditor kind="stars" rows={g.stars} fields={STAR_FIELDS} addLabel="Add story" emptyText="No stories yet — add your first STAR story." />
        </SectionCard>

        <SectionCard title="Actions" hint="The primary source of CV bullets">
          <EvidenceEditor kind="actions" rows={g.actions} fields={ACTION_FIELDS} addLabel="Add action" emptyText="No actions yet." />
        </SectionCard>

        <SectionCard title="Results" hint="Quantified outcomes — the proof">
          <EvidenceEditor kind="results" rows={g.results} fields={RESULT_FIELDS} addLabel="Add result" emptyText="No results yet." />
        </SectionCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Competences" hint="Behaviours demonstrated">
            <EvidenceEditor kind="competences" rows={g.competences} fields={COMPETENCE_FIELDS} addLabel="Add competence" emptyText="No competences yet." />
          </SectionCard>
          <SectionCard title="Attributes" hint="Personal character">
            <EvidenceEditor kind="attributes" rows={g.attributes} fields={ATTRIBUTE_FIELDS} addLabel="Add attribute" emptyText="No attributes yet." />
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}

function SectionCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <p className="text-[11px] text-ink-subtle">{hint}</p>
      </div>
      {children}
    </Card>
  );
}
