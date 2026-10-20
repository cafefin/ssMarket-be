import { TEMPLATE_MAX_LENGTH, TEMPLATE_VARIABLES } from './chat-templates.js';
import type { ChatTemplateType } from './chat-templates.js';

const VARIABLE = /\{\{([A-Za-z]+)\}\}/g;
const UNSAFE = /[<>*_~`]/g;

export interface TemplateCheck {
  problems: string[];
  unknownVariables: string[];
}

/** Removes what could format or mention: < > * _ ~ ` and line breaks. */
export function sanitizeValue(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, ' ').replace(UNSAFE, '').trim();
}

/** Replaces {{name}}; values are sanitized unless their name is in `trusted`. */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
  trusted: ReadonlySet<string> = new Set(),
): string {
  return template.replace(VARIABLE, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) return whole;
    return trusted.has(name) ? value : sanitizeValue(value);
  });
}

export function checkTemplate(
  type: ChatTemplateType,
  template: string,
): TemplateCheck {
  if (template.trim().length === 0) {
    return { problems: ['template is required'], unknownVariables: [] };
  }
  const problems: string[] = [];
  if (template.length > TEMPLATE_MAX_LENGTH) {
    problems.push(`template must be at most ${TEMPLATE_MAX_LENGTH} characters`);
  }
  const allowed = new Set(TEMPLATE_VARIABLES[type]);
  const unknownVariables = [
    ...new Set([...template.matchAll(VARIABLE)].map((match) => match[1])),
  ].filter((name) => !allowed.has(name));
  problems.push(...unknownVariables.map((name) => `unknown variable: ${name}`));
  return { problems, unknownVariables };
}
