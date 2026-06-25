import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { NS, Block, BlockDef } from '../../types/ds';
import styles from './Canvas.module.css';

export interface DropTarget {
  parentId: string | null;
  index: number;
}

interface NodeCallbacks {
  ns: NS;
  selectedId: string | null;
  dropTarget: DropTarget | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
  onInlineEdit: (block: Block, patch: Record<string, unknown>) => void;
}

// Um nó da árvore: container (Section/Columns via componente real do DS) ou
// folha (BlockView mode="edit"). Recursivo → containers podem aninhar.
function BlockNode({ block, index, count, parentId, ...cb }: NodeCallbacks & { block: Block; index: number; count: number; parentId: string | null }) {
  const { ns, selectedId } = cb;
  const def: BlockDef | undefined = ns.BlockRegistry.byType[block.type];
  const isContainer = def?.kind === 'container';
  const isSelected = selectedId === block.id;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const handles = (label?: string) => isSelected && (
    <div className={styles.handles}>
      {label && <span className={styles.tag}>{label}</span>}
      <button className={styles.handle} onClick={(e) => { e.stopPropagation(); cb.onMove(block.id, 'up'); }} disabled={index === 0} title="Mover para cima">↑</button>
      <button className={styles.handle} onClick={(e) => { e.stopPropagation(); cb.onMove(block.id, 'down'); }} disabled={index === count - 1} title="Mover para baixo">↓</button>
      <button className={styles.handle} {...listeners} {...attributes} title="Arrastar">⠿</button>
      <button className={styles.handle} onClick={(e) => { e.stopPropagation(); cb.onDuplicate(block.id); }} title="Duplicar">
        <ns.Icon name="repeat" size={13} />
      </button>
      <button className={styles.handleDanger} onClick={(e) => { e.stopPropagation(); cb.onRemove(block.id); }} title="Remover">
        <ns.Icon name="minus" size={13} />
      </button>
    </div>
  );

  if (isContainer && def) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={styles.containerWrap + (isSelected ? ` ${styles.containerSelected}` : '')}
        onClick={(e) => { e.stopPropagation(); cb.onSelect(block.id); }}
      >
        {handles(def.label)}
        <ContainerBody block={block} def={def} {...cb} />
      </div>
    );
  }

  const isMap = block.type === 'mapfigure';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={styles.leafWrap + (isSelected ? ` ${styles.leafSelected}` : '')}
      onClick={(e) => { e.stopPropagation(); cb.onSelect(block.id); }}
    >
      {handles()}
      <div style={{ position: 'relative' }}>
        <ns.BlockView block={block} mode="edit" onEdit={cb.onInlineEdit} />
        {isMap && isSelected && (
          <HotspotLayer block={block} onPatchMarkers={(markers) => cb.onInlineEdit(block, { markers })} />
        )}
      </div>
    </div>
  );
}

interface Marker { title?: string; description?: string; x?: number; y?: number; label?: string }

// Camada de edição dos marcadores do MapFigure (só com o bloco selecionado):
// clicar no fundo adiciona um marcador na posição %; arrastar um marcador o move.
function HotspotLayer({ block, onPatchMarkers }: { block: Block; onPatchMarkers: (markers: Marker[]) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const markers: Marker[] = (block.props.markers as Marker[]) || [];

  const pctFrom = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const clamp = (n: number) => Math.max(0, Math.min(100, n));
    return { x: Math.round(clamp(((clientX - r.left) / r.width) * 100)), y: Math.round(clamp(((clientY - r.top) / r.height) * 100)) };
  };

  const addMarker = (e: React.MouseEvent) => {
    if (e.target !== ref.current) return; // ignora cliques nos marcadores
    e.stopPropagation();
    const { x, y } = pctFrom(e.clientX, e.clientY);
    onPatchMarkers([...markers, { title: 'Novo ponto', description: '', x, y }]);
  };

  const startDrag = (i: number, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const { x, y } = pctFrom(ev.clientX, ev.clientY);
      onPatchMarkers(markers.map((s, idx) => (idx === i ? { ...s, x, y } : s)));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={ref} className={styles.hotspotLayer} onClick={addMarker}>
      {markers.map((s, i) => (
        <div
          key={i}
          className={styles.hotspotHandle}
          style={{ left: (s.x ?? 50) + '%', top: (s.y ?? 50) + '%' }}
          onPointerDown={(e) => startDrag(i, e)}
          title={`Ponto ${i + 1} — arraste para mover`}
        >
          {i + 1}
        </div>
      ))}
      <div className={styles.hotspotHint}>Clique na imagem para adicionar · arraste os pontos para mover · edite o conteúdo no painel</div>
    </div>
  );
}

