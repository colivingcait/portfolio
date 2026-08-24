'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteRecord } from '@/lib/actions';
import type { ModelKey } from '@/lib/models';

export function DeleteButton({ modelKey, id, label = 'Delete' }: { modelKey: ModelKey; id: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm('Delete this record? Dated records are how history stays intact — ending it may be what you want instead.')) return;
        startTransition(async () => {
          await deleteRecord(modelKey, id);
          router.refresh();
        });
      }}
      className="text-[12px] text-muted hover:text-bad disabled:opacity-50"
    >
      {pending ? '…' : label}
    </button>
  );
}
