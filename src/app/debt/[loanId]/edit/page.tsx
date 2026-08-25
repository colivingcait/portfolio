import { EditRecord } from '@/components/EditRecord';

export const dynamic = 'force-dynamic';

export default async function EditLoanPage({ params }: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;
  return <EditRecord modelKey="loan" id={loanId} backHref={`/debt/${loanId}`} />;
}
