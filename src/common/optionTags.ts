export type ParsedOptionTag = {
  kind: 'option' | 'battle-option';
  text: string;
};

export function hasOptionTagMarkup(raw: string): boolean {
  return /<(?:Option|BattleOption|Options)\b/i.test(raw);
}

/** Parse AI option tags after HTML/template normalization has changed tag casing. */
export function parseOptionTags(raw: string): ParsedOptionTag[] {
  const options: ParsedOptionTag[] = [];
  const optionTagPattern = /<(Option|BattleOption)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let match: RegExpExecArray | null;

  while ((match = optionTagPattern.exec(raw)) !== null) {
    const text = match[2].trim();
    if (!text) continue;
    options.push({
      kind: match[1].toLowerCase() === 'battleoption' ? 'battle-option' : 'option',
      text,
    });
  }

  return options;
}
