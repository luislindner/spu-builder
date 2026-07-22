type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasContent(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;
}

function copyAlias(props: JsonRecord, target: string, aliases: string[]) {
  if (hasContent(props[target])) return;
  const alias = aliases.find((key) => hasContent(props[key]));
  if (alias) props[target] = props[alias];
}

export function normalizeEditorWhitespace(value: string): string {
  const clean = value.replace(/(?:&nbsp;|\u00a0)/gi, ' ');
  if (!/[<>]/.test(clean)) return clean;

  let html = clean
    .replace(/<div(?:\s[^>]*)?>/gi, '<p>')
    .replace(/<\/div>/gi, '</p>');

  if (!/<(?:p|ul|ol|blockquote|h[1-6])\b/i.test(html) && /(?:<br\s*\/?>\s*){2,}/i.test(html)) {
    html = `<p>${html.replace(/(?:<br\s*\/?>\s*){2,}/gi, '</p><p>')}</p>`;
  }

  if (/<p\b/i.test(html) && !/^\s*<(?:p|ul|ol|blockquote|h[1-6])\b/i.test(html)) {
    html = html.replace(/^([\s\S]*?)(?=<p\b)/i, '<p>$1</p>');
  }

  return html
    .replace(/<p>\s*<p>/gi, '<p>')
    .replace(/<\/p>\s*<\/p>/gi, '</p>')
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, '<p><br></p>');
}

function normalizeStrings(value: unknown): unknown {
  if (typeof value === 'string') return normalizeEditorWhitespace(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => { value[index] = normalizeStrings(item); });
    return value;
  }
  if (isRecord(value)) {
    Object.keys(value).forEach((key) => { value[key] = normalizeStrings(value[key]); });
  }
  return value;
}

function normalizeListItems(block: JsonRecord, props: JsonRecord) {
  if (block.type === 'accordion' && Array.isArray(props.items)) {
    props.items.forEach((value) => {
      if (!isRecord(value)) return;
      copyAlias(value, 'title', ['question', 'heading', 'label']);
      copyAlias(value, 'content', ['answer', 'body', 'description', 'text', 'html']);
    });
  }

  if (block.type === 'timeline' && Array.isArray(props.eras)) {
    props.eras.forEach((value) => {
      if (!isRecord(value)) return;
      copyAlias(value, 'label', ['title', 'name']);
      if (!Array.isArray(value.milestones)) return;
      value.milestones.forEach((milestone) => {
        if (!isRecord(milestone)) return;
        copyAlias(milestone, 'date', ['year', 'period']);
        copyAlias(milestone, 'title', ['heading', 'label', 'name']);
        copyAlias(milestone, 'content', ['description', 'body', 'text', 'html']);
      });
    });
  }
}

/**
 * Aceita nomes de campos usados por versões antigas e por JSONs produzidos
 * fora do builder, antes de o sanitize preencher os valores-padrão do DS.
 */
export function normalizeProjectContent(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;

  normalizeStrings(raw);

  const walk = (blocks: unknown[]) => {
    blocks.forEach((value) => {
      if (!isRecord(value)) return;
      const props = isRecord(value.props) ? value.props : {};
      value.props = props;

      if (value.type === 'kicker') {
        copyAlias(props, 'children', ['text', 'content', 'label', 'title']);
      }

      if (['callout', 'panel', 'examplecard', 'reflexao', 'pullquote'].includes(String(value.type))) {
        copyAlias(props, 'children', ['content', 'body', 'html', 'text', 'description']);
      }

      normalizeListItems(value, props);
      if (Array.isArray(value.children)) walk(value.children);
      if (Array.isArray(props.children)) walk(props.children);
    });
  };

  if (Array.isArray(raw.blocks)) walk(raw.blocks);
  return raw;
}
