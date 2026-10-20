import {
  settingsProblems,
  webhookHint,
  type ChatSettingsInput,
} from './chat-settings-rules.js';

const OK_URL = 'https://chat.googleapis.com/v1/spaces/x/messages?key=a&token=b';
const base: ChatSettingsInput = {
  enabled: true,
  maxPerHour: 10,
  sellerCooldownMinutes: 30,
  webhookUrl: OK_URL,
};
const BAD_URL =
  'webhookUrl must be a Google Chat webhook (https://chat.googleapis.com/v1/spaces/...)';

describe('settingsProblems', () => {
  it('accepts valid input', () => {
    expect(settingsProblems(base, false)).toEqual([]);
    expect(settingsProblems({ ...base, maxPerHour: null }, false)).toEqual([]);
  });

  it.each([0, 61, 1.5])('rejects maxPerHour %s', (maxPerHour) => {
    expect(settingsProblems({ ...base, maxPerHour }, false)).toEqual([
      'maxPerHour must be a whole number from 1 to 60, or null',
    ]);
  });

  it.each([-1, 1441])('rejects cooldown %s', (sellerCooldownMinutes) => {
    expect(settingsProblems({ ...base, sellerCooldownMinutes }, false)).toEqual([
      'sellerCooldownMinutes must be a whole number from 0 to 1440',
    ]);
  });

  it.each([
    'http://chat.googleapis.com/v1/spaces/x',
    'https://evil.example/v1/spaces/x',
    'https://chat.googleapis.com.evil.example/v1/spaces/x',
    `https://chat.googleapis.com/v1/spaces/${'a'.repeat(2000)}`,
  ])('rejects webhook %#', (webhookUrl) => {
    expect(settingsProblems({ ...base, webhookUrl }, false)).toEqual([BAD_URL]);
  });

  it('requires a webhook to turn the channel on', () => {
    const message = 'a webhook is required to turn the channel on';
    expect(settingsProblems({ ...base, webhookUrl: null }, true)).toEqual([message]);
    expect(settingsProblems({ ...base, webhookUrl: undefined }, false)).toEqual([
      message,
    ]);
    expect(settingsProblems({ ...base, webhookUrl: undefined }, true)).toEqual([]);
  });
});

describe('webhookHint', () => {
  it('gives the last 4 characters', () => {
    expect(webhookHint('https://x/messages?key=a&token=WXYZ')).toBe('WXYZ');
    expect(webhookHint(null)).toBeNull();
  });
});
