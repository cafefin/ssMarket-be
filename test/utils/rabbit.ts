import amqplib, { type Channel } from 'amqplib';
import {
  deadLetterQueue,
  QUEUES,
  retryQueue,
} from '../../src/worker/topology.js';

const MANAGEMENT =
  process.env.TEST_RABBITMQ_MANAGEMENT_URL ?? 'http://localhost:15673';
const AUTH = `Basic ${Buffer.from('ssmarket:ssmarket').toString('base64')}`;

/** Creates the test vhost and gives the ssmarket user access; idempotent. */
export async function ensureTestVhost(): Promise<void> {
  const vhost = decodeURIComponent(
    new URL(process.env.RABBITMQ_URL as string).pathname.slice(1),
  );
  if (!vhost) {
    return; // the default vhost always exists
  }
  const put = (path: string, body: object) =>
    fetch(`${MANAGEMENT}/api/${path}`, {
      method: 'PUT',
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`RabbitMQ management ${path}: ${response.status}`);
      }
    });
  const name = encodeURIComponent(vhost);
  await put(`vhosts/${name}`, {});
  await put(`permissions/${name}/ssmarket`, {
    configure: '.*',
    write: '.*',
    read: '.*',
  });
}

export const TEST_QUEUES = QUEUES.flatMap(({ name }) => [
  name,
  retryQueue(name),
  deadLetterQueue(name),
]);

/** A raw amqplib channel on the test vhost, for inspecting what the code published. */
export async function openTestChannel(): Promise<{
  channel: Channel;
  close: () => Promise<void>;
}> {
  const connection = await amqplib.connect(process.env.RABBITMQ_URL as string);
  const channel = await connection.createChannel();
  return {
    channel,
    close: async () => {
      await channel.close();
      await connection.close();
    },
  };
}

/** Empties all six queues; they must already be declared. */
export async function purgeAll(channel: Channel): Promise<void> {
  for (const queue of TEST_QUEUES) {
    await channel.purgeQueue(queue);
  }
}
