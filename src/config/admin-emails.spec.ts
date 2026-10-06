import { parseAdminEmails } from './admin-emails.js';

describe('parseAdminEmails', () => {
  it('returns an empty set for a missing or blank value', () => {
    expect(parseAdminEmails(undefined).size).toBe(0);
    expect(parseAdminEmails('  ').size).toBe(0);
  });

  it('splits on commas, trims and lower-cases', () => {
    expect([
      ...parseAdminEmails(' An@Example.com , binh@example.com,'),
    ]).toEqual(['an@example.com', 'binh@example.com']);
  });

  it('rejects an entry that is not an email', () => {
    expect(() => parseAdminEmails('an@example.com,not-an-email')).toThrow(
      'Invalid ADMIN_EMAILS entry: not-an-email',
    );
  });
});
