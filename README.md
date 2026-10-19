# SPU Builder

Builder visual para montar objetos de aprendizagem com o SPU ENAP Design System.

O projeto é uma aplicação React/Vite estática. O kit compilado do Design System fica em `public/ds` e é carregado pelo app em tempo de execução.

## Rodar localmente

```bash
npm install
npm run dev
```

O Vite abrirá o builder em `http://localhost:5173`.

## Verificar build

```bash
npm run build
npm run lint
```

## Publicar na nuvem

O repositório já inclui um workflow em `.github/workflows/pages.yml`.

Depois de subir para o GitHub:

1. Abra `Settings > Pages`.
2. Em `Build and deployment`, escolha `GitHub Actions`.
3. Faça push na branch `main`.

O GitHub Actions vai gerar o build e publicar a pasta `dist` no GitHub Pages.

## Design System

Arquivos necessários em produção:

- `public/ds/_ds_bundle.js`
- `public/ds/image-slot.js`
- `public/ds/styles.css`
- `public/ds/tokens/**`

A pasta `public/ds/uploads` é ignorada no Git porque contém artefatos temporários e rascunhos do DS.

Quando houver mudanças no DS base, copie o kit recompilado para `public/ds` e registre patches relevantes em `docs/DS-PATCH-*.md`.

## Exportações

O builder exporta:

- HTML autocontido
- pacote HTML + assets
- SCORM 1.2
- prévia PDF/A4 para impressão

Projetos podem ser reabertos por `.spu.json` ou por HTML exportado que contenha os dados do builder.
