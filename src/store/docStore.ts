import { produce } from 'immer';
import type { Doc, Block } from '../types/ds';

// Ações id-based: operam em qualquer profundidade da árvore de blocos.
export type DocAction =
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_DOC'; doc: Doc }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'ADD_TOP'; block: Block }                         // bloco no nível raiz
  | { type: 'ADD_TOP_AT'; block: Block; index: number }
  | { type: 'ADD_CHILD'; parentId: string; block: Block }     // dentro de um container
  | { type: 'ADD_CHILD_AT'; parentId: string; block: Block; index: number }
  | { type: 'PATCH'; id: string; patch: Record<string, unknown> }
  | { type: 'REMOVE'; id: string }
  | { type: 'DUPLICATE'; id: string }
  | { type: 'MOVE'; parentId: string | null; fromIndex: number; toIndex: number }
  | { type: 'MOVE_TO'; id: string; parentId: string | null; index: number }
  | { type: 'SYNC'; id: string; patch: Record<string, unknown> } // atualiza bloco sem histórico
  | { type: 'SYNC_META'; patch: Record<string, unknown> };        // atualiza meta sem histórico (ex.: sumário)

export interface DocState {
  doc: Doc;
  past: Doc[];
  future: Doc[];
}

// ── Walkers de árvore ──────────────────────────────────────────────────────
export function findBlock(blocks: Block[], id: string): Block | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children) {
      const f = findBlock(b.children, id);
      if (f) return f;
    }
  }
  return null;
}

// Array que contém o id (para splice/reorder) + o índice.
function findParentArray(blocks: Block[], id: string): { arr: Block[]; index: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === id) return { arr: blocks, index: i };
    const kids = blocks[i].children;
    if (kids) {
      const f = findParentArray(kids, id);
      if (f) return f;
    }
  }
  return null;
}

// Container pai de um id (null se for top-level).
export function findParentBlock(blocks: Block[], id: string): Block | null {
  for (const b of blocks) {
    if (b.children?.some(c => c.id === id)) return b;
    if (b.children) {
      const f = findParentBlock(b.children, id);
      if (f) return f;
    }
  }
  return null;
}

export function findBlockIndex(blocks: Block[], id: string): number {
  const parent = findParentBlock(blocks, id);
  const arr = parent ? parent.children || [] : blocks;
  return arr.findIndex((b) => b.id === id);
}

export function isDescendantOf(blocks: Block[], id: string, possibleAncestorId: string): boolean {
  const parent = findParentBlock(blocks, id);
  if (!parent) return false;
  if (parent.id === possibleAncestorId) return true;
  return isDescendantOf(blocks, parent.id, possibleAncestorId);
}

export function docReducer(state: DocState, action: DocAction): DocState {
  if (action.type === 'UNDO') return undo(state);
  if (action.type === 'REDO') return redo(state);

  if (action.type === 'SET_DOC') {
    const doc = { ...action.doc, blocks: (action.doc.blocks || []).map(b => normalizeContainer(b)) };
    return { doc, past: [], future: [] };
  }

  // Atualização sem histórico (sumário auto-sincronizado).
  if (action.type === 'SYNC') {
    const doc = produce(state.doc, (draft) => {
      const b = findBlock(draft.blocks as Block[], action.id);
      if (b) Object.assign(b.props, action.patch);
    });
    return { ...state, doc };
  }

  if (action.type === 'SYNC_META') {
    const doc = produce(state.doc, (draft) => {
      Object.assign(draft.meta, action.patch);
    });
    return { ...state, doc };
  }

  const snapshot = state.doc;

  const nextDoc = produce(state.doc, (draft) => {
    const blocks = draft.blocks as Block[];

    switch (action.type) {
      case 'SET_TITLE':
        draft.meta.title = action.title;
        break;

      case 'ADD_TOP':
        blocks.push(prepare(action.block) as never);
        break;

      case 'ADD_TOP_AT':
        blocks.splice(clampIndex(action.index, blocks.length), 0, prepare(action.block) as never);
        break;

      case 'ADD_CHILD': {
        const parent = findBlock(blocks, action.parentId);
        if (parent) {
          if (!parent.children) parent.children = [];
          parent.children.push(prepare(action.block) as never);
        }
        break;
      }

      case 'ADD_CHILD_AT': {
        const parent = findBlock(blocks, action.parentId);
        if (parent) {
          if (!parent.children) parent.children = [];
          parent.children.splice(clampIndex(action.index, parent.children.length), 0, prepare(action.block) as never);
        }
        break;
      }

      case 'PATCH': {
        const b = findBlock(blocks, action.id);
        if (b) Object.assign(b.props, action.patch);
        break;
      }

      case 'REMOVE': {
        const found = findParentArray(blocks, action.id);
        if (found) found.arr.splice(found.index, 1);
        break;
      }

      case 'DUPLICATE': {
        const found = findParentArray(blocks, action.id);
        if (found) {
          const clone = JSON.parse(JSON.stringify(found.arr[found.index])) as Block;
          reassignIds(clone);
          reassignSlots(clone);
          found.arr.splice(found.index + 1, 0, clone as never);
        }
        break;
      }

      case 'MOVE': {
        const arr = action.parentId
          ? findBlock(blocks, action.parentId)?.children
          : blocks;
        if (arr) {
          const [m] = arr.splice(action.fromIndex, 1);
          arr.splice(action.toIndex, 0, m);
        }
        break;
      }

      case 'MOVE_TO': {
        const found = findParentArray(blocks, action.id);
        if (!found) break;
        const [moving] = found.arr.splice(found.index, 1);
        const targetArr = action.parentId ? findBlock(blocks, action.parentId)?.children : blocks;
        if (!targetArr) {
          found.arr.splice(found.index, 0, moving);
          break;
        }
        const sameArray = found.arr === targetArr;
        const rawIndex = sameArray && found.index < action.index ? action.index - 1 : action.index;
        targetArr.splice(clampIndex(rawIndex, targetArr.length), 0, moving);
        break;
      }
    }
  });

  return {
    doc: nextDoc,
    past: [...state.past, snapshot].slice(-50),
    future: [],
  };
}

