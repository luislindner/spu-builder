import React from 'react';
import type { BlockDef, NS } from '../types/ds';

type CompatNS = NS & {
  CollapsibleSection?: React.ComponentType<Record<string, unknown>>;
  injectCss?: (id: string, css: string) => void;
  isPrint?: () => boolean;
  renderRich?: (value: unknown, options?: { inline?: boolean }) => React.ReactNode;
};

const COLLAPSIBLE_SECTION_CSS = `
.spu-csection__intro{max-width:var(--measure);margin-bottom:var(--space-5)}
.spu-csection__title{margin:0;font-family:var(--font-display);font-size:var(--fs-h2);line-height:1.08;letter-spacing:var(--ls-heading);color:var(--text-strong)}
.spu-csection__lead{margin-top:var(--space-3);color:var(--text-muted);font-size:var(--fs-body-lg);line-height:var(--lh-relaxed)}
.spu-csection__lead>:last-child{margin-bottom:0}
.spu-csection__details{border-top:1px solid var(--color-divider);padding-top:var(--space-4)}
.spu-csection__summary{display:inline-flex;align-items:center;gap:var(--space-2);padding:.68em .95em;border:1px solid var(--color-primary);border-radius:var(--radius);color:var(--color-primary-strong);background:transparent;font-family:var(--font-display);font-weight:700;cursor:pointer;list-style:none;transition:background var(--dur-fast),color var(--dur-fast)}
.spu-csection__summary::-webkit-details-marker{display:none}
.spu-csection__summary:hover{background:var(--color-primary-soft)}
.spu-csection__summary svg{transition:transform var(--dur) var(--ease-out)}
.spu-csection__details[open]>.spu-csection__summary svg{transform:rotate(180deg)}
.spu-csection__body{margin-top:var(--space-6)}
.spu-section--dark .spu-csection__summary{border-color:var(--text-on-dark);color:var(--text-on-dark)}
.spu-section--dark .spu-csection__summary:hover{background:rgba(255,255,255,.1)}
@media print{.spu-csection__details>.spu-csection__body{display:block!important}.spu-csection__summary{display:none!important}}
`;

export function installCollapsibleSection(ns: NS) {
  const target = ns as CompatNS;
  const registry = target.BlockRegistry;
  if (!registry || registry.byType.collapsiblesection) return;

  target.injectCss?.('spu-collapsible-section-css', COLLAPSIBLE_SECTION_CSS);

  function rich(value: unknown, inline = false) {
    return target.renderRich ? target.renderRich(value, { inline }) : value as React.ReactNode;
  }

  function CollapsibleSection(props: Record<string, unknown>) {
    const {
      title,
      lead,
      triggerLabel = 'Clique para expandir',
      defaultOpen = false,
      width = 'content',
      surface = 'none',
      pad = 'lg',
      children,
      className,
      __builderEditing = false,
      ...rest
    } = props;
    const printing = target.isPrint?.() === true;
    const forcedOpen = printing || __builderEditing === true;
    const [open, setOpen] = React.useState(Boolean(defaultOpen));
    const Section = target.Section as React.ComponentType<Record<string, unknown>>;
    const hasTitle = Boolean(title);
    const hasLead = Boolean(lead);

    return React.createElement(Section, {
      ...rest,
      width,
      surface,
      pad,
      className: ['spu-csection', className].filter(Boolean).join(' '),
    }, React.createElement(React.Fragment, null,
      (hasTitle || hasLead) && React.createElement('div', { className: 'spu-csection__intro' },
        hasTitle && React.createElement('h2', { className: 'spu-csection__title' }, rich(title, true)),
        hasLead && React.createElement('div', { className: 'spu-csection__lead' }, rich(lead)),
      ),
      React.createElement('details', {
        className: 'spu-csection__details',
        open: forcedOpen || open,
        onToggle: (event: React.SyntheticEvent<HTMLDetailsElement>) => {
          if (!forcedOpen) setOpen(event.currentTarget.open);
        },
      },
      React.createElement('summary', {
        className: 'spu-csection__summary',
        onClick: (event: React.MouseEvent<HTMLElement>) => {
          if (forcedOpen) event.preventDefault();
        },
      },
        rich(triggerLabel, true),
        React.createElement(target.Icon, { name: 'chevron-down', size: 18 }),
      ),
      React.createElement('div', { className: 'spu-csection__body' }, children as React.ReactNode)),
    ));
  }

  target.CollapsibleSection = CollapsibleSection;

  const definition: BlockDef = {
    type: 'collapsiblesection',
    component: 'CollapsibleSection',
    label: 'Seção expansível',
    icon: 'chevron-down',
    cat: 'Estrutura',
    kind: 'container',
    fields: ['title', 'lead', 'triggerLabel'],
    props: {
      title: 'Título da seção',
      lead: '<p>Apresente brevemente o conteúdo que poderá ser expandido.</p>',
      triggerLabel: 'Clique para expandir',
      defaultOpen: false,
      width: 'content',
      surface: 'none',
      pad: 'lg',
      children: [],
    },
    propFields: [{
      key: 'defaultOpen',
      label: 'Iniciar aberta',
      type: 'bool',
    }],
  };

  const sectionIndex = registry.blocks.findIndex((block) => block.type === 'section');
  registry.blocks.splice(sectionIndex >= 0 ? sectionIndex + 1 : registry.blocks.length, 0, definition);
  registry.byType[definition.type] = definition;
  if (!registry.structuralTypes.includes(definition.type)) {
    const structuralIndex = registry.structuralTypes.indexOf('section');
    registry.structuralTypes.splice(structuralIndex >= 0 ? structuralIndex + 1 : registry.structuralTypes.length, 0, definition.type);
  }

  const originalNewBlock = registry.newBlock.bind(registry);
  registry.newBlock = (type, child) => {
    if (type !== definition.type) return originalNewBlock(type, child);
    return {
      id: (child ? 'c' : 'b') + Math.random().toString(36).slice(2, 9),
      type: definition.type,
      props: JSON.parse(JSON.stringify(definition.props)),
    };
  };
}
