import { GoogleChatClient } from './google-chat.client.js';

const URL_WITH_SECRET =
  'https://chat.googleapis.com/v1/spaces/AAA/messages?key=K&token=SECRET';

const cancelBody = vi.fn().mockResolvedValue(undefined);

const reply = (status: number, body = ''): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    body: { cancel: cancelBody },
  }) as unknown as Response;

describe('GoogleChatClient', () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  let sleep: ReturnType<typeof vi.fn>;
  let client: GoogleChatClient;

  beforeEach(() => {
    cancelBody.mockClear();
    fetchFn = vi.fn();
    sleep = vi.fn().mockResolvedValue(undefined);
    client = new GoogleChatClient(
      fetchFn as unknown as typeof fetch,
      sleep as unknown as (ms: number) => Promise<void>,
    );
  });

  it('posts the text once and succeeds on 200', async () => {
    fetchFn.mockResolvedValue(reply(200));
    expect(await client.send(URL_WITH_SECRET, 'xin chào')).toEqual({
      ok: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_WITH_SECRET);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'content-type': 'application/json; charset=UTF-8',
    });
    expect(init.body).toBe('{"text":"xin chào"}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('error');
  });

  it('fails a redirect without retrying', async () => {
    // What Node's fetch throws for a 3xx with redirect: 'error'.
    fetchFn.mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), {
        cause: new Error('unexpected redirect'),
      }),
    );
    expect(await client.send(URL_WITH_SECRET, 'x')).toEqual({
      ok: false,
      error: 'redirect refused',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries 5xx after 1 s and 3 s', async () => {
    fetchFn
      .mockResolvedValueOnce(reply(503))
      .mockResolvedValueOnce(reply(503))
      .mockResolvedValueOnce(reply(200));
    expect(await client.send(URL_WITH_SECRET, 'x')).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [3000]]);
  });

  it('gives up on 429 after three calls', async () => {
    fetchFn.mockResolvedValue(reply(429));
    expect(await client.send(URL_WITH_SECRET, 'x')).toEqual({
      ok: false,
      error: 'HTTP 429',
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('does not retry other 4xx and keeps 200 characters of the body', async () => {
    fetchFn.mockResolvedValue(reply(400, 'b'.repeat(300)));
    expect(await client.send(URL_WITH_SECRET, 'x')).toEqual({
      ok: false,
      error: `HTTP 400: ${'b'.repeat(200)}`,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports HTTP status alone when the body is empty', async () => {
    fetchFn.mockResolvedValue(reply(404));
    expect(await client.send(URL_WITH_SECRET, 'x')).toEqual({
      ok: false,
      error: 'HTTP 404',
    });
  });

  it('releases the body of a response it will retry', async () => {
    fetchFn
      .mockResolvedValueOnce(reply(503))
      .mockResolvedValueOnce(reply(429))
      .mockResolvedValueOnce(reply(200));
    await client.send(URL_WITH_SECRET, 'x');
    expect(cancelBody).toHaveBeenCalledTimes(2);
  });

  it('retries network errors and reports only the error class and code', async () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }),
    });
    fetchFn.mockRejectedValue(error);
    expect(await client.send(URL_WITH_SECRET, 'x')).toEqual({
      ok: false,
      error: 'network error (TypeError ECONNRESET)',
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('never returns the message of a caught error', async () => {
    fetchFn.mockRejectedValue(new TypeError(`Invalid URL ${URL_WITH_SECRET}`));
    const result = await client.send(URL_WITH_SECRET, 'x');
    expect(result).toEqual({ ok: false, error: 'network error (TypeError)' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('reports a timeout without the URL', async () => {
    const timeout = new Error(`aborted ${URL_WITH_SECRET}`);
    timeout.name = 'TimeoutError';
    fetchFn.mockRejectedValue(timeout);
    const result = await client.send(URL_WITH_SECRET, 'x');
    expect(result).toEqual({ ok: false, error: 'timed out after 5 s' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});