export function undo(state: DocState): DocState {
  if (!state.past.length) return state;
  const prev = state.past[state.past.length - 1];
  return { doc: prev, past: state.past.slice(0, -1), future: [state.doc, ...state.future] };
}

export function redo(state: DocState): DocState {
  if (!state.future.length) return state;
  const next = state.future[0];
  return { doc: next, past: [...state.past, state.doc], future: state.future.slice(1) };
}

// ── Preparação de blocos novos ─────────────────────────────────────────────

// newBlock('section') coloca os filhos-padrão em props.children, mas o BlockView
// e o builder usam block.children. Normaliza: hoist props.children → block.children.
function normalizeContainer(block: Block): Block {
  const props = { ...(block.props || {}) };
  const normalized: Block = { ...block, props };

  const nestedChildren = Array.isArray(props.children);
  if (normalized.children == null && nestedChildren) {
    normalized.children = props.children as Block[];
  }
  if (nestedChildren) delete (props as Record<string, unknown>).children;
  applyBuilderDefaults(normalized);
  if (normalized.children) normalized.children = normalized.children.map(normalizeContainer);
  return normalized;
}

function applyBuilderDefaults(block: Block): Block {
  if (!block.props) block.props = {};
  if (block.type === 'figure' && typeof block.props.size === 'string') {
    block.props.size = normalizeFigureSize(block.props.size);
  }
  if (block.type === 'pagefooter' && block.props.licenseKind === undefined) {
    block.props.licenseKind = 'byncsa';
  }
  if (block.type === 'bleedimage' && block.props.zoom === undefined) {
    block.props.zoom = false;
  }
  return block;
}

function normalizeFigureSize(size: string): string {
  const aliases: Record<string, string> = {
    small: 'sm',
    pequena: 'sm',
    medio: 'md',
    média: 'md',
    media: 'md',
    medium: 'md',
    large: 'lg',
    wide: 'lg',
    ampla: 'lg',
    total: 'full',
  };
  return aliases[size.toLowerCase()] || size;
}

function prepare(block: Block): Block {
  return assignSlots(normalizeContainer(block));
}

// Atribui ids de slot estáveis aos campos de imagem vazios (slot/*Slot).
function assignSlots(block: Block): Block {
  visitSlotProps(block.props || {}, block.id, [], false);
  if (block.children) block.children.forEach(assignSlots);
  return block;
}

// Reatribui ids novos a um bloco clonado (e filhos) — evita ids duplicados.
function reassignIds(block: Block): Block {
  block.id = uid();
  if (block.children) block.children.forEach(reassignIds);
  return block;
}

// Reatribui ids de slot novos (usado ao duplicar, para não compartilhar imagem).
function reassignSlots(block: Block): Block {
  visitSlotProps(block.props || {}, block.id, [], true);
  if (block.children) block.children.forEach(reassignSlots);
  return block;
}

// Percorre também listas/objetos internos (slides, itens de accordion e marcos
// da timeline). O caminho faz cada imagem do mesmo bloco receber um id único.
function visitSlotProps(value: unknown, blockId: string, path: Array<string | number>, replace: boolean): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitSlotProps(item, blockId, [...path, index], replace));
    return;
  }
  if (!value || typeof value !== 'object') return;

  const object = value as Record<string, unknown>;
  Object.keys(object).forEach((key) => {
    const current = object[key];
    const isSlot = key === 'slot' || key.endsWith('Slot');
    if (isSlot && typeof current === 'string' && (replace || current === '')) {
      const suffix = [...path, key].join('_');
      object[key] = `${blockId}__${suffix}`;
      return;
    }
    visitSlotProps(current, blockId, [...path, key], replace);
  });
}

function uid() {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(length, index));
}
