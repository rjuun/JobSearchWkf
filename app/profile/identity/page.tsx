import { AppShell } from '@/components/app-shell';
import { Card, Field, Input, Button, PageHeader } from '@/components/ui';
import { ProfileBack } from '@/components/profile-back';
import { getProfile } from '@/lib/queries';
import { saveIdentity } from '@/app/actions/profile';

export const dynamic = 'force-dynamic';

export default async function IdentityPage() {
  const p = await getProfile();
  return (
    <AppShell>
      <ProfileBack />
      <div className="mt-3">
        <PageHeader
          eyebrow="Career Graph"
          title="Identity"
          subtitle="Your name, headline and contact — the top of every CV."
        />
      </div>
      <Card className="max-w-2xl p-5 sm:p-6">
        <form action={saveIdentity} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" defaultValue={p?.name ?? ''} required />
            </Field>
            <Field label="Location" htmlFor="location">
              <Input id="location" name="location" defaultValue={p?.location ?? ''} placeholder="Vienna, Austria" />
            </Field>
          </div>
          <Field label="Headline" htmlFor="headline">
            <Input id="headline" name="headline" defaultValue={p?.headline ?? ''} placeholder="Senior Transformation & Finance Executive" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" defaultValue={p?.email ?? ''} />
            </Field>
            <Field label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" defaultValue={p?.phone ?? ''} />
            </Field>
          </div>
          <Field label="Citizenship / work authorization" htmlFor="citizenship">
            <Input id="citizenship" name="citizenship" defaultValue={p?.citizenship ?? ''} placeholder="Austrian citizen · EU work authorization" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Relocation" htmlFor="relocation">
              <Input id="relocation" name="relocation" defaultValue={p?.relocation ?? ''} placeholder="Open to relocation within the EU" />
            </Field>
            <Field label="Travel" htmlFor="travel">
              <Input id="travel" name="travel" defaultValue={p?.travel ?? ''} placeholder="Willing to travel up to 50%" />
            </Field>
          </div>
          <Button type="submit">Save identity</Button>
        </form>
      </Card>
    </AppShell>
  );
}
