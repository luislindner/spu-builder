import type { Block } from '../types/ds';

export interface GlossaryNote {
  term: string;
  definition: string;
}

export interface LinkNote {
  label: string;
  href: string;
}

export interface RichNotes {
  glossary: GlossaryNote[];
  links: LinkNote[];
}

function htmlStrings(value: unknown, out: string[]) {
  if (typeof value === 'string' && /<(a|span|mark|p|ul|ol|strong|em|b|i)\b/i.test(value)) {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => htmlStrings(item, out));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) => htmlStrings(item, out));
  }
}

function walkBlocks(blocks: Block[], visit: (block: Block) => void) {
  blocks.forEach((block) => {
    visit(block);
    if (block.children) walkBlocks(block.children, visit);
  });
}

export function collectRichNotes(blocks: Block[]): RichNotes {
  const glossaryByKey = new Map<string, GlossaryNote>();
  const linksByHref = new Map<string, LinkNote>();
  const parser = new DOMParser();

  walkBlocks(blocks, (block) => {
    const fragments: string[] = [];
    htmlStrings(block.props, fragments);

    fragments.forEach((html) => {
      const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');

      doc.querySelectorAll('[data-term]').forEach((node) => {
        const el = node as HTMLElement;
        const term = (el.getAttribute('data-term') || el.textContent || '').trim();
        const definition = (el.getAttribute('title') || el.getAttribute('data-definition') || '').trim();
        if (!term || !definition) return;
        glossaryByKey.set(`${term}::${definition}`, { term, definition });
      });

      doc.querySelectorAll('a[href]').forEach((node) => {
        const el = node as HTMLAnchorElement;
        const href = (el.getAttribute('href') || '').trim();
        if (!href || href.startsWith('#')) return;
        const label = (el.textContent || href).trim();
        linksByHref.set(href, { label, href });
      });
    });
  });

  return {
    glossary: [...glossaryByKey.values()],
    links: [...linksByHref.values()],
  };
}
