import { Component, useReducer, useCallback, useEffect, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import { useDS } from './hooks/useDS';
import {
  docReducer,
  undo,
  redo,
  findBlock,
  findParentBlock,
  findBlockIndex,
  isDescendantOf,
  type DocState,
} from './store/docStore';
import { Library } from './components/Library/Library';
import { Canvas } from './components/Canvas/Canvas';
import { Inspector } from './components/Inspector/Inspector';
import { Toolbar } from './components/Toolbar/Toolbar';
import { PreviewModal } from './components/Preview/PreviewModal';
import { PrintPreviewModal } from './components/PrintPreview/PrintPreviewModal';
import { QualityPanel } from './components/QualityPanel/QualityPanel';
import type { Block } from './types/ds';
import styles from './App.module.css';

const AUTOSAVE_KEY = 'spu_builder_doc';
type DropTarget = { parentId: string | null; index: number };

class AppErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('SPU Builder render error', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
          <h1>Erro ao renderizar o builder</h1>
          <pre>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const ns = useDS();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [printPreviewing, setPrintPreviewing] = useState(false);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const [state, dispatch] = useReducer(docReducer, null, (): DocState => ({
    doc: { schema: 1, meta: { title: 'Rascunho', lang: 'pt-BR' }, blocks: [] },
    past: [], future: [],
  }));

  useEffect(() => {
    if (!ns) return;
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) {
        const doc = ns.BuilderExport.migrate(JSON.parse(saved));
        dispatch({ type: 'SET_DOC', doc });
        return;
      }
    } catch {/* ignore */}
    dispatch({ type: 'SET_DOC', doc: ns.BuilderExport.newDoc({ title: 'Rascunho' }) });
  }, [ns]);

  useEffect(() => {
    if (!ns || !state.doc.schema) return;
    const id = setTimeout(() => {
      localStorage.setItem(AUTOSAVE_KEY, ns.BuilderExport.serialize(state.doc));
    }, 400);
    return () => clearTimeout(id);
  }, [ns, state.doc]);

  // Sincroniza o sumário (meta.toc.items) com os títulos H2 do documento,
  // preservando "hidden" por id. Sumário recolhido renderizado pelo DS.
  useEffect(() => {
    const heads: { id: string; text: string }[] = [];
    const walk = (bs: Block[]) => bs.forEach((b) => {
      if (b.type === 'titulo' && ((b.props.level as string) || 'h2') === 'h2') {
        heads.push({ id: b.id, text: (b.props.text as string) || '' });
      }
      if (b.children) walk(b.children as Block[]);
    });
    walk(state.doc.blocks);
    const toc = state.doc.meta.toc || {};
    const old = toc.items || [];
    const hiddenById = Object.fromEntries(old.map((i) => [i.id, i.hidden]));
    const items = heads.map((h) => ({ id: h.id, text: h.text, hidden: !!hiddenById[h.id] }));
    if (JSON.stringify(items) !== JSON.stringify(old)) {
      dispatch({ type: 'SYNC_META', patch: { toc: { ...toc, items } } });
    }
  }, [state.doc]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const handleUndo = useCallback(() => dispatch({ type: 'SET_DOC', doc: undo(state).doc }), [state]);
  const handleRedo = useCallback(() => dispatch({ type: 'SET_DOC', doc: redo(state).doc }), [state]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Insere um bloco pela biblioteca, respeitando a regra: blocos de conteúdo
  // SEMPRE vivem dentro de uma Section; só os estruturais ficam no nível raiz.
  function insertBlock(type: string) {
    if (!ns) return;
    const structural: string[] = ns.BlockRegistry.structuralTypes;
    const block = ns.BlockRegistry.newBlock(type);
    if (!block) {
      console.error('Bloco desconhecido ou inválido:', type);
      return;
    }

    if (structural.includes(type)) {
      dispatch({ type: 'ADD_TOP', block });
      return;
    }

    // Bloco de conteúdo → precisa de uma Section.
    const blocks = state.doc.blocks;
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'section') {
      dispatch({ type: 'ADD_CHILD', parentId: last.id, block });
    } else {
      const sec = ns.BlockRegistry.newBlock('section');
      if (!sec) {
        console.error('Não foi possível criar seção para o bloco:', type);
        return;
      }
      sec.children = [block];
      if (sec.props) (sec.props as Record<string, unknown>).children = [];
      dispatch({ type: 'ADD_TOP', block: sec });
    }
  }

  function handleDragOver(event: DragOverEvent) {
    setDropTarget(resolveAllowedDropTarget(event));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const target = dropTarget ?? resolveAllowedDropTarget(event);
    setDropTarget(null);
    if (!over || !ns) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const blocks = state.doc.blocks;

    // 1. Drag da biblioteca
    if (activeId.startsWith('lib:')) {
      const type = activeId.slice(4);
      const childTypes: string[] = ns.BlockRegistry.childTypes;
      const structural: string[] = ns.BlockRegistry.structuralTypes;

      if (target?.parentId && childTypes.includes(type)) {
        dispatch({ type: 'ADD_CHILD_AT', parentId: target.parentId, index: target.index, block: ns.BlockRegistry.newBlock(type) });
        return;
      }

      if (!target?.parentId && structural.includes(type)) {
        dispatch({ type: 'ADD_TOP_AT', index: target?.index ?? blocks.length, block: ns.BlockRegistry.newBlock(type) });
        return;
      }

      // Caso contrário → enforcement (conteúdo vai para uma Section)
      insertBlock(type);
      return;
    }

    // 2. Mover bloco existente para qualquer container/posição compatível.
    if (activeId !== overId && target) {
      const moving = findBlock(blocks, activeId);
      if (!moving) return;

      const movingDef = ns.BlockRegistry.byType[moving.type];
      const structural: string[] = ns.BlockRegistry.structuralTypes;
      const childTypes: string[] = ns.BlockRegistry.childTypes;
      const canMoveToTop = !target.parentId && structural.includes(moving.type);
      const canMoveToContainer = !!target.parentId && childTypes.includes(moving.type);
      const movingContainerIntoOwnChild = target.parentId ? target.parentId === activeId || isDescendantOf(blocks, target.parentId, activeId) : false;

      if ((movingDef?.kind === 'container' || moving) && !movingContainerIntoOwnChild && (canMoveToTop || canMoveToContainer)) {
        dispatch({ type: 'MOVE_TO', id: activeId, parentId: target.parentId, index: target.index });
      }
    }
  }

  function resolveAllowedDropTarget(event: DragEndEvent | DragOverEvent): DropTarget | null {
    if (!ns) return null;
    const target = resolveDropTarget(event);
    if (!target) return null;

    const activeId = String(event.active.id);
    const structural: string[] = ns.BlockRegistry.structuralTypes;
    const childTypes: string[] = ns.BlockRegistry.childTypes;

    if (activeId.startsWith('lib:')) {
      const type = activeId.slice(4);
      if (target.parentId && childTypes.includes(type)) return target;
      if (!target.parentId && structural.includes(type)) return target;
      return null;
    }

    const moving = findBlock(state.doc.blocks, activeId);
    if (!moving) return null;
    const canMoveToTop = !target.parentId && structural.includes(moving.type);
    const canMoveToContainer = !!target.parentId && childTypes.includes(moving.type);
    const movingContainerIntoOwnChild = target.parentId ? target.parentId === activeId || isDescendantOf(state.doc.blocks, target.parentId, activeId) : false;
    if (movingContainerIntoOwnChild || (!canMoveToTop && !canMoveToContainer)) return null;

    const parent = findParentBlock(state.doc.blocks, activeId);
    const currentParentId = parent?.id ?? null;
    const currentIndex = findBlockIndex(state.doc.blocks, activeId);
    if (currentParentId === target.parentId && (target.index === currentIndex || target.index === currentIndex + 1)) return null;
    return target;
  }

  function resolveDropTarget(event: DragEndEvent | DragOverEvent): DropTarget | null {
    const { active, over } = event;
    if (!over) return null;
    const overId = String(over.id);
    const blocks = state.doc.blocks;

    if (overId === 'canvas') return { parentId: null, index: blocks.length };

    if (overId.startsWith('drop:')) {
      const parentId = overId.slice(5);
      const parent = findBlock(blocks, parentId);
      return { parentId, index: parent?.children?.length ?? 0 };
    }

    const overBlock = findBlock(blocks, overId);
    if (!overBlock) return null;
    const overDef = ns?.BlockRegistry.byType[overBlock.type];
    const overParent = findParentBlock(blocks, overId);

    const overRect = over.rect;
    const activeRect = active.rect.current.translated || active.rect.current.initial;
    const activeCenterY = activeRect ? activeRect.top + activeRect.height / 2 : overRect.top;
    const after = activeCenterY > overRect.top + overRect.height / 2;

    if (overParent) {
      const overIndex = findBlockIndex(blocks, overId);
      return { parentId: overParent.id, index: overIndex + (after ? 1 : 0) };
    }

    if (overDef?.kind === 'container') {
      const activeId = String(active.id);
      const isLibraryContent = activeId.startsWith('lib:') && ns && ns.BlockRegistry.childTypes.includes(activeId.slice(4));
      const activeBlock = !activeId.startsWith('lib:') ? findBlock(blocks, activeId) : null;
      const isExistingContent = activeBlock && ns && ns.BlockRegistry.childTypes.includes(activeBlock.type);
      if (isLibraryContent || isExistingContent) {
        return { parentId: overId, index: overBlock.children?.length ?? 0 };
      }
    }

    const overIndex = findBlockIndex(blocks, overId);
    return { parentId: null, index: overIndex + (after ? 1 : 0) };
  }

  if (!ns) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        Carregando Design System…
      </div>
    );
  }

  const selectedBlock: Block | null = selectedId ? findBlock(state.doc.blocks, selectedId) : null;

  const handleMove = (id: string, dir: 'up' | 'down') => {
    const parent = findParentBlock(state.doc.blocks, id);
    const arr = parent ? (parent.children as Block[]) : state.doc.blocks;
    const from = arr.findIndex(b => b.id === id);
    const to = dir === 'up' ? from - 1 : from + 1;
    if (from !== -1 && to >= 0 && to < arr.length) {
      dispatch({ type: 'MOVE', parentId: parent?.id ?? null, fromIndex: from, toIndex: to });
    }
  };

  const handlePatch = (id: string, patch: Record<string, unknown>) => dispatch({ type: 'PATCH', id, patch });
  const handleInlineEdit = (edited: Block, patch: Record<string, unknown>) => dispatch({ type: 'PATCH', id: edited.id, patch });
  const handleClearDoc = () => {
    if (!ns) return;
    dispatch({ type: 'SET_DOC', doc: ns.BuilderExport.newDoc({ title: state.doc.meta.title || 'Rascunho' }) });
    setSelectedId(null);
  };

  return (
    <AppErrorBoundary>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragOver={handleDragOver}
        onDragCancel={() => setDropTarget(null)}
        onDragEnd={handleDragEnd}
      >
      <div className={styles.root} data-spu-app-shell>
        <Toolbar
          ns={ns}
          doc={state.doc}
          canUndo={state.past.length > 0}
          canRedo={state.future.length > 0}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onTitleChange={(title) => dispatch({ type: 'SET_TITLE', title })}
          onOpenDoc={(d) => { dispatch({ type: 'SET_DOC', doc: d }); setSelectedId(null); }}
          onPreview={() => setPreviewing(true)}
          onPrintPreview={() => setPrintPreviewing(true)}
          onTocChange={(patch) => dispatch({ type: 'SYNC_META', patch })}
          onClearDoc={handleClearDoc}
        />
        <div className={styles.workspace}>
          <Library ns={ns} onAdd={insertBlock} />
          <Canvas
            ns={ns}
            blocks={state.doc.blocks}
            selectedId={selectedId}
            dropTarget={dropTarget}
            onSelect={setSelectedId}
            onRemove={(id) => { dispatch({ type: 'REMOVE', id }); setSelectedId(null); }}
            onDuplicate={(id) => dispatch({ type: 'DUPLICATE', id })}
            onMove={handleMove}
            onInlineEdit={handleInlineEdit}
          />
          <div className={styles.rightRail}>
            <Inspector
              ns={ns}
              block={selectedBlock}
              onPatch={handlePatch}
            />
            <QualityPanel doc={state.doc} />
          </div>
        </div>
      </div>
      {previewing && <PreviewModal ns={ns} doc={state.doc} onClose={() => setPreviewing(false)} />}
      {printPreviewing && <PrintPreviewModal ns={ns} doc={state.doc} onClose={() => setPrintPreviewing(false)} />}
      </DndContext>
    </AppErrorBoundary>
  );
}
