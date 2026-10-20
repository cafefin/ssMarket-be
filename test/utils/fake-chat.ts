import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A local HTTP server standing in for Google Chat, and a fetch that sends there. */
export async function startFakeChat(): Promise<{
  received: { path: string; text: string }[];
  respondWith(status: number): void;
  fetch: typeof fetch;
  close(): Promise<void>;
}> {
  const received: { path: string; text: string }[] = [];
  let status = 200;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        text: string;
      };
      received.push({ path: request.url ?? '', text: body.text });
      response.statusCode = status;
      response.end(status === 200 ? '{}' : 'fake chat refused');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    received,
    respondWith: (next) => {
      status = next;
    },
    fetch: (input, init) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return globalThis.fetch(
        `http://127.0.0.1:${port}${url.pathname}${url.search}`,
        init,
      );
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
