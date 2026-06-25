import type { NS } from '../../types/ds';
import { useDraggable } from '@dnd-kit/core';
import styles from './Library.module.css';

// Fallback para ícones que os blocos declaram mas o DS ainda não tem (33 ícones).
// Quando o DS ampliar o set, o ícone real do bloco passa a resolver e o fallback
// é ignorado (a checagem usa ns.ICON_NAMES em runtime).
// Blocos ocultados da biblioteca (não usados).
const HIDDEN_BLOCKS = new Set(['reflexao']);

const ICON_FALLBACK: Record<string, string> = {
  layout: 'maximize', heading: 'file-text', type: 'file-text', grid: 'scale',
  list: 'plus', square: 'target', flower: 'sparkles', image: 'maximize',
  'book-marked': 'book-open', 'check-circle': 'check', 'help-circle': 'check',
};

interface Props {
  ns: NS;
  onAdd: (type: string) => void;
}

function DraggableBlock({ ns, type, label, icon, avail, onAdd }: { ns: NS; type: string; label: string; icon: string; avail: Set<string>; onAdd: (type: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `lib:${type}`, data: { source: 'library', type } });
  const iconName = avail.has(icon) ? icon : (ICON_FALLBACK[icon] || 'file-text');

  return (
    <button
      ref={setNodeRef}
      className={styles.block + (isDragging ? ` ${styles.dragging}` : '')}
      onClick={() => onAdd(type)}
      {...listeners}
      {...attributes}
      title={`Inserir ${label}`}
    >
      <ns.Icon name={iconName} size={15} />
      <span>{label}</span>
    </button>
  );
}

export function Library({ ns, onAdd }: Props) {
  const { BlockRegistry } = ns;
  const avail = new Set(ns.ICON_NAMES || []);

  return (
    <aside className={styles.root}>
      <div className={styles.heading}>Biblioteca</div>
      {BlockRegistry.cats.map(cat => (
        <div key={cat}>
          <div className={styles.cat}>{cat}</div>
          {BlockRegistry.blocks.filter(b => b.cat === cat && !HIDDEN_BLOCKS.has(b.type)).map(b => (
            <DraggableBlock
              key={b.type}
              ns={ns}
              type={b.type}
              label={b.label}
              icon={b.icon}
              avail={avail}
              onAdd={onAdd}
            />
          ))}
        </div>
      ))}
    </aside>
  );
}
