import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { NS, Block, BlockDef, FieldDef } from '../../types/ds';
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
function BlockNode({ block, index, count, ...cb }: NodeCallbacks & { block: Block; index: number; count: number }) {
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
        <EditableLeaf block={block} def={def} {...cb} />
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

const BLOCK_LEVEL_FIELDS = new Set(['children', 'body', 'html', 'content']);
const LEAF_BLOCKVIEW_TYPES = new Set(['titulo', 'prose']);
const NON_EDITABLE_TEXT_KEYS = new Set([
  'url',
  'href',
  'link',
  'linkHref',
  'src',
  'slot',
  'imageSlot',
  'beforeSlot',
  'afterSlot',
  'color',
  'icon',
  'kickerIcon',
  'provider',
  'licenseKind',
]);

const FIELD_PLACEHOLDERS: Record<string, string> = {
  title: 'Título',
  heading: 'Subtítulo',
  caption: 'Legenda',
  credit: 'Crédito (opcional)',
  byline: 'Autoria',
  kicker: 'Sobrelinha',
  cite: 'Fonte',
  text: 'Texto',
  children: 'Conteúdo',
  body: 'Corpo',
  html: 'Texto',
  term: 'Termo',
  definition: 'Definição',
  org: 'Identidade',
  program: 'Nome do programa',
};

function editableContainerProps(block: Block, def: BlockDef, cb: NodeCallbacks) {
  const fields = def.fields || [];
  if (!fields.length) return block.props;

  const props: Record<string, unknown> = { ...block.props };
  fields.forEach((key) => {
    const inline = !BLOCK_LEVEL_FIELDS.has(key);
    props[key] = (
      <cb.ns.Editable
        key={key}
        html={typeof block.props[key] === 'string' ? block.props[key] as string : ''}
        single={inline}
        as={inline ? 'span' : 'div'}
        placeholder={FIELD_PLACEHOLDERS[key] || key}
        onChange={(html) => cb.onInlineEdit(block, { [key]: html })}
      />
    );
  });

  return props;
}

function replaceAtPath(value: unknown, path: Array<string | number>, nextValue: unknown): unknown {
  if (path.length === 0) return nextValue;
  const [head, ...rest] = path;

  if (Array.isArray(value)) {
    const copy = value.slice();
    copy[Number(head)] = replaceAtPath(copy[Number(head)], rest, nextValue);
    return copy;
  }

  if (value && typeof value === 'object') {
    return {
      ...(value as Record<string, unknown>),
      [head]: replaceAtPath((value as Record<string, unknown>)[head as string], rest, nextValue),
    };
  }

  if (typeof head === 'number') {
    const copy: unknown[] = [];
    copy[head] = replaceAtPath(undefined, rest, nextValue);
    return copy;
  }

  return { [head]: replaceAtPath(undefined, rest, nextValue) };
}

function isEditableTextField(field: FieldDef) {
  if (field.type !== 'rich' && field.type !== 'text') return false;
  if (NON_EDITABLE_TEXT_KEYS.has(field.key)) return false;
  if (/url|href|slot/i.test(field.key)) return false;
  return true;
}

function editableTextValue(
  value: unknown,
  field: FieldDef,
  block: Block,
  cb: NodeCallbacks,
  rootKey: string,
  path: Array<string | number>,
) {
  const inline = field.inline ?? !BLOCK_LEVEL_FIELDS.has(field.key);
  return (
    <cb.ns.Editable
      html={typeof value === 'string' ? value : ''}
      single={inline}
      as={inline ? 'span' : 'div'}
      placeholder={field.label || FIELD_PLACEHOLDERS[field.key] || field.key || 'Texto'}
      onChange={(html) => cb.onInlineEdit(block, { [rootKey]: replaceAtPath(block.props[rootKey], path, html) })}
    />
  );
}

function editableValueForField(
  value: unknown,
  field: FieldDef,
  block: Block,
  cb: NodeCallbacks,
  rootKey: string,
  path: Array<string | number>,
): unknown {
  if (isEditableTextField(field)) {
    return editableTextValue(value, field, block, cb, rootKey, path);
  }

  if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    return editableObjectValue(value as Record<string, unknown>, field.fields || [], block, cb, rootKey, path);
  }

  if (field.type === 'list' && Array.isArray(value)) {
    return value.map((item, index) => editableItemValue(item, field.itemFields || [], block, cb, rootKey, [...path, index]));
  }

  return value;
}

function editableItemValue(
  item: unknown,
  fields: FieldDef[],
  block: Block,
  cb: NodeCallbacks,
  rootKey: string,
  path: Array<string | number>,
): unknown {
  if (fields.length === 1 && fields[0].key === '') {
    return editableValueForField(item, fields[0], block, cb, rootKey, path);
  }

  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  return editableObjectValue(item as Record<string, unknown>, fields, block, cb, rootKey, path);
}

function editableObjectValue(
  value: Record<string, unknown>,
  fields: FieldDef[],
  block: Block,
  cb: NodeCallbacks,
  rootKey: string,
  path: Array<string | number>,
) {
  const next: Record<string, unknown> = { ...value };
  fields.forEach((field) => {
    if (!field.key) return;
    next[field.key] = editableValueForField(value[field.key], field, block, cb, rootKey, [...path, field.key]);
  });
  return next;
}

