export function enhanceGlossaryTerms(root: ParentNode = document) {
  const closeAll = (except?: Element) => {
    document.querySelectorAll('.spu-term-open').forEach((el) => {
      if (el !== except) {
        el.classList.remove('spu-term-open');
        el.setAttribute('aria-expanded', 'false');
      }
    });
  };

  root.querySelectorAll('.spu-richtext [data-term]').forEach((node) => {
    const el = node as HTMLElement;
    if (el.dataset.spuTermReady) return;
    const term = (el.getAttribute('data-term') || el.textContent || '').trim();
    const definition = (el.getAttribute('title') || el.getAttribute('data-definition') || '').trim();
    if (!term || !definition) return;

    el.dataset.spuTermReady = '1';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-expanded', 'false');
    el.removeAttribute('title');

    const pop = document.createElement('span');
    pop.className = 'spu-term-pop';
    pop.setAttribute('role', 'tooltip');

    const title = document.createElement('strong');
    title.textContent = term;
    const body = document.createElement('span');
    body.textContent = definition;
    pop.append(title, body);
    el.appendChild(pop);

    const toggle = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = el.classList.toggle('spu-term-open');
      el.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) closeAll(el);
    };

    el.addEventListener('click', toggle);
    el.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter' || key === ' ') toggle(event);
      if (key === 'Escape') closeAll();
    });
  });

  const onClick = () => closeAll();
  document.addEventListener('click', onClick);
}
