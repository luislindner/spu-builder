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
