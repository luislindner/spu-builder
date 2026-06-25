import type { Block, Doc } from '../types/ds';

const SLOT_KEY = 'spu_image_slots';

export interface DocIssue {
  id: string;
  blockId?: string;
  level: 'warn' | 'info';
  text: string;
}

type SlotMap = Record<string, { u?: string } | string>;

export function validateDoc(doc: Doc): DocIssue[] {
  const issues: DocIssue[] = [];
  const slots = readSlots();

  if (!stripHtml(doc.meta.title).trim()) {
    issues.push({ id: 'doc-title', level: 'warn', text: 'Informe um titulo para o projeto.' });
  }

  if (!doc.blocks.length) {
    issues.push({ id: 'empty-doc', level: 'info', text: 'A pagina ainda nao tem blocos.' });
  }

  walk(doc.blocks, (block) => {
    const props = block.props || {};

    for (const [key, value] of Object.entries(props)) {
      if ((key === 'slot' || key.endsWith('Slot')) && typeof value === 'string' && value && !slotHasImage(slots, value)) {
        issues.push({
          id: `${block.id}:${key}:slot`,
          blockId: block.id,
          level: 'info',
          text: `Imagem pendente em ${blockLabel(block)}.`,
        });
      }
    }

    if (block.type === 'mediaembed') {
      const url = String(props.url || props.src || '').trim();
      if (!url || url === 'https://') {
        issues.push({ id: `${block.id}:media-url`, blockId: block.id, level: 'warn', text: 'Midia sem URL.' });
      }
    }

    if (block.type === 'quiz') {
      const questions = Array.isArray(props.questions) ? props.questions : [];
      questions.forEach((q, i) => {
        if (!isObj(q)) return;
        const options = Array.isArray(q.options) ? q.options : [];
        if (!options.some((o) => isObj(o) && o.correct === true)) {
          issues.push({
            id: `${block.id}:quiz:${i}`,
            blockId: block.id,
            level: 'warn',
            text: `Questao ${i + 1} do quiz sem alternativa correta.`,
          });
        }
      });
    }

    if (block.type === 'pagefooter') {
      const credits = Array.isArray(props.credits) ? props.credits : [];
      if (!credits.length || credits.every((c) => !isObj(c) || !String(c.name || '').trim() || String(c.name || '').trim() === '—')) {
        issues.push({ id: `${block.id}:credits`, blockId: block.id, level: 'info', text: 'Rodape sem creditos preenchidos.' });
      }
    }
  });

  return issues.slice(0, 12);
}

function walk(blocks: Block[], visit: (block: Block) => void) {
  for (const block of blocks) {
    visit(block);
    if (block.children) walk(block.children, visit);
  }
}

function readSlots(): SlotMap {
  try {
    return JSON.parse(localStorage.getItem(SLOT_KEY) || '{}') as SlotMap;
  } catch {
    return {};
  }
}

function slotHasImage(slots: SlotMap, id: string): boolean {
  const value = slots[id];
  if (!value) return false;
  return typeof value === 'string' ? value.length > 0 : !!value.u;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stripHtml(value: unknown): string {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

function blockLabel(block: Block): string {
  const raw = block.type.replace(/[-_]/g, ' ');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
