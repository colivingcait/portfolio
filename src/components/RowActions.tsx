import Link from 'next/link';
import { DeleteButton } from './DeleteButton';
import type { ModelKey } from '@/lib/models';

/** Edit and delete on a table row, identical everywhere a record is listed. */
export function RowActions({ modelKey, id, back }: { modelKey: ModelKey; id: string; back: string }) {
  return (
    <div className="flex items-center gap-3">
      <Link
        href={`/edit/${modelKey}/${id}?back=${encodeURIComponent(back)}`}
        className="text-[12px] text-muted hover:text-accent"
      >
        Edit
      </Link>
      <DeleteButton modelKey={modelKey} id={id} />
    </div>
  );
}
