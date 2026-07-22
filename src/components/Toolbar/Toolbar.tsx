import { useRef, useState } from 'react';
import type { NS, Doc } from '../../types/ds';
import { exportAssetsZip, exportScormZip, exportSelfContained } from '../../utils/exportFormats';
import { normalizeProjectContent } from '../../utils/projectCompat';
import styles from './Toolbar.module.css';

const SLOT_KEY = 'spu_image_slots';

interface Props {
  ns: NS;
  doc: Doc;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onTitleChange: (title: string) => void;
  onOpenDoc: (doc: Doc) => void;
  onPreview: () => void;
  onPrintPreview: () => void;
  onMetaChange: (patch: Record<string, unknown>) => void;
  onClearDoc: () => void;
}

export function Toolbar({ ns, doc, canUndo, canRedo, onUndo, onRedo, onTitleChange, onOpenDoc, onPreview, onPrintPreview, onMetaChange, onClearDoc }: Props) {
  const { BuilderExport } = ns;
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportLabel, setExportLabel] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const toc = doc.meta.toc || {};
  const tocItems = toc.items || [];
  const tocEnabled = toc.enabled !== false; // default ligado
  const builderCreditEnabled = doc.meta.builderCredit !== false;

  const runExport = async (label: string, fn: (doc: Doc) => Promise<void>) => {
    setExporting(true);
    setExportLabel(label);
    setExportOpen(false);
    try {
      await fn(doc);
    } catch (err) {
      console.error(err);
      alert('Não foi possível exportar. Tente novamente.');
    } finally {
      setExporting(false);
      setExportLabel('');
    }
  };

  const parseProjectFile = (text: string, fileName: string): { raw: unknown; imageSlots?: string } => {
    const looksLikeHtml = /\.html?$/i.test(fileName) || /^\s*</.test(text);
    if (!looksLikeHtml) return { raw: JSON.parse(text) };

    const html = new DOMParser().parseFromString(text, 'text/html');
    const embedded = html.getElementById('spu-doc')?.textContent;
    if (!embedded) {
      throw new Error('HTML sem dados editáveis do SPU Builder.');
    }
    return {
      raw: JSON.parse(embedded),
      imageSlots: html.getElementById('spu-image-slots')?.textContent || undefined,
    };
  };

  const handleOpen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { raw, imageSlots } = parseProjectFile(String(reader.result), file.name);
        const migrated = BuilderExport.migrate(normalizeProjectContent(raw));
        const safe = BuilderExport.sanitize ? BuilderExport.sanitize(migrated) : migrated;
        if (imageSlots) localStorage.setItem(SLOT_KEY, imageSlots);
        onOpenDoc(safe);
      } catch (err) {
        console.error('Arquivo de projeto inválido', err);
        alert('Não foi possível abrir: arquivo inválido ou sem dados editáveis.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDownloadBeforeClear = () => {
    BuilderExport.saveProject(doc, doc.meta.title);
  };

  const handleConfirmClear = () => {
    setClearOpen(false);
    onClearDoc();
  };

  return (
    <header className={styles.root}>
      <div className={styles.left}>
        <span className={styles.logo}>SPU Builder</span>
        <input
          className={styles.title}
          value={doc.meta.title}
          onChange={(e) => onTitleChange(e.target.value)}
          aria-label="Título do documento"
        />
      </div>
      <div className={styles.actions}>
        <button className={styles.btn} onClick={onUndo} disabled={!canUndo} title="Desfazer (Ctrl+Z)">
          ↩ Desfazer
        </button>
        <button className={styles.btn} onClick={onRedo} disabled={!canRedo} title="Refazer (Ctrl+Y)">
          ↪ Refazer
        </button>
        <div className={styles.sep} />
        <div className={styles.tocWrap}>
          <button className={styles.btn} onClick={() => setTocOpen((o) => !o)} title="Sumário (gerado dos títulos H2)">
            Sumário {tocItems.length > 0 && <span className={styles.tocCount}>{tocItems.filter((i) => !i.hidden).length}</span>}
          </button>
          {tocOpen && (
            <div className={styles.tocPop} onMouseLeave={() => setTocOpen(false)}>
              <label className={styles.tocToggle}>
                <input type="checkbox" checked={tocEnabled} onChange={(e) => onMetaChange({ toc: { ...toc, enabled: e.target.checked } })} />
                Mostrar sumário na página
              </label>
              <div className={styles.tocList}>
                {tocItems.length === 0
                  ? <div className={styles.tocEmpty}>Adicione blocos “Título de seção” (H2) para gerar o sumário.</div>
                  : tocItems.map((it) => (
                    <label key={it.id} className={styles.tocItem}>
                      <input
                        type="checkbox"
                        checked={!it.hidden}
                        onChange={(e) => onMetaChange({ toc: { ...toc, items: tocItems.map((x) => x.id === it.id ? { ...x, hidden: !e.target.checked } : x) } })}
                      />
                      <span dangerouslySetInnerHTML={{ __html: it.text || '(sem título)' }} />
                    </label>
                  ))}
              </div>
            </div>
          )}
        </div>
        <button className={styles.btn} onClick={onPreview} title="Visualizar a página (sem edição)">
          Visualizar
        </button>
        <button className={styles.btn} onClick={() => fileInput.current?.click()} title="Abrir projeto (.spu.json)">
          Abrir
        </button>
        <button className={styles.btn} onClick={() => BuilderExport.saveProject(doc, doc.meta.title)} title="Salvar projeto (.spu.json)">
          Salvar
        </button>
        <button className={styles.btnDanger} onClick={() => setClearOpen(true)} title="Limpar página">
          Limpar
        </button>
        <div className={styles.exportWrap}>
          <button className={styles.btnPrimary} onClick={() => setExportOpen((o) => !o)} disabled={exporting}>
            {exporting ? `Exportando ${exportLabel}…` : 'Exportar'}
          </button>
          {exportOpen && (
            <div className={styles.exportPop} onMouseLeave={() => setExportOpen(false)}>
              <label className={styles.exportOption}>
                <input
                  type="checkbox"
                  checked={builderCreditEnabled}
                  onChange={(e) => onMetaChange({ builderCredit: e.target.checked })}
                />
                <span>
                  <strong>Crédito do SPU Builder</strong>
                  <small>Mostrar no final da página gerada.</small>
                </span>
              </label>
              <button onClick={() => runExport('HTML', exportSelfContained)}>
                <strong>HTML autocontido</strong>
                <span>Um arquivo único, mais simples de compartilhar.</span>
              </button>
              <button onClick={() => runExport('pacote', exportAssetsZip)}>
                <strong>Pacote HTML</strong>
                <span>ZIP com página e assets separados.</span>
              </button>
              <button onClick={() => runExport('SCORM', exportScormZip)}>
                <strong>SCORM 1.2</strong>
                <span>ZIP para LMS, concluído ao abrir.</span>
              </button>
              <button onClick={() => { setExportOpen(false); onPrintPreview(); }}>
                <strong>Prévia PDF</strong>
                <span>Abre uma versão A4 com interativos expandidos.</span>
              </button>
            </div>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.spu.json,.html,.htm,application/json,text/html"
          style={{ display: 'none' }}
          onChange={handleOpen}
        />
      </div>
      {clearOpen && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setClearOpen(false)}>
          <div className={styles.confirmDialog} role="dialog" aria-modal="true" aria-labelledby="clear-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.confirmIcon}>!</div>
            <div className={styles.confirmBody}>
              <h2 id="clear-title">Limpar página?</h2>
              <p>Todos os blocos do canvas serão removidos e o rascunho salvo neste navegador será substituído por uma página vazia.</p>
              <p>Baixe uma cópia do projeto em JSON antes de limpar se quiser guardar este estado.</p>
            </div>
            <div className={styles.confirmActions}>
              <button className={styles.btn} onClick={() => setClearOpen(false)}>Cancelar</button>
              <button className={styles.btn} onClick={handleDownloadBeforeClear}>Baixar JSON</button>
              <button className={styles.btnDangerSolid} onClick={handleConfirmClear}>Limpar página</button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
