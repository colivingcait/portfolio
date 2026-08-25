import Anthropic from '@anthropic-ai/sdk';
import { buildSnapshot, CONVENTIONS, PERSONA } from '@/lib/assistant-context';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The model that answers. Opus, because a wrong tax answer is expensive. */
const MODEL = 'claude-opus-5';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

function bad(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return bad(
      503,
      'No ANTHROPIC_API_KEY is set, so the assistant is off. Add one in Vercel → Settings → Environment Variables and redeploy.',
    );
  }

  let turns: Turn[];
  try {
    const body = (await request.json()) as { messages?: Turn[] };
    turns = (body.messages ?? [])
      .filter((turn) => turn.content.trim() !== '')
      // A long thread is fine; a runaway one is not.
      .slice(-20);
  } catch {
    return bad(400, 'Could not read that request.');
  }
  if (turns.length === 0) return bad(400, 'Ask a question first.');

  let snapshot: string;
  try {
    snapshot = (await buildSnapshot()).text;
  } catch {
    // The books being unreachable should degrade the answer, not remove it.
    snapshot = 'The portfolio data could not be read for this question, so answer from the conventions alone and say that figures are unavailable.';
  }

  const client = new Anthropic();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const response = client.messages.stream({
          model: MODEL,
          max_tokens: 64000,
          system: [
            // Stable prefix first so it caches; the snapshot changes as the
            // books do and sits after the breakpoint.
            { type: 'text', text: PERSONA },
            { type: 'text', text: CONVENTIONS, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: snapshot },
          ],
          messages: turns.map((turn) => ({ role: turn.role, content: turn.content })),
        });

        for await (const event of response) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }

        const final = await response.finalMessage();
        if (final.stop_reason === 'refusal') {
          controller.enqueue(encoder.encode('\n\n_That question was declined. Try rephrasing it._'));
        }
      } catch (error) {
        const message =
          error instanceof Anthropic.AuthenticationError
            ? 'The ANTHROPIC_API_KEY was rejected. Check it in Vercel → Settings → Environment Variables.'
            : error instanceof Anthropic.RateLimitError
              ? 'Rate limited. Wait a moment and ask again.'
              : error instanceof Anthropic.APIError
                ? `The model returned an error (${error.status}). Try again.`
                : 'Something went wrong reaching the model.';
        controller.enqueue(encoder.encode(`\n\n**${message}**`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      // Proxies that buffer would defeat the point of streaming.
      'x-accel-buffering': 'no',
    },
  });
}
