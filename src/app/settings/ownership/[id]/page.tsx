import { EditRecord } from '../../_shared/EditRecord';

export const dynamic = 'force-dynamic';

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditRecord modelKey="ownershipInterest" id={id} backHref="/settings/ownership" />;
}
