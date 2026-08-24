'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteStatement } from '@/lib/import-actions';

export function DeleteStatementButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm('Delete this statement and its transactions? Rollups for the months it covers will be recomputed without it.')) return;
        startTransition(async () => {
          await deleteStatement(id);
          router.refresh();
        });
      }}
      className="text-[12px] text-muted hover:text-bad disabled:opacity-50"
    >
      {pending ? '…' : 'Delete'}
    </button>
  );
}
