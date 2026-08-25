import { notFound } from 'next/navigation';
import { EditRecord } from '@/components/EditRecord';
import { MODELS, type ModelKey } from '@/lib/models';

export const dynamic = 'force-dynamic';

/**
 * One edit route for every record, wherever it was listed.
 *
 * The same record is now shown in more than one place — an ownership interest
 * on its property's page and on the ownership screen, a loan on the ladder and
 * on the property. A per-screen edit route would mean two routes per record and
 * a back link that lies half the time, so the caller says where it came from.
 */
export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ model: string; id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { model, id } = await params;
  const { back } = await searchParams;
  if (!(model in MODELS)) notFound();

  // Only a path on this site. "//evil.com" is a protocol-relative URL that a
  // link would follow off-site, so a leading double slash is refused.
  const backHref = typeof back === 'string' && back.startsWith('/') && !back.startsWith('//') ? back : '/';

  return <EditRecord modelKey={model as ModelKey} id={id} backHref={backHref} />;
}
