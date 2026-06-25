import React from 'react';
import type { NS } from '../types/ds';

type Component = React.ComponentType<Record<string, unknown>>;

function renderRichInline(ns: NS, value: unknown) {
  if (typeof value !== 'string') return value;
  if (!/[<&]/.test(value)) return value;
  const RichText = ns.RichText as React.ComponentType<Record<string, unknown>>;
  return React.createElement(RichText, { html: value, as: 'span', className: 'spu-richtext--inline' });
}

function renderRichBlock(ns: NS, value: unknown) {
  if (typeof value !== 'string') return value;
  if (!/[<&]/.test(value)) return value;
  return React.createElement(ns.RichText, { html: value });
}

export function installDSCompat(ns: NS) {
  const target = ns as NS & { __spuBuilderCompat?: boolean };
  if (!target || target.__spuBuilderCompat) return;

  const registry = ns.BlockRegistry?.byType;
  if (registry?.masthead) registry.masthead.rich = true;
  if (registry?.conclusion) registry.conclusion.rich = true;

  const Masthead = ns.Masthead as Component | undefined;
  if (Masthead) {
    ns.Masthead = ((props: Record<string, unknown>) => React.createElement(Masthead, {
      ...props,
      org: renderRichInline(ns, props.org),
      program: renderRichInline(ns, props.program),
    })) as Component;
  }

  const Conclusion = ns.Conclusion as Component | undefined;
  if (Conclusion) {
    ns.Conclusion = ((props: Record<string, unknown>) => React.createElement(Conclusion, {
      ...props,
      body: renderRichBlock(ns, props.body),
    })) as Component;
  }

  target.__spuBuilderCompat = true;
}