function editableLeafProps(block: Block, def: BlockDef, cb: NodeCallbacks) {
  const props: Record<string, unknown> = { ...block.props };

  (def.fields || []).forEach((key) => {
    props[key] = (
      <cb.ns.Editable
        key={key}
        html={typeof block.props[key] === 'string' ? block.props[key] as string : ''}
        single={!BLOCK_LEVEL_FIELDS.has(key)}
        as={BLOCK_LEVEL_FIELDS.has(key) ? 'div' : 'span'}
        placeholder={FIELD_PLACEHOLDERS[key] || key}
        onChange={(html) => cb.onInlineEdit(block, { [key]: html })}
      />
    );
  });

  if (def.itemsKey && def.itemFields && Array.isArray(block.props[def.itemsKey])) {
    props[def.itemsKey] = (block.props[def.itemsKey] as unknown[]).map((item, index) => (
      editableItemValue(item, def.itemFields || [], block, cb, def.itemsKey as string, [index])
    ));
  }

  (def.propFields || []).forEach((field) => {
    if (!field.key || props[field.key] === undefined) return;
    props[field.key] = editableValueForField(block.props[field.key], field, block, cb, field.key, []);
  });

  return props;
}

function EditableLeaf({ block, def, ...cb }: NodeCallbacks & { block: Block; def?: BlockDef }) {
  const { ns } = cb;
  if (!def || !def.component || LEAF_BLOCKVIEW_TYPES.has(block.type)) {
    return <ns.BlockView block={block} mode="edit" onEdit={cb.onInlineEdit} />;
  }

  if (block.type === 'figure') {
    return <EditableFigure block={block} {...cb} />;
  }

  const Comp = ns[def.component] as React.ComponentType<Record<string, unknown>> | undefined;
  if (!Comp) return <ns.BlockView block={block} mode="edit" onEdit={cb.onInlineEdit} />;

  return React.createElement(Comp, editableLeafProps(block, def, cb));
}

function EditableFigure({ block, ...cb }: NodeCallbacks & { block: Block }) {
  const { ns } = cb;
  const props = block.props || {};
  const sizeAliases: Record<string, string> = {
    small: 'sm',
    pequena: 'sm',
    medium: 'md',
    medio: 'md',
    media: 'md',
    large: 'lg',
    wide: 'lg',
    ampla: 'lg',
    total: 'full',
  };
  const size = sizeAliases[String(props.size || 'md')] || String(props.size || 'md');
  const slot = typeof props.slot === 'string' ? props.slot : '';
  const src = typeof props.src === 'string' ? props.src : '';
  const fit = typeof props.fit === 'string' ? props.fit : 'contain';
  const imageTitleKey = Object.prototype.hasOwnProperty.call(props, 'title') ? 'title' : 'label';
  const hasMeta = props.title || props.caption || props.credit || props.label;

  const field = (key: string, placeholder: string) => (
    <ns.Editable
      html={typeof props[key] === 'string' ? props[key] as string : ''}
      single
      as="span"
      placeholder={placeholder}
      onChange={(html) => cb.onInlineEdit(block, { [key]: html })}
    />
  );

  return (
    <figure className={`spu-figure spu-figure--${size} ${hasMeta && slot ? 'spu-figure--framed' : ''}`}>
      <div className="spu-figure__frame" style={{ cursor: 'default' }}>
        {slot ? (
          React.createElement('image-slot', {
            id: slot,
            shape: 'rect',
            fit,
            placeholder: 'Arraste uma imagem',
            style: { width: '100%', height: 300, display: 'block' },
          })
        ) : src ? (
          <img src={src} alt={typeof props.alt === 'string' ? props.alt : ''} />
        ) : (
          <div className="spu-ph">
            <ns.Icon name="building" size={30} />
            <span className="spu-ph__label">Imagem</span>
          </div>
        )}
      </div>
      <figcaption className="spu-figure__cap">
        <span className="spu-figure__title">{field(imageTitleKey, 'Título da imagem')}</span>
        {field('caption', 'Legenda')}
        <span className="spu-figure__credit">{field('credit', 'Crédito (opcional)')}</span>
      </figcaption>
    </figure>
  );
}

function ContainerBody({ block, def, ...cb }: NodeCallbacks & { block: Block; def: BlockDef }) {
  const { ns } = cb;
  const children: Block[] = (block.children as Block[]) || [];
  const childTypes: string[] = ns.BlockRegistry.childTypes;
  const isStack = (def as { stack?: boolean }).stack !== false;
  const Comp = ns[def.component as string] as React.ComponentType<Record<string, unknown>>;
  const componentProps = editableContainerProps(block, def, cb);
  const { children: _childrenProp, ...componentPropsWithoutChildren } = componentProps;

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
          <BlockNode block={c} index={i} count={children.length} {...cb} />
        </React.Fragment>
      ))}
      {cb.dropTarget?.parentId === block.id && cb.dropTarget.index === children.length && <DropIndicator />}
    </SortableContext>
  );

  // Stack (Section): filhos num flex-column com gap do DS, dentro de um wrapper
  // droppable. Grid (Columns): filhos vão direto como células; droppable no wrapper.
  const inner = isStack
    ? <div ref={dropRef} className={styles.stack + (isOver ? ` ${styles.dropOver}` : '')}>{nodes}</div>
    : <div ref={dropRef} className={isOver ? styles.dropOver : undefined}>{React.createElement(Comp, componentPropsWithoutChildren, nodes)}</div>;

  // Para stack, o componente (Section) envolve o stack; para grid já está montado.
  return isStack
    ? React.createElement(Comp, componentPropsWithoutChildren, inner)
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
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <ns.MarkToolbar />
      </div>
    </main>
  );
}
