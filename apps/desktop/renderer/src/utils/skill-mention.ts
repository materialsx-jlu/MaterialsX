export interface SkillMentionRange {
  start: number;
  end: number;
  query: string;
}

const QUERY_PATTERN = /^[\p{L}\p{N}._-]*$/u;
const EMAIL_PREFIX_PATTERN = /[A-Za-z0-9._-]/;

export function findSkillMention(value: string, caret: number): SkillMentionRange | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > value.length) return null;

  const prefix = value.slice(0, caret);
  const start = prefix.lastIndexOf("@");
  if (start < 0) return null;

  const previous = value[start - 1];
  if (previous && EMAIL_PREFIX_PATTERN.test(previous)) return null;

  const query = prefix.slice(start + 1);
  if (!QUERY_PATTERN.test(query)) return null;

  return { start, end: caret, query };
}

export function applySkillMention(
  value: string,
  mention: SkillMentionRange,
  skillName: string,
): { value: string; caret: number } {
  const suffix = value.slice(mention.end);
  const separator = suffix.length === 0 || !/^\s/u.test(suffix) ? " " : "";
  const replacement = `@${skillName}${separator}`;
  return {
    value: `${value.slice(0, mention.start)}${replacement}${suffix}`,
    caret: mention.start + replacement.length,
  };
}
