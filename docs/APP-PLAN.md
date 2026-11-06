# Book Studio como app completa para autores KDP: plan

Fecha: 2026-11-06. Autor del plan: Claude (Opus), para Enrique. Estado: propuesta, nada implementado.

Objetivo: que un autor **sin Obsidian** escriba, organice, maquete y exporte su libro de principio a fin en la web/PWA (https://perezamadorluisenrique-gif.github.io/book-studio/), con PDF de interior KDP y EPUB 3, todo en su dispositivo.

## 1. Diagnóstico (código revisado)

Lo que ya existe y se reutiliza tal cual:

- **Motor puro** (`src/engine/`): Markdown → modelo → `layout/` (Knuth–Plass, guiones en 7 idiomas, viudas/huérfanas, partes, índice) → `pdf.ts` y `epub.ts`. Entrada única: `VaultSource { read, readBinary, resolve }` (`engine/book.ts`) más una «nota de libro» con `book: true` cuyo front matter lleva metadatos y ajustes (`engine/manifest.ts`).
- **Studio compartido** (`src/app/studio.ts`, 833 líneas): selector de libro, ajustes (tema, corte), vista previa paginada con zoom, pestañas Problemas / KDP / Accesibilidad, exportación PDF/EPUB, puertas de plan (`gate`). Solo depende de `StudioHost` (`src/app/host.ts`): `source()`, `listBooks()`, `save()`, `store`, `ask()`, `notify()`, `openSource?()`, `renderEmpty?()`.
- **Host web** (`src/web/main.ts`): abre una carpeta (File System Access en Chromium, `<input webkitdirectory>` en el resto), recuerda el handle en IndexedDB (`book-studio` v1, store `handles`), ajustes en `localStorage`, descargas con `<a download>`. Muestras `oz` y `leyendas`.
- **Pestaña KDP** (`src/app/kdp-panel.ts`): preflight, portada completa (lomo, sangrado, código de barras; `engine/cover/`) y hoja de metadatos KDP (`engine/kdp-sheet.ts`). Las tres son Pro (`entitlements.ts`), verlas es gratis.
- **Calidad**: 19 ficheros vitest, `tools/kdp-check.ts`, `npm run epubcheck` (EPUBCheck 5.2.1) en `pages.yml`, plantilla `templates/starter-book/`.

Huecos que impiden ser «app completa»:

| # | Hueco | Evidencia |
|---|---|---|
| H1 | No se puede escribir ni editar: la web solo **lee** carpetas (`mode: "read"`). | `pickFolder()` en `web/main.ts` |
| H2 | No hay «proyecto» propio: sin carpeta Markdown preparada no hay libro. Crear la nota de libro a mano exige conocer la sintaxis `[[enlaces]]` + front matter. | `findBooks()` exige `book: true` |
| H3 | No hay gestión de capítulos (crear, renombrar, reordenar, mover a preliminares/parte final). | orden = lista de enlaces en la nota |
| H4 | No hay formulario de metadatos (título, subtítulo, autor, ISBN, idioma, descripción, palabras clave, portada). | solo front matter |
| H5 | No importa `.docx` ni `.txt`; el 90 % de manuscritos KDP llegan en Word. | `WANTED` = md + imágenes |
| H6 | No es PWA: sin `webmanifest` ni service worker; sin red no abre. | `src/web/index.html` |
| H7 | Sin copias de seguridad ni recuperación: si el navegador borra datos, se pierde todo (y Safari borra almacenamiento de sitios no instalados tras 7 días sin uso). | — |
| H8 | La UI de la app está **solo en inglés** (cadenas literales en `studio.ts`, `kdp-panel.ts`, `web/main.ts`); `engine/i18n.ts` traduce el libro, no la interfaz. | `h("button", { text: "Export EPUB" })` |
| H9 | No hay e2e de navegador (no hay Playwright en `package.json`) ni axe. | `package.json` |
| H10 | `FACTS.md` y las guías dicen «no built-in word processor»: habrá que actualizarlos al lanzar. | `FACTS.md` |

## 2. Visión y qué NO se hará

**Visión**: «Escribe en Markdown sin saberlo; publica en KDP sin Vellum». Una PWA instalable y offline donde el libro es un **proyecto local** (IndexedDB), editable capítulo a capítulo, con vista previa real del libro impreso al lado, y que siempre se puede exportar como **carpeta Markdown compatible con Obsidian** (zip). Cero servidor, cero cuentas, cero analítica.

Decisión clave: el proyecto web se **presenta al motor como un `VaultSource`** con una nota de libro generada. Así `engine/` y `Studio` no cambian de contrato y el plugin de Obsidian queda intacto.

No se hará:

- Backend, sincronización en la nube, cuentas, colaboración en tiempo real.
- Cobros, páginas de venta, cambios en `entitlements.ts`, `PRO_FEATURES`, `manifest.json`, `versions.json` ni versión del paquete.
- Editor WYSIWYG tipo Word ni CodeMirror/ProseMirror (peso y soporte); editor de texto Markdown con barra de ayuda.
- Diseñador gráfico de portadas (capas, tipografías libres). Solo imagen frontal + la portada completa Pro que ya existe.
- Subida directa a KDP (no hay API pública) ni KPF.
- Exportar DOCX.

## 3. Funciones priorizadas (MoSCoW)

Cada criterio es comprobable por test o por e2e.

### Must

| ID | Función | Criterio de aceptación |
|---|---|---|
| M1 | **UI en/es** (`t()` + diccionarios) para Studio, KDP panel y host web; idioma por `navigator.language` con selector. Obsidian sigue en inglés. | Test: claves en/es idénticas y no vacías; e2e con `locale: "es-ES"` no muestra ninguna cadena del diccionario inglés; build del plugin sin cambios de texto visibles. |
| M2 | **Proyectos locales**: «Nuevo libro» (vacío o desde Starter Book), lista de proyectos, abrir, renombrar, borrar (con confirmación). | e2e: crear libro, recargar página, sigue ahí con sus capítulos. Test: `projectToVault()` + `loadBook()` da el mismo modelo que `templates/starter-book` vía `fsVault`. |
| M3 | **Editor de capítulo** (textarea Markdown, barra: negrita, cursiva, título de sección, separador de escena, nota al pie, cita), contador de palabras, autoguardado (≤1 s tras dejar de escribir) y vista previa que se reconstruye sola. | e2e: escribir texto → recargar → texto intacto; la vista previa contiene la frase escrita en ≤3 s. Teclado: todos los botones con `aria-label`, Ctrl+B/I. |
| M4 | **Gestión de capítulos**: añadir, renombrar, borrar, reordenar arrastrando **y** con botones/teclado (Alt+↑/↓), secciones Preliminares / Capítulos / Parte final, partes. | Test puro de `reorder()`/`move()`; e2e: reordenar con teclado cambia el índice del PDF; axe sin violaciones en la lista. |
| M5 | **Metadatos del libro** en formulario: título, subtítulo, autor, idioma, editorial, ISBN papel/ebook (validado con `engine/cover/isbn.ts`), copyright, dedicatoria, epígrafe, descripción, palabras clave (7), serie; tema y corte (respetando el plan). Escribe el front matter de la nota generada. | Test: formulario → front matter → `settingsFromFrontmatter()` ida y vuelta sin pérdidas; ISBN inválido muestra error accesible (`aria-invalid`). |
| M6 | **Imagen de portada frontal** (subir JPG/PNG, guardada en el proyecto, usada como cover del EPUB) con aviso de píxeles necesarios (cálculo ya existe en `coverPixels`). | e2e: EPUB exportado pasa EPUBCheck y contiene la imagen como `cover-image`. |
| M7 | **Exportar PDF/EPUB** desde proyecto (flujo actual de Studio). | e2e: el PDF descargado pasa `kdp-check`, el EPUB pasa EPUBCheck sin errores ni avisos. |
| M8 | **Copia de seguridad**: exportar proyecto como `.zip` = carpeta Markdown + imágenes + nota de libro (abrible en Obsidian y en la web «Abrir carpeta»); importar ese zip como proyecto. Recordatorio no intrusivo si la última copia tiene >7 días. Pedir `navigator.storage.persist()`. | Test: proyecto → zip → proyecto es idéntico (byte a byte en textos); zip → `fsVault` → `loadBook()` funciona. |
| M9 | **PWA offline instalable**: `app.webmanifest` (¡nunca `manifest.json`!), iconos, service worker con caché versionada (app, fuentes 1,1 MB, muestras opcionales). | e2e: tras primera visita, `context.setOffline(true)` + recarga → la app abre, edita y exporta PDF. Lighthouse «installable» OK. |
| M10 | **Abrir carpeta → convertir en proyecto** («Importar carpeta Markdown»), para quien viene de Obsidian. | e2e con `sample/oz`: el proyecto resultante exporta un PDF con el mismo número de páginas que abriendo la carpeta. |

### Should

| ID | Función | Criterio |
|---|---|---|
| S1 | **Importar `.docx`** (conversor propio sobre JSZip + DOMParser: párrafos, Título 1/2 → capítulos/secciones, cursiva, negrita, notas al pie, saltos de página, imágenes) con informe de lo que se descartó. | 5 docx de prueba en `tests/fixtures/docx/` (Word, LibreOffice, Google Docs) → Markdown esperado (snapshot). |
| S2 | **Importar `.md`/`.txt`** y pegar texto: dividir en capítulos por `# `, «Capítulo N», «Chapter N». | Test por patrón en/es. |
| S3 | **Lista de publicación** (gratis, no es el preflight Pro): metadatos obligatorios, portada, 0 problemas, 0 imágenes sin descripción, ancho de lomo e instrucciones del siguiente paso en KDP. | Test: cada regla con un libro que la incumple; enlaza a la guía correspondiente. |
| S4 | **Instantáneas**: hasta 20 versiones por proyecto (automática al exportar + manual), restaurar. | e2e: editar, restaurar instantánea, texto anterior vuelve. |
| S5 | **Buscar y reemplazar** en todo el libro. | Test puro + e2e. |

### Could

- C1 Guardar el proyecto en una carpeta del disco con File System Access `readwrite` (Chromium), sincronizando al guardar.
- C2 Objetivo de palabras por día/capítulo y estadísticas locales.
- C3 Modo enfoque (pantalla completa, solo el editor).

### Won't (esta vez)

Nube, colaboración, DOCX de salida, diseñador de portadas, KPF, cambios de precio/Pro.

## 4. Arquitectura

```
src/project/            (NUEVO, puro, sin DOM ni obsidian; testeable en Node)
  model.ts              Project { id, name, meta, settings, sections[], chapters[], assets[], updatedAt }
  to-vault.ts           projectToVault(p): VaultSource  → genera "<Título>.md" con book: true + notas de capítulo
  from-vault.ts         vaultToProject(paths, read)     → importar carpeta/zip
  ops.ts                addChapter, rename, move, reorder, setMeta (inmutables)
  zip.ts                exportZip / importZip (JSZip, ya es dependencia)
  import-docx.ts        docx → Markdown + informe (S1)
  import-text.ts        dividir .md/.txt en capítulos (S2)
  checklist.ts          reglas de la lista de publicación (S3)
src/app/
  ui-i18n.ts            (NUEVO) t(key, vars), diccionarios en/es; Studio y KdpPanel lo usan
src/web/
  store.ts              (NUEVO) IndexedDB v2: stores handles (existente), projects, files, snapshots; migración v1→v2
  workspace.ts          (NUEVO) pantalla de proyectos + barra lateral de capítulos + editor + formulario de metadatos
  editor.ts             (NUEVO) textarea + toolbar + autoguardado
  sw.ts / app.webmanifest (NUEVO) PWA; esbuild genera sw.js con hash de build
  main.ts               el host pasa a tener dos fuentes: Folder (actual) o Project (nuevo)
```

- **Reutilización**: `StudioHost.source()` devuelve `projectToVault(proyecto)`; `listBooks()` devuelve la única nota generada. Tras cada guardado el host llama `studio.scheduleBuild()` (ya existe con *debounce*). `openSource(src)` del host web abre el capítulo en el editor en la línea indicada: la pestaña Problemas pasa a ser navegable en la web.
- **Disposición**: escritorio en tres columnas (capítulos | editor | Studio con vista previa); móvil con pestañas «Capítulos / Escribir / Libro». El Studio actual se monta sin cambios en la tercera columna.
- **Plugin de Obsidian**: solo le afecta `ui-i18n.ts` (siempre `en`). Las cadenas nuevas deben pasar `eslint-plugin-obsidianmd` (mayúscula solo inicial). `npm run build` del plugin y sus tests son puerta de cada PR.
- **Pro**: no se toca. Portada completa, preflight, hoja KDP siguen detrás de `gate()`; la app solo les da datos mejores (metadatos del formulario).
- **Bundle**: hoy un único `dist/web/app.js` ESM. El conversor docx se carga con `import()` dinámico (activar `splitting: true` en el build web, no en el del plugin, que es CJS).

Riesgos de arquitectura: migración de IndexedDB (probar v1→v2 con el handle guardado); el service worker sirviendo una versión vieja tras desplegar (estrategia: red primero para `index.html`, caché para el resto, aviso «Nueva versión, recargar»); `studio.ts` crece: no meter la lógica de proyecto ahí.

## 5. Fases e hitos (cada uno = 1 PR fusionable y verificable; máx. 5 PRs por hilo)

Orden recomendado. Estimación en sesiones de agente (S = ≤1, M = 1–2, L = 2–3).

**Hilo A: «Escribir en la web»**

| PR | Contenido | Hecho cuando | Est. |
|---|---|---|---|
| A1 | Playwright + `@axe-core/playwright` + `npm run e2e` sobre `dist/web` (flujo actual: muestra → exportar PDF/EPUB → kdp-check + EPUBCheck). Sin cambios de producto. | e2e verde en CI (`ci.yml`) | S |
| A2 | `ui-i18n.ts` + traducción es de Studio, KdpPanel y host web; selector de idioma. (M1) | Test de paridad de claves; e2e en `es-ES`; plugin igual | M |
| A3 | `src/project/` (model, to-vault, ops) + `web/store.ts` IndexedDB v2 + pantalla de proyectos «Nuevo libro / desde plantilla». (M2) | Tests de equivalencia con starter-book; e2e persistencia | M |
| A4 | Editor + lista de capítulos (arrastrar y teclado) + autoguardado + vista previa en vivo + `openSource`. (M3, M4) | e2e escribir/reordenar/recargar; axe 0 violaciones | L |
| A5 | Formulario de metadatos + imagen de portada. (M5, M6, M7) | Ida y vuelta front matter; EPUB con cover pasa EPUBCheck | M |

**Hilo B: «Seguro y offline»**

| PR | Contenido | Hecho cuando | Est. |
|---|---|---|---|
| B1 | Zip de copia (exportar/importar), `storage.persist()`, recordatorio, «Importar carpeta → proyecto». (M8, M10) | Test ida y vuelta zip; e2e con `sample/oz` | M |
| B2 | PWA: `app.webmanifest`, iconos, `sw.js` versionado, aviso de actualización. (M9) | e2e offline; `release-build.test.ts` y `manifest.json` intactos | M |
| B3 | Instantáneas + buscar y reemplazar. (S4, S5) | e2e restaurar | M |

**Hilo C: «Traer el manuscrito y publicar»**

| PR | Contenido | Hecho cuando | Est. |
|---|---|---|---|
| C1 | Importar `.md/.txt` y pegar texto. (S2) | Tests en/es | S |
| C2 | Importar `.docx` con informe, carga diferida. (S1) | 5 fixtures snapshot; e2e importar → exportar PDF válido | L |
| C3 | Lista de publicación + actualizar `FACTS.md`, guías en/es (ya hay editor) y README. (S3, H10) | `site.test.ts` verde; cifras solo de `FACTS.md` | M |

Total: 11 PRs, ~15–18 sesiones. A y B pueden ir en paralelo tras A3 (B depende de `src/project/`). C después de A4. Ninguna PR toca `manifest.json`, `versions.json`, `entitlements.ts`.

## 6. Plan de pruebas

- **Unit (vitest, Node)**: todo `src/project/` (ops, to/from vault, zip, importadores, checklist); paridad de diccionarios en/es; migración IndexedDB con `fake-indexeddb` (devDependency) para `web/store.ts`.
- **Equivalencia con el motor**: el mismo libro abierto como carpeta (`tests/helpers/fsVault.ts`) y como proyecto debe dar el mismo número de páginas y el mismo texto de página (`pageText` de `layout/index.ts`).
- **e2e Playwright** (Chromium en CI; WebKit manual antes de anunciar): (1) nuevo libro → 3 capítulos → reordenar → metadatos → portada → recargar → exportar PDF y EPUB; (2) importar docx; (3) offline; (4) idioma es; (5) móvil 390 px.
- **kdp-check** (`tools/kdp-check.ts`) sobre cada PDF que descarga el e2e; **EPUBCheck** (`npm run epubcheck`) sobre cada EPUB: 0 errores, 0 avisos.
- **axe** en cada pantalla nueva (proyectos, editor, metadatos, diálogos), escritorio y 390 px: 0 violaciones serias/críticas; objetivos táctiles ≥24 px (hay una deuda conocida con casillas en móvil: arreglarla en A4).
- **Puertas existentes en cada PR**: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (plugin), `npm run build:web`, `epubcheck`. `tests/release-build.test.ts` y `tests/entitlements.test.ts` no se editan.

## 7. Riesgos y supuestos no verificados

| Riesgo / supuesto | Mitigación |
|---|---|
| **Pérdida de datos**: Safari borra almacenamiento de sitios no instalados tras 7 días sin visita; cualquier navegador puede desalojar sin `persist()`. | `persist()`, recordatorio de copia, zip compatible con Obsidian, C1 en Chromium, texto claro en la app. Verificar el comportamiento en iOS instalado como PWA (supuesto: instalada no se borra). |
| Cifras KDP de portada no contrastadas con plantillas oficiales: grosor por página (`SPINE_PER_PAGE` 0,002252 blanco / 0,0025 crema / 0,002347 color), código de barras 2 × 1,2 in, texto en lomo desde 79 páginas. | No usarlas en textos nuevos hasta comprobarlas con el generador de plantillas de KDP; dejar el aviso actual. |
| Fidelidad del docx → mensajes de soporte. | Informe de importación explícito, alcance cerrado documentado, fixtures reales; sin promesa de «cualquier Word». |
| Memoria/tiempo en móviles con libros grandes (>400 páginas) al reconstruir en cada pulsación. | *Debounce* ya existente (800 ms) y reconstruir solo con la vista previa visible; medir con Oz ×4 en el e2e móvil. |
| Service worker que sirve versiones viejas o rompe la web. | Red primero para HTML, nombre de caché con hash, botón «Recargar»; probar desactivación. |
| Lint de Obsidian sobre cadenas compartidas (mayúsculas, textos). | Correr `npm run lint` y el review linter en cada PR que toque `src/app/`. |
| Confusión `manifest.json` (dispara release) vs manifiesto web. | Nombre `app.webmanifest`; test que falle si el build web escribe un `manifest.json`. |
| Supuesto: GitHub Pages sirve `.webmanifest` con MIME correcto y el SW con alcance `/book-studio/`. | Comprobar en la primera PR B2 con el job de Pages. |
| Supuesto: las Actions del repo público book-studio tienen minutos (las de obsidian-dev no). | Si no, correr las puertas localmente y pegar resultados en la PR. |

## 8. Tres ideas nuevas

1. **«Libro como código»**: CLI `npx book-studio build <carpeta>` y una GitHub Action que genera PDF+EPUB y pasa kdp-check/EPUBCheck en cada push. Reutiliza `tools/render-sample.ts`; nicho de autores-desarrolladores, cero soporte de UI, encaja con Claimable/plugin-inspector.
2. **Exportar «muestra para lectores beta (ARC)»**: un EPUB/PDF con los N primeros capítulos, marca «Copia de lectura» y una página final con enlace a la tienda. Un botón, reutiliza el pipeline y las ediciones.
3. **Revisión de estilo offline**: palabras repetidas cercanas, comillas/rayas mezcladas, nombres de personajes con grafías distintas, capítulos muy desiguales; listado en la pestaña Problemas con salto a la línea del editor. Todo local, en/es, sin IA ni red.
