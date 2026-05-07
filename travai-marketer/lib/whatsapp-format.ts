/**
 * Convert generic Markdown-ish AI output into WhatsApp-supported formatting.
 *
 * WhatsApp supports:
 * - *bold*
 * - _italic_
 * - ~strikethrough~
 * - ```code block```
 * - `inline code`
 * - Bulleted lists with * or -
 * - Numbered lists with 1. / 2.
 * - Quotes with > prefix
 */
export function normalizeToWhatsAppMarkdown(input: string): string {
  if (!input) return '';

  let text = input.replace(/\r\n/g, '\n');

  // Normalize fenced code blocks: ```lang\n...\n``` -> ```\n...\n```
  text = text.replace(/```[a-zA-Z0-9_-]+\n([\s\S]*?)```/g, (_, body: string) => {
    return `\`\`\`\n${body}\`\`\``;
  });

  // Headings are not supported by WhatsApp. Convert to bold lines.
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_, heading: string) => `*${heading.trim()}*`);

  // Horizontal rules are not supported. Use em dash separator.
  text = text.replace(/^(\*{3,}|-{3,}|_{3,})$/gm, '—');

  // Convert markdown bold to WhatsApp bold.
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '*$1*');
  text = text.replace(/__([^_\n]+)__/g, '*$1*');

  // Convert markdown strikethrough to WhatsApp strikethrough.
  text = text.replace(/~~([^~\n]+)~~/g, '~$1~');

  // Remove odd leading dots before bullets (common LLM artifact): ". *Item" -> "* Item"
  text = text.replace(/^\.\s+([*-])\s*/gm, '$1 ');

  // Normalize bullet markers to WhatsApp-friendly "* ".
  text = text.replace(/^[-•]\s+/gm, '* ');

  // Clean excessive spacing.
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

