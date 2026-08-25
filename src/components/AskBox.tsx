'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'How do I classify a mortgage payment?',
  'We took out a loan to replace a water line — repair or capex?',
  'What does my P&L leave out, and why?',
  'How should I record this month’s profit split?',
];

/**
 * A place to ask an accounting question without leaving the books.
 *
 * The model is given this system's categories, conventions and current figures
 * before the question, so it answers in the vocabulary of these books rather
 * than in general. It is not a CPA and says so where it matters.
 */
export function AskBox() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  // Escape closes, so it never traps you mid-page.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function ask(question: string) {
    const text = question.trim();
    if (text === '' || busy) return;

    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns([...next, { role: 'assistant', content: '' }]);
    setDraft('');
    setBusy(true);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [...next.slice(0, -1), { role: 'user', content: `${text}\n\n(Asked from the ${pathname} screen.)` }],
        }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null);
        setTurns([...next, { role: 'assistant', content: detail?.error ?? 'The assistant could not be reached.' }]);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setTurns([...next, { role: 'assistant', content: answer }]);
      }
    } catch {
      setTurns([...next, { role: 'assistant', content: 'The connection dropped before an answer came back.' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="rounded-md border border-line px-2.5 py-1 text-[13px] text-muted transition-colors hover:border-accent hover:text-text"
        aria-expanded={open}
      >
        Ask
      </button>

      {open ? (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-line bg-surface shadow-[-4px_0_16px_rgba(16,24,40,0.08)]">
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <div className="text-[13px] font-medium tracking-tight">Ask about the books</div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted">
                Knows your categories, properties and this year&apos;s figures. Not a CPA — check anything with real
                money on it.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 text-[16px] leading-none text-muted hover:text-text"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {turns.length === 0 ? (
              <div className="space-y-2">
                <div className="text-[12px] text-muted">Try:</div>
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => ask(suggestion)}
                    className="block w-full rounded-md border border-line bg-surface-2/50 px-3 py-2 text-left text-[12px] leading-snug text-muted hover:border-accent hover:text-text"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {turns.map((turn, index) => (
                  <div key={index}>
                    {turn.role === 'user' ? (
                      <div className="rounded-md bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed">
                        {turn.content}
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap px-1 text-[12.5px] leading-relaxed">
                        {turn.content === '' && busy ? <span className="text-muted">Thinking…</span> : turn.content}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-line px-4 py-3">
            <textarea
              ref={inputRef}
              rows={2}
              value={draft}
              placeholder="How do I classify…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  ask(draft);
                }
              }}
              className="w-full text-[12.5px]"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-muted">Enter to send · Shift+Enter for a new line</span>
              <div className="flex items-center gap-3">
                {turns.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTurns([])}
                    className="text-[11px] text-muted hover:text-text"
                  >
                    New question
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => ask(draft)}
                  disabled={busy || draft.trim() === ''}
                  className="rounded-md border border-line bg-surface-2 px-3 py-1 text-[12px] hover:border-accent disabled:opacity-40"
                >
                  {busy ? '…' : 'Ask'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
