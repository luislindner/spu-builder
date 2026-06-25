// Monta o "kit" inline para export standalone offline: bundle JS + CSS (com
// @imports resolvidos) + image-slot.js + sidecar de imagens embutido.

const DS_BASE = `${import.meta.env.BASE_URL}ds/`;
const SLOT_FILE = '.image-slots.state.json';
const SLOT_KEY = 'spu_image_slots';

async function fetchText(href: string): Promise<string> {
  const r = await fetch(href);
  if (!r.ok) throw new Error(`Falha ao buscar ${href}`);
  return r.text();
}

// Resolve recursivamente os @import url('relativo') de um CSS, inlinando o
// conteúdo. @imports absolutos (https — ex.: Google Fonts) são mantidos.
async function inlineCss(href: string, seen = new Set<string>()): Promise<string> {
  if (seen.has(href)) return '';
  seen.add(href);
  const dir = href.slice(0, href.lastIndexOf('/') + 1);
  const txt = await fetchText(href);
  const importRe = /@import\s+url\(['"]?([^'")]+)['"]?\)\s*;?/g;
  const matches = [...txt.matchAll(importRe)];
  let out = txt;
  for (const m of matches) {
    const url = m[1];
    if (/^https?:/i.test(url)) continue; // mantém absoluto (fontes)
    const abs = dir + url;
    const sub = await inlineCss(abs, seen);
    out = out.replace(m[0], sub);
  }
  return out;
}

export interface ExportKit {
  bundleJs: string;
  stylesCss: string;
  imageSlotJs: string;
  extraHead: string;
}

export async function buildExportKit(): Promise<ExportKit> {
  const [bundleJs, stylesCss, imageSlotJs] = await Promise.all([
    fetchText(DS_BASE + '_ds_bundle.js'),
    inlineCss(DS_BASE + 'styles.css'),
    fetchText(DS_BASE + 'image-slot.js'),
  ]);

  // Embute o estado dos <image-slot> (data URLs) e intercepta o fetch do
  // sidecar no HTML exportado, para as imagens aparecerem offline (read-only).
  const slots = localStorage.getItem(SLOT_KEY) || '{}';
  const extraHead = `<script>
(function(){
  var DATA = ${slots};
  var f = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function(input, init){
    var u = typeof input === 'string' ? input : (input && input.url) || '';
    if (u && u.indexOf('${SLOT_FILE}') >= 0) {
      return Promise.resolve(new Response(JSON.stringify(DATA), { headers: { 'Content-Type': 'application/json' } }));
    }
    return f ? f(input, init) : Promise.reject(new Error('no fetch'));
  };
})();
</script>`;

  return { bundleJs, stylesCss, imageSlotJs, extraHead };
}