// Corpo de um container: renderiza o componente real do DS (faixa/grade) e
// coloca os filhos (cada um um BlockNode) dentro, com drop zone.
function DropIndicator() {
  return (
    <div className={styles.dropIndicator} aria-hidden="true">
      <span />
    </div>
  );
}

function ContainerBody({ block, def, ...cb }: NodeCallbacks & { block: Block; def: BlockDef }) {
  const { ns } = cb;
  const children: Block[] = (block.children as Block[]) || [];
  const childTypes: string[] = ns.BlockRegistry.childTypes;
  const isStack = (def as { stack?: boolean }).stack !== false;
  const Comp = ns[def.component as string] as React.ComponentType<Record<string, unknown>>;

  const { setNodeRef: dropRef, isOver } = useDroppable({ id: `drop:${block.id}` });

  const strategy = isStack ? verticalListSortingStrategy : rectSortingStrategy;

  const nodes = children.length === 0 ? (
    <>
      {cb.dropTarget?.parentId === block.id && cb.dropTarget.index === 0 && <DropIndicator />}
      <div className={styles.emptyDrop}>
        <ns.Icon name="plus" size={16} />
        <span>Arraste um bloco aqui</span>
        <span className={styles.hint}>Aceita: {childTypes.join(', ')}</span>
      </div>
    </>
  ) : (
    <SortableContext items={children.map(c => c.id)} strategy={strategy}>
      {children.map((c, i) => (
        <React.Fragment key={c.id}>
          {cb.dropTarget?.parentId === block.id && cb.dropTarget.index === i && <DropIndicator />}
          <BlockNode block={c} index={i} count={children.length} parentId={block.id} {...cb} />
        </React.Fragment>
      ))}
      {cb.dropTarget?.parentId === block.id && cb.dropTarget.index === children.length && <DropIndicator />}
    </SortableContext>
  );

  // Stack (Section): filhos num flex-column com gap do DS, dentro de um wrapper
  // droppable. Grid (Columns): filhos vão direto como células; droppable no wrapper.
  const inner = isStack
    ? <div ref={dropRef} className={styles.stack + (isOver ? ` ${styles.dropOver}` : '')}>{nodes}</div>
    : <div ref={dropRef} className={isOver ? styles.dropOver : undefined}>{React.createElement(Comp, { ...block.props, children: undefined }, nodes)}</div>;

  // Para stack, o componente (Section) envolve o stack; para grid já está montado.
  return isStack
    ? React.createElement(Comp, { ...block.props, children: undefined }, inner)
    : inner;
}

interface CanvasProps {
  ns: NS;
  blocks: Block[];
  selectedId: string | null;
  dropTarget: DropTarget | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
  onInlineEdit: (block: Block, patch: Record<string, unknown>) => void;
}

export function Canvas({ ns, blocks, selectedId, dropTarget, onSelect, onRemove, onDuplicate, onMove, onInlineEdit }: CanvasProps) {
  const { setNodeRef } = useDroppable({ id: 'canvas' });

  return (
    <main
      ref={setNodeRef}
      className={styles.root}
      data-spu-canvas
      onClick={() => onSelect(null)}
    >
      {blocks.length === 0 && (
        <div className={styles.empty}>
          <ns.Icon name="layers" size={32} />
          <p>Arraste um bloco da biblioteca ou clique nele para inserir.</p>
        </div>
      )}
      <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
        {blocks.map((block, i) => (
          <React.Fragment key={block.id}>
            {dropTarget?.parentId === null && dropTarget.index === i && <DropIndicator />}
            <BlockNode
              block={block}
              index={i}
              count={blocks.length}
              parentId={null}
              ns={ns}
              selectedId={selectedId}
              dropTarget={dropTarget}
              onSelect={onSelect}
              onRemove={onRemove}
              onDuplicate={onDuplicate}
              onMove={onMove}
              onInlineEdit={onInlineEdit}
            />
          </React.Fragment>
        ))}
        {dropTarget?.parentId === null && dropTarget.index === blocks.length && <DropIndicator />}
      </SortableContext>
      <ns.MarkToolbar />
    </main>
  );
}
