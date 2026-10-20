import { DEFAULT_TEMPLATES, CHAT_TEMPLATE_TYPES } from './chat-templates.js';
import {
  checkTemplate,
  renderTemplate,
  sanitizeValue,
} from './template-renderer.js';

describe('renderTemplate', () => {
  it('replaces every occurrence', () => {
    expect(renderTemplate('Hi {{a}} {{a}}', { a: 'X' })).toBe('Hi X X');
  });

  it('sanitizes values', () => {
    expect(
      renderTemplate('{{a}}', { a: '<users/all> *đậm* _x_ ~y~ `z`\nnext' }),
    ).toBe('users/all đậm x y z next');
    expect(sanitizeValue('a\r\n  b')).toBe('a b');
  });

  it('inserts trusted values as is', () => {
    expect(
      renderTemplate('{{items}}', { items: '• a\n• b' }, new Set(['items'])),
    ).toBe('• a\n• b');
  });

  it('leaves spaced and unknown placeholders as text', () => {
    expect(renderTemplate('{{ a }} {{b}}', { a: 'X' })).toBe('{{ a }} {{b}}');
  });
});

describe('checkTemplate', () => {
  it('requires text', () => {
    expect(checkTemplate('campaign.opened', '')).toEqual({
      problems: ['template is required'],
      unknownVariables: [],
    });
    expect(checkTemplate('campaign.opened', '  \n ').problems).toEqual([
      'template is required',
    ]);
  });

  it('limits the length', () => {
    expect(checkTemplate('campaign.opened', 'a'.repeat(1001)).problems).toEqual([
      'template must be at most 1000 characters',
    ]);
  });

  it('reports unknown variables once', () => {
    expect(
      checkTemplate('campaign.opened', '{{sellerName}} {{price}} {{foo}} {{foo}}'),
    ).toEqual({
      problems: ['unknown variable: price', 'unknown variable: foo'],
      unknownVariables: ['price', 'foo'],
    });
  });

  it('does not treat {{ sellerName }} as a variable', () => {
    expect(checkTemplate('campaign.opened', '{{ nope }}').problems).toEqual([]);
  });

  it.each(CHAT_TEMPLATE_TYPES)('accepts the default for %s', (type) => {
    expect(checkTemplate(type, DEFAULT_TEMPLATES[type]).problems).toEqual([]);
  });
});
