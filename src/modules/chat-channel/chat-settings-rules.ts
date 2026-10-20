export const WEBHOOK_PREFIX = 'https://chat.googleapis.com/v1/spaces/';

export interface ChatSettingsInput {
  enabled: boolean;
  maxPerHour: number | null;
  sellerCooldownMinutes: number;
  /** undefined keeps the stored URL, null removes it. */
  webhookUrl?: string | null;
}

function isWebhook(url: string): boolean {
  if (url.length > 2000 || !url.startsWith(WEBHOOK_PREFIX)) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' && parsed.hostname === 'chat.googleapis.com'
    );
  } catch {
    return false;
  }
}

export function settingsProblems(
  input: ChatSettingsInput,
  hasStoredWebhook: boolean,
): string[] {
  const problems: string[] = [];
  const { maxPerHour, sellerCooldownMinutes, webhookUrl } = input;
  if (
    maxPerHour !== null &&
    (!Number.isInteger(maxPerHour) || maxPerHour < 1 || maxPerHour > 60)
  ) {
    problems.push('maxPerHour must be a whole number from 1 to 60, or null');
  }
  if (
    !Number.isInteger(sellerCooldownMinutes) ||
    sellerCooldownMinutes < 0 ||
    sellerCooldownMinutes > 1440
  ) {
    problems.push('sellerCooldownMinutes must be a whole number from 0 to 1440');
  }
  if (typeof webhookUrl === 'string' && !isWebhook(webhookUrl)) {
    problems.push(
      'webhookUrl must be a Google Chat webhook (https://chat.googleapis.com/v1/spaces/...)',
    );
  }
  const willHaveWebhook =
    webhookUrl === undefined ? hasStoredWebhook : webhookUrl !== null;
  if (input.enabled && !willHaveWebhook) {
    problems.push('a webhook is required to turn the channel on');
  }
  return problems;
}

/** The last 4 characters, enough to tell two webhooks apart. */
export function webhookHint(url: string | null): string | null {
  return url === null ? null : url.slice(-4);
}
