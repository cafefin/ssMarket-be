import { Inject, Injectable } from '@nestjs/common';

export const CHAT_FETCH = Symbol('CHAT_FETCH');
export const CHAT_SLEEP = Symbol('CHAT_SLEEP');

export type SendResult = { ok: true } | { ok: false; error: string };

const DELAYS_MS = [1_000, 3_000];

@Injectable()
export class GoogleChatClient {
  constructor(
    @Inject(CHAT_FETCH) private readonly fetch: typeof globalThis.fetch,
    @Inject(CHAT_SLEEP) private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  /** POST { text }; 5 s timeout; network error, 429 or 5xx retried after 1 s and 3 s. */
  async send(webhookUrl: string, text: string): Promise<SendResult> {
    let error = '';
    for (let attempt = 0; attempt <= DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) await this.sleep(DELAYS_MS[attempt - 1]);
      try {
        const response = await this.fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) return { ok: true };
        error = `HTTP ${response.status}`;
        if (response.status !== 429 && response.status < 500) {
          const body = (await response.text()).slice(0, 200);
          return { ok: false, error: body ? `${error}: ${body}` : error };
        }
      } catch (caught) {
        // Node's fetch errors do not include the URL; keep only the message.
        error =
          (caught as Error).name === 'TimeoutError'
            ? 'timed out after 5 s'
            : (caught as Error).message;
      }
    }
    return { ok: false, error };
  }
}
