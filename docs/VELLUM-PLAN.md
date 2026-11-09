# Book Studio como «Vellum gratis, en el navegador y en español»: plan de creación

Fecha: 2026-11-09 (versión 2, decisiones cerradas). El avance se apunta en `docs/VELLUM-PROGRESS.md`.

Cómo leer este documento: las secciones 1 a 7 son para Enrique. Las secciones 8 y 9 son las órdenes de trabajo para quien construye (Sonnet): se siguen en orden, una por PR.

## 1. La meta en una frase

Un autor sube su Word, elige un estilo y en 10 minutos descarga el interior, la cubierta y el ebook listos para Amazon KDP, con calidad de editorial, sin instalar nada, sin cuenta y gratis.

Lo que se le promete al autor, en este orden:

1. **Se ve como un libro de editorial.** Nadie debe poder distinguir una página nuestra de una de Vellum.
2. **No pierdo nada de mi Word.** Lo que escribí está todo ahí, y la app me lo demuestra.
3. **Tengo la cubierta completa.** Portada, lomo y contraportada con las medidas exactas de KDP.
4. **Es rápido y es mío.** 10 minutos, en mi navegador, sin subir el manuscrito a ningún sitio.

## 2. Dónde estamos hoy (medido el 2026-11-09 sobre los dos libros de muestra)

Book Studio ya parte las líneas con el método de TeX, tiene guiones en 7 idiomas, evita viudas y huérfanas, importa Word básico y dibuja la cubierta completa. Lo que lo separa de Vellum:

| Qué se mide | *El mago de Oz* (inglés) | *Leyendas* de Bécquer (español) | Meta |
|---|---|---|---|
| Páginas de texto que acaban más cortas que las demás | 28 de 91 | 33 de 109 | 0, salvo fin de capítulo |
| Dobles páginas con alturas distintas | 15 | 25 | 0 |
| Tres o más líneas seguidas acabadas en guion | 0 | 9 | 0 |
| Líneas con huecos muy grandes entre palabras | 1 | 13 | 0 |
| Líneas con huecos grandes | 19 de 2.770 | 27 de 3.439 | menos de 1 de cada 500 |
| Tiempo de maquetar el libro entero | 0,65 s | 0,74 s | menos de 1,5 s para 300 páginas |

Hoy evitamos las viudas dejando páginas cortas, y eso es lo que delata a un libro autopublicado: la página izquierda y la derecha no acaban a la misma altura. Además: la página de inicio explica pero no vende, el Word pierde tablas y cajas de texto, la cubierta no tiene editor y solo hay 8 estilos.

## 3. Qué es gratis y qué es Pro (decisión cerrada)

**La regla:** es gratis todo lo que un autor necesita para publicar *un* libro en Amazon con calidad profesional. Es Pro lo que sirve a quien publica muchos libros, vende fuera de Amazon o quiere diseño prémium. Nunca se cobra por algo que ya fue gratis.

| Función | Hoy | Queda en | Por qué |
|---|---|---|---|
| Libros ilimitados, PDF de imprenta, EPUB 3 | Gratis | **Gratis** | Ya lo era |
| Motor tipográfico nuevo completo | (nuevo) | **Gratis** | Es la promesa principal |
| Todos los formatos de página de KDP (hoy 12, luego 16 y tapa dura) | 3 gratis, 9 Pro | **Gratis** | Sin el formato que el autor quiere no hay «listo para Amazon» |
| Cubierta completa y editor de cubiertas, con 8 plantillas y las cubiertas generativas | Pro | **Gratis** | KDP exige cubierta; es lo que más se paga fuera |
| Notas al pie de página | Pro | **Gratis** | Un ensayo sin notas al pie no es profesional |
| Revisión previa de KDP (avisa de lo que Amazon rechazaría) | Pro | **Gratis** | Da la confianza de «listo para Amazon» |
| Hoja de datos para KDP (título, palabras clave, descripción) | Pro | **Gratis** | Ayuda a publicar; cuesta poco |
| Letra grande | Pro | **Gratis** | Accesibilidad; no se cobra por leer mejor |
| Estilos Classic, Modern, Elegant y Non-fiction, más 4 generales nuevos | 2 gratis | **Gratis** | Ocho estilos buenos bastan para cualquier libro |
| Importar Word sin pérdidas y exportar a Word | (nuevo) | **Gratis** | Es la puerta de entrada |
| Editor de estilo básico (tamaño de letra, márgenes, adorno de escena) | (nuevo) | **Gratis** | Ajustes que todo autor pide |
| Estilos de género: Thriller, Romance, Fantasy y los 12 nuevos | Pro | **Pro** | Diseño prémium |
| 12 plantillas de cubierta prémium por género | (nuevo) | **Pro** | Diseño prémium |
| Guardar estilos propios y usar tipos de letra propios | (nuevo) | **Pro** | Uso profesional |
| Varias ediciones en una exportación (tapa blanda, letra grande, ebook) | Pro | **Pro** | Quien publica mucho |
| Colecciones, series y página «Otros libros del autor» sincronizada | Pro | **Pro** | Quien tiene catálogo |
| Índice analítico | Pro | **Pro** | Libro técnico o académico |
| Paquete de EPUB accesible (auditoría, declaración e informe) | Pro | **Pro** | Editoriales e instituciones |
| Salida para otras imprentas (IngramSpark, Draft2Digital) | (nuevo) | **Pro** | Vender fuera de Amazon |

Precios, sin cambios y apagados hasta que Enrique retome ventas: Book Studio Pro 59 USD de pago único; packs de género 12 USD.

Otras decisiones cerradas:

1. **La web es el producto.** El plugin de Obsidian recibe el mismo código, pero no se sube su versión mientras Pro esté apagado.
2. **Español primero**, inglés después, en la página de inicio, los ejemplos y las reglas tipográficas.
3. **Sin analítica.** Se mantiene «sin cuentas, sin cookies, sin analítica».
4. **Sin IA dentro del producto.** Coste cero por usuario.
5. **Orden:** motor, página de inicio, Word, cubiertas, estilos, lanzamiento.

## 4. Las fases

| Hilo | Fase | Qué entrega | PRs |
|---|---|---|---|
| A | 0 y 1 (primera mitad) | Banco de calidad; líneas; márgenes ópticos y letras elásticas; páginas; guiones | T0, T1.1, T1.2, T1.3, T1.4 |
| B | 1 (segunda mitad) y 2 | Ortotipografía; velocidad; lo gratis nuevo; página de inicio; asistente | T1.5, T1.6, T2.0, T2.1, T2.2 |
| C | 3 | Word sin pérdidas | T3.1 a T3.5 |
| D | 4 | Editor de cubiertas | T4.1 a T4.5 |
| E | 5 | Estilos y paridad con Vellum | T5.1 a T5.5 |
| F | 6 | Lanzamiento | T6.1 a T6.3 |

Lo que verá el autor al final de cada hilo:

- **A:** las dos páginas de cada doble página acaban a la misma altura, sin páginas cortas, sin escaleras de guiones y con el margen derecho recto a la vista.
- **B:** diálogos, abreviaturas y siglos como los pone un corrector; la vista previa responde al instante; todos los formatos, la cubierta y las notas al pie son gratis; una página de inicio que lleva del Word al PDF en 4 clics.
- **C:** su Word entra entero, con la garantía de palabras a la vista.
- **D:** una cubierta completa hecha en 5 minutos.
- **E:** 24 estilos, tapa dura, vista previa del ebook en un Kindle.
- **F:** vídeos, guías y fichas publicadas.

## 5. Cómo se gana dinero después (apagado hasta que Enrique diga)

Book Studio Pro y los packs de género de la tabla de la sección 3. Más adelante, plantillas hechas por diseñadores con reparto de ingresos. Cada pieza Pro nace con su interruptor en `src/engine/entitlements.ts`.

## 6. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Que el PDF no llegue a la calidad de Vellum | Marcador de calidad y páginas doradas; no se escribe «calidad de editorial» en la web hasta cumplir las metas |
| Que el motor nuevo sea lento | Presupuesto de tiempo como prueba; caché por capítulo |
| Que un Word raro salga mal | Garantía de palabras e informe de importación |
| Que KDP rechace una cubierta | Comprobar los números con las plantillas oficiales antes de publicar el editor (T4.1) |
| Que la app pese demasiado | Diccionarios y tipos de letra cargados solo cuando hacen falta |
| Prometer de más | Cada frase de la web sale de `docs/web-launch/FACTS.md`, que se actualiza en el mismo PR que cambia el producto |

## 7. Lo único que necesita Enrique

- Ya dado: permiso para fusionar y publicar en la web cuando todo esté en verde.
- Opcional: un Word guardado con Microsoft Word de verdad, para el hilo C.
- OK antes de cada publicación en X y en directorios (hilo F).

---

## 8. Reglas para quien ejecuta

1. **Una orden de trabajo = un PR.** Se hacen en el orden de la sección 9. No se empieza la siguiente hasta fusionar la anterior. Máximo 5 PRs por hilo.
2. **Antes de cada PR, en local y con la salida pegada en el cuerpo del PR:**
   `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm run build:web && E2E_CHROMIUM=/opt/pw-browsers/chromium npm run e2e` y, desde T0, `npm run quality`.
3. **Fusionar** cuando todo eso pasa y el CI del PR está verde: pasar el PR de borrador a listo y fusionar con squash. Fusionar publica la web; Enrique ya dio el OK.
4. **Nunca:** subir la versión en `manifest.json`, `versions.json` o `package.json`; encender Pro; saltar, borrar o aflojar una prueba para que pase; poner enlaces de sesión o de claude.ai en commits o PRs; añadir analítica, cookies o peticiones a otro servidor; añadir dependencias nuevas sin que la orden lo diga.
5. **Si una meta numérica no se alcanza** tras implementar la orden completa: no se toca la prueba. Se guarda en `tests/quality-baseline.json` el número conseguido (que debe ser mejor o igual que el anterior), se apunta en `VELLUM-PROGRESS.md` cuánto falta y por qué, y se sigue. Si un número *empeora*, el PR no se fusiona.
6. **Si algo del plan no encaja con el código real:** hacer lo más parecido que cumpla el «hecho cuando», y apuntarlo en `VELLUM-PROGRESS.md`. No preguntar a Enrique salvo permiso denegado o acción pública nueva.
7. **Al terminar cada PR:** actualizar `docs/VELLUM-PROGRESS.md` (tabla y diario) dentro del mismo PR, y `CLAUDE.md` si cambian archivos o comandos. Si cambia lo que la web promete, actualizar `docs/web-launch/FACTS.md` y `README.md`.
8. **Mensajes de commit** en inglés e imperativo, con prefijo `Book Studio:`. Textos de la interfaz en inglés y español (`src/app/ui-i18n.ts`).
9. **Cada PR lleva evidencia que se pueda abrir:** tabla de `npm run quality` antes y después, y cuando cambie lo que se ve, capturas en `docs/vellum/` (PNG de dobles páginas hechas con `pdftoppm -r 80`).
10. **Rendimiento:** ninguna orden puede subir el tiempo de `layoutBook` de los libros de muestra a más del doble del de hoy (Oz 0,65 s; Leyendas 0,74 s) hasta T1.6, que lo baja.

## 9. Órdenes de trabajo

Mapa del código actual, para no explorar:

- `src/engine/linebreak.ts`: `knuthPlass(items, opts)` y `firstFit`. Elementos caja, pegamento y penalización.
- `src/engine/hyphenate.ts`: `hyphenatorFor(lang)` con 7 idiomas y mínimos fijos 2 y 3.
- `src/engine/layout/inline.ts`: `ParagraphSetter.set()` tokeniza, crea elementos (`items()`, `wordItems()`, `segmentBoxes()`) y coloca (`lines()`).
- `src/engine/layout/blocks.ts`: `FlowBuilder`; `lineBoxes()` convierte líneas en cajas verticales y prohíbe cortar tras la línea 1 y la penúltima.
- `src/engine/layout/paginate.ts`: `paginate(items, capacidad, notas)` voraz; deja la página corta cuando el corte está prohibido.
- `src/engine/layout/index.ts`: `layoutBook` y `compose`; `layChapter(ch)` llama a `paginate`; `placeChapter` añade las páginas a `body`.
- `src/engine/pdf.ts` (texto con operadores `Tm` y `TJ`) y `src/preview/canvas.ts` (misma página en pantalla).
- `src/engine/entitlements.ts`: qué es gratis y qué Pro. `tests/entitlements.test.ts` lo vigila.
- `tools/site.mjs` genera las páginas estáticas desde `site/<idioma>/*.md`; `src/web/` es la app; `e2e/web.e2e.ts` las pruebas de navegador.
- `src/project/import-docx.ts` e `import-text.ts`: importación. `src/engine/cover/`: cubierta.

---

### HILO A

### T0. Banco de pruebas de calidad

**Objetivo:** que el motor dé sus propias cifras de calidad y que una prueba impida empeorarlas.

**Pasos:**

1. `src/engine/layout/inline.ts`: añadir a `SetLine` el campo `ratio: number` (la razón de ajuste con la que se colocó la línea; 0 en la última línea y en texto no justificado). Se calcula en `lines()`, es la variable `r`.
2. `src/engine/layout/paginate.ts`: añadir a `VBox` los campos opcionales `q?: { ratio: number; hyphen: boolean }` y `para?: number` (número de línea dentro del párrafo, desde 1) y `paraLines?: number`. `FlowBuilder.lineBoxes()` los rellena solo cuando la llamada viene de un párrafo de cuerpo (añadir la opción `body: true` a `lineBoxes` y pasarla en el caso `"paragraph"` de `blocks()`).
3. `paginate()` devuelve en cada `FlowPage` un campo `stats: PageStats`:
   `{ lines, loose, veryLoose, hyphens, ladders, short, hyphenEnd, widows, orphans, adjusted }`.
   - `lines`: cajas con `q`. `loose`: `q.ratio > 1`. `veryLoose`: `q.ratio > 2`. `hyphens`: `q.hyphen`.
   - `ladders`: cada vez que se alcanzan 3 líneas seguidas con guion dentro de la página.
   - `short`: líneas enteras que le faltan a la página para llenarse, `floor((capacidad − usado − notas + 0,01) / interlínea)`; siempre 0 en la última página del flujo y en una página cerrada por `newpage`. `paginate` recibe la interlínea en un parámetro nuevo de opciones `{ unit }`.
   - `hyphenEnd`: la última caja de la página tiene `q.hyphen`.
   - `orphans`: la última caja tiene `para === 1` y `paraLines > 1`. `widows`: la primera caja tiene `para === paraLines` y `paraLines > 1`.
   - `adjusted`: 0 por ahora (lo usa T1.3).
4. `src/engine/layout/types.ts`: `LayoutPage.stats?: PageStats` y `Layout.quality: Quality` con las sumas y además `pages` (páginas con `stats`), `shortPages` (páginas con `short > 0`), `unevenSpreads` (página izquierda y la derecha siguiente, del mismo capítulo, las dos con `stats` y ninguna la última del capítulo, cuyo `short` difiere) y `hyphenTurns` (páginas derechas con `hyphenEnd`).
   `compose` copia `stats` de `FlowPage` a `RawPage` en `chapterPages`, y `layoutBook` calcula `quality` al final sobre las páginas definitivas.
5. Tres libros de prueba nuevos en `tests/fixtures/books/<nombre>/` (carpeta con nota de libro `book: true` y capítulos en Markdown, mismo formato que `sample/leyendas`), todos de dominio público, de 15.000 a 30.000 palabras cada uno, recortando si hace falta:
   - `dialogo-es`: novela española con diálogos con raya (por ejemplo, capítulos de *Marianela* de Galdós).
   - `ensayo-es`: ensayo con párrafos largos y al menos 20 notas al pie con sintaxis `[^1]`.
   - `largo-de`: prosa en alemán (palabras largas), `language: de`.
   Si el entorno no puede descargar los textos, escribirlos a partir de fragmentos que ya estén en `sample/` no vale: en ese caso dejar solo Oz y Leyendas, apuntarlo en el progreso y seguir.
6. `tools/quality.ts` y script `"quality"` en `package.json` (mismo patrón de esbuild que el script `sample`): maqueta cada libro (los dos de `sample/` y los de `tests/fixtures/books/`), imprime una tabla Markdown con `Layout.quality` y el tiempo, y con `--write` guarda `tests/quality-baseline.json`.
7. `tests/quality.test.ts`: para cada libro, cada cifra de defecto (`shortPages`, `unevenSpreads`, `ladders`, `veryLoose`, `loose`, `widows`, `orphans`, `hyphenTurns`) es menor o igual que la de `tests/quality-baseline.json`.
8. Páginas doradas: `tests/golden.test.ts` guarda con `toMatchFileSnapshot` el texto y las posiciones redondeadas a 0,1 pt de 6 páginas fijas de Oz y 6 de Leyendas (no imágenes: así no depende del sistema). Regenerar con `-u` solo cuando una orden cambie la composición a propósito, y decirlo en el PR.

**Hecho cuando:** `npm run quality` imprime la tabla; las cifras de Oz y Leyendas son del orden de las de la sección 2 (páginas cortas 28 y 33); las pruebas pasan.

**PR:** `Book Studio: typographic quality score and baseline`.

### T1.1 Líneas

**Objetivo:** mejores cortes de línea: sin escaleras de guiones, sin líneas finales ridículas, con guiones cuando hace falta, y con la capacidad de dar un párrafo con una línea más o menos.

**Pasos:**

1. `linebreak.ts`: nueva función `breakParagraph(items, opts): { breaks: KPBreak[]; demerits: number } | null` con el cuerpo actual de `knuthPlass`; `knuthPlass` pasa a ser `return breakParagraph(items, opts)?.breaks ?? null`.
2. Opciones nuevas en `KPOptions`, todas opcionales:
   - `maxHyphenRun` (por defecto 0 = sin límite): cada nodo lleva `run`, las líneas seguidas acabadas en penalización marcada. Nodo nuevo: `run = flagged ? padre.run + 1 : 0`. Un candidato se descarta si `flagged && maxHyphenRun > 0 && padre.run >= maxHyphenRun`.
   - `finalHyphenDemerits` (0): se suma cuando el corte es el último elemento y la línea anterior acabó en penalización marcada.
   - `lastLineMin` y `runtDemerits` (0): en el último corte, si el párrafo tiene más de una línea y el ancho natural de la última (`sum.width − padre.totalWidth`) es menor que `lastLineMin`, se suma `runtDemerits`.
   - `lineCount`: al elegir el mejor nodo final, solo valen los nodos con `line === lineCount`. Los nodos ya se agrupan por número de línea, así que conviven soluciones con distinto número de líneas.
3. `inline.ts`, estrategia de `set()` para texto justificado:
   - Parámetros comunes: `maxHyphenRun: 2`, `finalHyphenDemerits: 5000`, `lastLineMin: max(2 × sangría, 2 × tamaño de letra)`, `runtDemerits: 10000`, `flaggedDemerits: 10000`.
   - Paso 1, sin guiones, tolerancia 0,7. Paso 2 (si falla y hay guiones), con guiones, tolerancias 1, 1,6, 2,5 y 6. Sin guiones disponibles: 1, 2, 4 y 8. Último recurso: `firstFit`.
   - En `wordItems()`: no crear puntos de guion en la última palabra del párrafo (pasar un indicador desde `items()`).
4. `inline.ts`: `SetParagraph` gana `hyphenated: boolean` (qué juego de elementos se usó) y `ParagraphSetter` gana `variant(inlines, base, opts, lines: number): SetParagraph | null`, que construye los elementos con guiones si el párrafo los permite y llama a `breakParagraph` con `lineCount: lines` y tolerancia 1,3. Devuelve `null` si no hay solución, si `lines < 1` o si hay capitular y `lines <= dropCap.lines`.
5. Pruebas nuevas en `tests/linebreak.test.ts`, con elementos hechos a mano (cajas de ancho fijo):
   - con `maxHyphenRun: 2` ningún resultado tiene 3 cortes marcados seguidos;
   - `lineCount: n + 1` devuelve exactamente `n + 1` cortes cuando hay holgura, y `null` cuando no cabe;
   - `runtDemerits` cambia la solución cuando la última línea quedaría con una sola caja corta;
   - `knuthPlass` da el mismo resultado que antes con las opciones antiguas (comparar con un caso fijo).
6. Prueba en `tests/layout.test.ts`: en Leyendas, `quality.ladders === 0`.

**Hecho cuando:** Leyendas: `ladders` 0 y `veryLoose` como mucho 3 (hoy 13). Oz no empeora en nada. Regenerar páginas doradas y `quality-baseline.json`.

**PR:** `Book Studio: line breaking without hyphen ladders or runts`.

### T1.2 Márgenes ópticos y letras elásticas

**Objetivo:** el borde derecho se ve recto y los huecos entre palabras se igualan.

**Pasos:**

1. `linebreak.ts`: cajas con campos opcionales `stretch`, `shrink`, `pl`, `pr`; penalizaciones con `pr`.
   - En el bucle principal, al pasar una caja: `sum.stretch += stretch ?? 0; sum.shrink += shrink ?? 0`.
   - Protrusión: calcular una vez dos tablas. `rp[i]`: si el elemento `i` es una penalización con ancho mayor que 0, su `pr`; si no, el `pr` de la última caja anterior a `i`. `lp[i]`: el `pl` de la primera caja posterior a `i`; para el nodo inicial, el de la primera caja del párrafo. En `ratioFor`, restar del ancho `rp[fin] + lp[inicio]`.
2. `inline.ts`:
   - `SetOptions.micro?: boolean`; `blocks.ts` lo pasa a `true` solo en párrafos de cuerpo justificados.
   - Tabla de protrusión, como fracción del ancho del propio carácter. Derecha: guion 0,7; punto y coma 0,7; dos puntos y punto y coma 0,4; comillas de cierre `’ ” ' "` 0,6; `»` 0,3; `! ?` 0,2; raya corta 0,3; raya 0,2. Izquierda: comillas de apertura `‘ “ ' "` 0,6; `«` 0,3; `¿ ¡ (` 0,1.
   - En `segmentBoxes()`, con `micro`, cada caja de texto recibe `pl` y `pr` según su primer y último carácter (ancho con `fonts.width` del carácter suelto), y `stretch = shrink = 0,02 × ancho`. La penalización de guion recibe `pr = 0,7 × ancho del guion`.
   - En `lines()`: el ancho objetivo es `lineWidth + lp + rp` de esa línea y el inicio se desplaza `−lp`. Reparto: sea `B` la suma de anchos de texto, `e = 0,02`. Si falta espacio y la razón `r = falta / (estiramiento del pegamento + B × e)` es menor o igual que 1, las letras se escalan `1 + r × e` y el pegamento usa `r`. Si `r > 1`, las letras se escalan `1 + e` y el pegamento absorbe el resto. Si sobra, lo mismo con encogimiento y `r` limitada a −1. La última línea no se escala salvo que sobre.
   - `Piece.scale?: number`. `SetLine.ratio` guarda la razón aplicada al pegamento.
3. `layout/types.ts`: `TextDraw.scale?: number`. `blocks.ts`, `drawsFor()`: copiar `scale`, y usar `p.width` ya escalado para la línea de tachado.
4. `pdf.ts`: multiplicar por `scale` los dos primeros números de la matriz `Tm` (el eje horizontal del texto). `preview/canvas.ts`: multiplicar por `scale` el factor horizontal de `ctx.scale` y los avances.
5. `paginate.ts`, `offsetDraw` no cambia (copia el objeto entero).
6. Pruebas:
   - `tests/linebreak.test.ts`: con `pr` en la última caja, una línea que no cabía por menos que `pr` ahora cabe.
   - `tests/layout.test.ts`: en Oz, todos los `TextDraw.scale` están entre 0,98 y 1,02; existe al menos una línea cuya última pieza acaba en guion y cuyo borde derecho (`x + ancho`) supera el margen derecho del bloque de texto en más de 0,5 pt y menos de 4 pt.
   - `tests/pdf` (donde ya se prueba `writePdf`): el PDF de Oz sigue pasando `checkKdpPdf`.
   - e2e existente: la vista previa sigue dibujando.

**Hecho cuando:** `loose` baja al menos a la mitad en los dos libros (hoy 19 y 27) y `veryLoose` es 0 en Oz y como mucho 1 en Leyendas. Dos capturas antes y después en `docs/vellum/`.

**PR:** `Book Studio: optical margins and font expansion`.

### T1.3 Páginas

**Objetivo:** las dos páginas de cada doble página acaban a la misma altura, sin páginas cortas.

**Pasos:**

1. `paginate.ts`: `VBox.group?: ParaGroup` en la primera caja de cada párrafo de cuerpo, con `ParaGroup = { size: number; alt(delta: -1 | 1): VBox[] | null; adjusted?: boolean }`. `alt` guarda su resultado en caché. Las cajas que devuelve `alt` llevan en la primera un `group` con `adjusted: true` y un `alt` que devuelve siempre `null`.
2. `blocks.ts`, caso `"paragraph"`: construir el `group`. `alt(delta)` llama a `setter.variant(..., set.lines.length + delta)` con las mismas opciones del párrafo y, si hay resultado, a `lineBoxes` con las mismas opciones. Sin `group` cuando el párrafo tiene capitular.
3. `paginate.ts`: extraer del bucle actual la función `fill(items, i, capacidad, notas)`, que devuelve `{ end, used, notes, final, overflow, hyphenEnd }` sin dibujar. `final` es verdadero si la página acaba por fin del flujo o por `newpage`. Extraer `emit(items, i, end, capacidad)`, que hace el dibujo actual.
4. Opciones nuevas de `paginate`: `{ unit, balance?: boolean, firstRecto?: boolean }`. Sin `balance`, el comportamiento es el de hoy (lo usan el índice y las notas).
5. Coste de una página: `short × 100 + (hyphenEnd y es página derecha ? 10 : 0)`, y 0 si `final`.
6. `layPage(items, i, capacidad, página)`: llama a `fill`. Si el coste es mayor que 0, prueba arreglos: para cada `group` no ajustado cuya primera caja está entre `i` y la primera caja con `group` posterior a `end` (incluida), y para `delta` −1 y +1, si `alt(delta)` existe, crea una copia de `items` con las cajas del párrafo sustituidas y vuelve a llamar a `fill`. Se queda con el arreglo de menor coste (a igual coste, el párrafo con más líneas) si mejora el coste original. Devuelve la lista de elementos resultante y el resultado de `fill`.
7. Bucle por dobles páginas. Página derecha suelta (la primera del capítulo cuando `firstRecto`): `layPage` normal. Para cada página izquierda `p`, probar reducciones `d` de 0, 1 y 2 líneas: componer la izquierda con capacidad `− d × unit` y, si no es `final`, la derecha con la misma reducción. Coste de la doble página: `|short izquierda − short derecha| × 100 + d × 10 + costes de guion`, donde `short` se mide contra la capacidad reducida y una página `final` cuenta como igualada. Parar en la primera reducción con coste menor que 100; si ninguna, quedarse con la de menor coste. Las notas al pie se dibujan contra la capacidad reducida.
8. Fin de capítulo: si hay 2 o más páginas y la última usa menos de `4 × unit`, repetir hasta 3 veces: entre los `group` no ajustados que empiezan en la penúltima o antepenúltima página, probar `alt(+1)` y `alt(−1)`, recomponer desde la página donde empieza ese párrafo y aceptar el primero que deje la última página con 4 líneas o más, o que la haga desaparecer sin aumentar el coste de las páginas rehechas.
9. `PageStats.adjusted`: párrafos con `group.adjusted` que empiezan en la página.
10. `index.ts`: `layChapter(ch, firstRecto)` con `balance: true` y `unit: leading`; caché por `ch.id + paridad`. `placeChapter` pasa `list.length % 2 === 0` (tras `ensureRecto`); en `buildFront`, `front.length % 2 === 0`.
11. `blocks.ts`, `heading()`: el título lleva `breakAfter = NO_BREAK` (ya es así) y además la primera línea del párrafo siguiente queda unida a la segunda (ya lo garantiza la regla de huérfanas); añadir una prueba que lo fije.
12. Pruebas en `tests/paginate.test.ts`, con cajas hechas a mano de altura 10 y capacidad 100:
    - un párrafo de 4 líneas que cae en las líneas 9 a 12 y otro anterior con `alt(+1)`: la página queda llena y `short` es 0;
    - sin ningún `alt` disponible: la izquierda y la derecha quedan las dos con 9 líneas;
    - la última página con 1 línea y un párrafo anterior con `alt(−1)`: el capítulo pierde esa página;
    - con `balance: false`, el resultado es idéntico al de antes (caso fijo).
13. `tests/layout.test.ts`: en Oz y Leyendas, `quality.unevenSpreads === 0`, `widows === 0`, `orphans === 0`.

**Hecho cuando:** en todos los libros de prueba `unevenSpreads`, `widows` y `orphans` son 0; `shortPages` baja de 28 y 33 a 6 o menos en cada uno; ningún libro gana más de 2 páginas. Cuatro capturas de dobles páginas antes y después.

**PR:** `Book Studio: balanced spreads and paragraph-level page repair`.

### T1.4 Guiones por idioma

**Pasos:**

1. `hyphenate.ts`: tabla `MINS` de mínimos (izquierda, derecha): `es` 2 y 2; `ca`, `gl`, `eu`, `it`, `pt` 2 y 2; `en`, `en-gb` 2 y 3; `fr` 2 y 3; `de` 2 y 2; `nl` 2 y 2. Sustituye a `LEFT_MIN` y `RIGHT_MIN`.
2. Idiomas nuevos con `hyphen/ca`, `hyphen/gl`, `hyphen/eu`, `hyphen/nl`. Para que la app no pese más: `hyphenatorFor` pasa a ser `async function loadHyphenator(lang)`, con `import()` dinámico por idioma; `compose` recibe el hyphenator ya cargado (cargarlo en `buildBook`, en `src/app/pipeline.ts`, y pasarlo a `layoutBook(book, fonts, { hyphenator })`). `esbuild.config.mjs`: la web ya admite trozos separados si usa `splitting`; si no lo usa, activar `splitting: true` con `format: "esm"` para la web. En el plugin de Obsidian (un solo archivo) los `import()` quedan dentro del mismo archivo: comprobar con `npm run build` que no falla.
3. Reglas del español, en `points()` cuando el idioma es `es`: quitar los puntos que dejan una sola vocal a un lado; quitar los que dejan un fragmento de la lista `ES_TABOO` (`culo`, `puta`, `puto`, `pene`, `caca`, `pedo`, `teta`, `ano`, `coño`, `mea`, `caga`, `sexo`) como primera o segunda parte exacta.
4. En todos los idiomas: sin puntos en palabras con cifras, y sin puntos en palabras de 2 a 5 letras todas en mayúscula (ya existe la regla de mayúsculas: mantenerla).
5. Nombres propios: en `wordItems()`, si la palabra empieza por mayúscula y no es la primera del párrafo ni sigue a `. ! ? …`, la penalización de sus guiones es 150 en vez de 50.
6. Control del autor: el guion opcional (U+00AD) ya marca un punto; añadir que una palabra que lo contiene solo se parte por ahí, y que el carácter «no separador» U+2060 dentro de una palabra prohíbe partirla. Documentarlo en `README.md`.
7. Idioma por fragmento: fuera de alcance; apuntarlo como pendiente en el progreso.
8. Pruebas en `tests/hyphenate.test.ts`: `espectáculo` no da el punto antes de `culo`; `disputa` no da `dis-puta`; `aéreo` no deja `a-`; una palabra catalana, una gallega y una vasca dan puntos; `OTAN` y `covid19` no dan ninguno.

**Hecho cuando:** pruebas verdes; el tamaño de `dist/web` no crece más de 60 KB sin contar los trozos de idioma; Leyendas no empeora en ninguna cifra.

**PR:** `Book Studio: per-language hyphenation rules and four more languages`.

---

### HILO B

### T1.5 Ortotipografía

**Pasos (todo en `src/engine/typography.ts` salvo que se diga otra cosa; cada regla con su prueba en `tests/typography.test.ts`):**

1. Raya de diálogo (`es`): un párrafo que empieza por `—`, `--` o `- ` seguido de letra pasa a `—` pegada a la palabra. La raya de inciso (`—dijo ella—`) queda unida con «no separador» a la palabra de su lado, para que nunca quede sola a final ni a principio de línea.
2. Espacio duro automático por idioma (sustituir el espacio por U+00A0): tras abreviaturas de tratamiento (`Sr.`, `Sra.`, `Dr.`, `Dra.`, `D.`, `Dña.`, `Mr.`, `Mrs.`, `Ms.`), entre número y unidad o símbolo (`20 km`, `5 %`, `10 €`), tras `pág.`, `págs.`, `p.`, `cap.`, `núm.`, `n.º`, `vol.`, `fig.` cuando sigue un número, y entre `siglo` y el número romano.
3. Siglos y siglas: números romanos en mayúsculas tras `siglo` o `siglos` se marcan como versalitas (`smallCaps` en el estilo en línea). No tocar otras mayúsculas.
4. Puntos suspensivos: `...` pasa a `…`; `....` pasa a `….`.
5. Comillas anidadas en español: dentro de `«…»`, las comillas rectas dobles pasan a `“…”` y las simples a `‘…’` (revisar lo que ya hace `quotesFor`).
6. Capitular: `DROP_RE` en `inline.ts` ya admite signos de apertura; añadir la raya `—` y que, si la primera palabra tiene una sola letra (`A`, `Y`, `O`), la capitular no deje un hueco: usar la separación normal de palabra.
7. EPUB (`src/engine/epub.ts`): CSS `widows: 2; orphans: 2;` en párrafos, `hyphens: auto` con el `lang` correcto, y el mismo texto ya corregido por `typography.ts`.

**Hecho cuando:** pruebas verdes; el libro `dialogo-es` no tiene ninguna línea que empiece o acabe en raya suelta (prueba que recorre las líneas).

**PR:** `Book Studio: Spanish orthotypography`.

### T1.6 Velocidad

**Pasos:**

1. Medir primero con `npm run quality` (columna de tiempo) y un libro sintético de 300 páginas (Leyendas repetido 3 veces, generado en la prueba).
2. Caché de párrafos: `ParagraphSetter` guarda el resultado por clave (texto del párrafo, estilo, ancho, opciones). `FlowBuilder` acepta una caché que vive entre llamadas a `layoutBook` (se pasa en las opciones; `src/app/studio.ts` la conserva entre refrescos).
3. Caché de capítulos: `layChapter` guarda por (`id`, huella del contenido, ajustes, paridad).
4. Maquetación fuera del hilo principal en la web: `src/web/layout-worker.ts` con el mismo `buildBook`; `Studio.refresh()` lo usa cuando existe `Worker` y cae al modo actual si falla. No tocar el plugin de Obsidian.
5. Pruebas: `tests/perf.test.ts` (libro de 300 páginas: primera maquetación en menos de 3 s en CI; segunda, tras cambiar un párrafo, en menos de un tercio de la primera) y que el resultado con caché es idéntico al resultado sin caché.

**Hecho cuando:** Oz y Leyendas se maquetan en menos tiempo que antes de T1.1; un cambio de un párrafo recompone en menos de 150 ms en la máquina de desarrollo.

**PR:** `Book Studio: cached, off-thread layout`.

### T2.0 Lo gratis nuevo

**Objetivo:** aplicar la tabla de la sección 3 a lo que ya existe.

**Pasos:**

1. `src/engine/trims.ts`: `FREE_TRIMS` pasa a ser todos los ids de `TRIMS`.
2. `src/engine/themes.ts`: `pro: false` en `elegant`, `nonfiction` y `large-print`. `entitlements.ts`: `FREE_THEMES = ["classic", "modern", "elegant", "nonfiction", "large-print"]`.
3. `entitlements.ts`: `FREE_FEATURES: readonly ProFeature[] = ["trim", "largePrint", "preflight", "cover", "footnotes", "kdpSheet"]`; `hasFeature(plan, f)` devuelve `plan === "pro" || FREE_FEATURES.includes(f)`. `printBlockers` deja de bloquear formato, notas al pie y letra grande. `PRO_FEATURES` conserva solo `theme` (texto nuevo: «Genre themes: Thriller, Romance, Fantasy and more»), `index`, `editions`, `boxSets`, `accessiblePack`. Actualizar el comentario de cabecera.
4. Revisar cada uso de `hasFeature`, `printBlockers`, `themeAllowed` y `trimAllowed` en `src/app/studio.ts`, `src/app/kdp-panel.ts`, `src/app/license-panel.ts`, `src/web/details.ts`, `src/web/workspace.ts`, `src/web/main.ts` y `src/obsidian/main.ts`, y quitar los candados y avisos de lo que ahora es gratis. Textos en `src/app/ui-i18n.ts`, en inglés y español.
5. `tests/entitlements.test.ts`: actualizar las pruebas de lo que es gratis y Pro, y añadir a la prueba «no free feature is ever taken away» una tabla `FREE_SINCE_2026_11` con todos los formatos, los cinco temas y las seis funciones, para que nunca se puedan volver a cobrar.
6. `docs/web-launch/FACTS.md` (líneas del plan gratis y de Pro), `README.md`, y los párrafos «Pro» de `site/en/*.md` y `site/es/*.md`.
7. Otro repositorio, PR aparte: en `perezamadorluisenrique-gif.github.io`, la lista de funciones de `pro/book-studio/` (inglés y español) pasa a ser la de Pro de la sección 3. Sin precios nuevos.
8. e2e: una prueba nueva exporta, con el plan gratis, un PDF de 7 × 10 con notas al pie y la cubierta completa, sin marca de agua, y pasa `checkKdpPdf`.

**Hecho cuando:** pruebas verdes y la web publicada muestra todos los formatos sin candado.

**PR:** `Book Studio: every trim, the full cover and footnotes are free`.

### T2.1 Página de inicio

**Objetivo:** `/es/` y `/en/` venden y llevan a la app en un clic; no llevan JavaScript.

**Pasos:**

1. `tools/site.mjs`: tipo de página nuevo `landing` (añadirlo a `auditPages` y a `jsonLd` como `SoftwareApplication`, con `offers` de precio 0). `site/es/index.md` y `site/en/index.md` pasan a `type: landing`. La plantilla de `landing` compone secciones desde el front matter (`hero`, `steps`, `compare`, `faq`) y el cuerpo Markdown.
2. Secciones, en este orden, con estos textos en español (el inglés es su traducción):
   - **Portada.** Título: «Tu libro listo para Amazon en 10 minutos». Frase: «Sube tu Word, elige un estilo y descarga el interior, la cubierta y el ebook. Gratis, sin cuenta, y tu manuscrito nunca sale de tu ordenador.» Botón principal «Sube tu Word» (`app:?start=import`) y enlace «Ver un libro de ejemplo» (`app:?sample=leyendas`).
   - **Antes y después.** Dos imágenes de la misma página: maquetada como en Word (texto justificado sin guiones, Times, con viuda) y maquetada por Book Studio. Se generan con una herramienta nueva `tools/landing-shots.ts` (usa el motor y `pdftoppm`, guarda WebP en `site/img/`); la de «Word» se hace con el mismo motor con guiones y microtipografía apagados y `firstFit`. Sin barra deslizante (no hay JavaScript): lado a lado, con pie.
   - **Tres pasos**, cada uno con una captura real de la app (hechas con Playwright en `tools/landing-shots.ts`): «1. Sube tu Word», «2. Elige un estilo», «3. Descarga y publica».
   - **Lo que descargas:** PDF de imprenta, cubierta completa, EPUB. Con `{{downloads}}`.
   - **Comparación:** tabla con Book Studio, Vellum, Atticus y Kindle Create; filas: precio, dónde funciona, necesita cuenta, cubierta completa, español. Datos solo de `docs/web-launch/FACTS.md`, con enlace a la guía `vellum-atticus-kindle-create`.
   - **Privacidad:** el párrafo actual.
   - **Preguntas frecuentes** (6, también como `FAQPage` en JSON-LD): ¿es gratis de verdad?, ¿qué necesito?, ¿sirve para tapa dura?, ¿y las imágenes?, ¿puedo usarlo sin conexión?, ¿qué pasa con mi manuscrito?
   - **Guías:** `{{guides}}`.
3. `site/site.css`: estilos de la portada; móvil primero; sin tipos de letra externos.
4. App, `src/web/main.ts`: el parámetro `?start=import` abre «Mis libros» con el selector de archivo de importación ya enfocado y, si el navegador lo permite, abierto.
5. Raíz del sitio: cuando no hay libros guardados ni parámetros, la pantalla vacía de «Mis libros» (`src/web/projects.ts`) muestra el mismo titular, una zona «Suelta aquí tu Word» (arrastrar y soltar, y clic) y el enlace al ejemplo. Soltar un `.docx`, `.md` o `.txt` lo importa y abre el libro con la vista previa.
6. Pruebas: `tests/site.test.ts` (la portada de cada idioma tiene un solo `h1`, el botón principal, la tabla de comparación y 6 preguntas; sigue sin cargar nada de otro servidor); e2e: soltar `tests/fixtures/docx/spanish-patterns.docx` en la pantalla vacía acaba con la vista previa visible y el botón de exportar PDF activo; axe sin fallos en la pantalla vacía y en `/es/`.
7. No escribir «calidad de editorial» ni «igual que Vellum» si T1.3 no alcanzó sus metas; usar entonces «maquetación profesional».

**Hecho cuando:** pruebas verdes; `dist/web/es/index.html` pesa menos de 60 KB sin imágenes; capturas de móvil y escritorio en el PR.

**PR:** `Book Studio: landing page and drop-your-Word first screen`.

### T2.2 Asistente de 4 pasos

**Pasos:**

1. Tras importar desde la pantalla vacía, la app muestra una barra de 4 pasos sobre el espacio de trabajo: «1 Sube», «2 Estilo», «3 Datos», «4 Descarga». Archivo nuevo `src/web/wizard.ts`; estado guardado en el proyecto (`project.onboarding: 1 | 2 | 3 | 4 | "done"`), con migración en `src/project/model.ts` (proyectos antiguos: `"done"`).
2. Paso 2: rejilla de los estilos gratis con una miniatura real de la primera página del capítulo 1 en cada estilo (canvas reducido), y selector de formato de página con 6 × 9 preseleccionado.
3. Paso 3: el formulario de `src/web/details.ts` reducido a título, autor, idioma y descripción; el resto en «Más datos».
4. Paso 4: los tres botones de descarga (PDF, cubierta, EPUB) y la lista de comprobación de `src/web/publish.ts`.
5. «Saltar» en cada paso; la barra desaparece al completar o saltar.
6. e2e nuevo, «del Word al PDF»: importar un `.docx` de 60.000 palabras generado en la prueba (con `jszip`, como hacen las pruebas de importación), recorrer los 4 pasos con no más de 4 clics además de escribir el título, descargar el PDF y comprobar `checkKdpPdf`. Medir el tiempo de máquina y fallar si pasa de 60 s en CI.

**Hecho cuando:** pruebas verdes; vídeo de 30 a 45 s del recorrido grabado con Playwright (`recordVideo`) y guardado en `/mnt/project-files/book-studio-vellum/` (no en el repositorio).

**PR:** `Book Studio: four-step first-book wizard`.

---

### HILO C: Word sin pérdidas

Antes de empezar: leer `src/project/import-docx.ts` entero y `tests/fixtures/docx/README.md`.

- **T3.1 Garantía de palabras.** Función pura `countWords(texto)` en `src/project/import-text.ts` (palabras = secuencias de letras o cifras Unicode). `importDocx` cuenta las palabras del XML de origen (cuerpo, notas, tablas y cajas de texto; sin comentarios ni texto eliminado) y las del libro resultante, y devuelve `report.words = { source, book, missing: { texto, lugar }[] }`. La pantalla de importación muestra «N palabras en tu Word, N en tu libro» en verde, o la lista de lo que falta. Prueba: en los 5 archivos actuales la diferencia solo viene de lo que el informe ya declara como omitido. PR: `Book Studio: word-count guarantee on import`.
- **T3.2 Tablas, cajas de texto y alineación.** Tablas a tablas Markdown (el motor ya las maqueta: ver el caso `table` en `blocks.ts`); celdas combinadas se repiten y se avisa. Cajas de texto a cita en bloque con aviso. Párrafos centrados y a la derecha: sintaxis nueva `{.center}` y `{.right}` al final del párrafo, leída en `markdown.ts` y aplicada en `blocks.ts`. Versalitas, tachado, superíndice y subíndice. Tras esta orden, `tables` y `textBoxes` dejan de ser omisiones y la garantía de palabras de T3.1 da diferencia 0 en los archivos de prueba que solo tenían eso. PR: `Book Studio: tables, text boxes and alignment from Word`.
- **T3.3 Estructura y limpieza.** Reconocer por título, en español e inglés: dedicatoria, prólogo, prefacio, introducción, epílogo, agradecimientos, sobre el autor, y partes («Parte I», «Primera parte»). Separadores de escena: párrafo con solo `*`, `***`, `* * *`, `#`, `~`, o dos o más párrafos vacíos seguidos. Versos: párrafos con saltos de línea manuales se conservan línea a línea. Limpieza: dobles espacios, tabulador o espacios al inicio de párrafo, párrafos vacíos, saltos de línea manuales en mitad de frase (solo si la línea anterior no acaba en puntuación y hay más de 20 seguidos así). Estilos propios: si más del 5 % de los párrafos usa un estilo desconocido cuyos párrafos son cortos y van seguidos de texto normal, preguntar una vez en la pantalla de importación si son títulos de capítulo. PR: `Book Studio: structure detection and cleanup on import`.
- **T3.4 Más orígenes.** Archivos de prueba guardados por LibreOffice en modo Word 2010–365, exportados de Google Docs (si el entorno no puede crearlos, hacer a mano el XML con las particularidades conocidas: estilos con nombre `Heading1` sin espacio, listas con `numId` sin estilo, imágenes en `wp:anchor`), `.odt` (nuevo `src/project/import-odt.ts`, mismo informe) y `.rtf` básico (texto, negrita, cursiva, párrafos; nuevo `import-rtf.ts`). 20 archivos de prueba más, cada uno con su resultado esperado, hasta 30 con los existentes y los de T3.2. PR: `Book Studio: import from Google Docs, LibreOffice, ODT and RTF`.
- **T3.5 Exportar a Word.** `src/project/export-docx.ts`: libro a `.docx` con estilos `Title`, `Heading 1`, `Normal`, notas al pie e imágenes, con `jszip`. Botón en el menú del libro. Prueba de ida y vuelta: exportar e importar da el mismo Markdown en los 5 libros de prueba. Ecuaciones quedan fuera: apuntarlo. PR: `Book Studio: export the book back to Word`.

**Hecho cuando (hilo C):** los 30 archivos se importan con diferencia de palabras 0 y sin intervención.

### HILO D: Editor de cubiertas

Antes de empezar: leer `src/engine/cover/` entero y `tests/cover.test.ts`.

- **T4.1 Números de KDP comprobados y modelo de cubierta.** Comprobar contra la ayuda oficial de KDP (buscar en la web «KDP paperback cover calculator» y «KDP cover template») el grosor por página de papel blanco, crema y color, el sangrado, la zona segura, el tamaño y posición del código de barras y el mínimo de páginas para texto en el lomo; corregir `geometry.ts` y citar la fuente en un comentario y en `FACTS.md`. Modelo nuevo `CoverDesign` en `src/engine/cover/design.ts`: fondo (color, degradado, imagen o generativo), y capas de texto e imagen con posición relativa a su panel (portada, lomo, contraportada), tipo de letra, tamaño, color y alineación. `composeCover` dibuja un `CoverDesign`; el diseño actual pasa a ser la plantilla `simple`. Se guarda en el proyecto. PR: `Book Studio: verified KDP cover numbers and a layered cover model`.
- **T4.2 Plantillas y cubiertas generativas.** 8 plantillas gratis y 12 Pro en `src/engine/cover/templates.ts`, como funciones `(libro, geometría) => CoverDesign`. Fondos generativos en `src/engine/cover/generative.ts`: 6 familias (franjas, círculos concéntricos, rejilla de triángulos, ondas, bloques de color, constelación), deterministas a partir de una semilla (título + autor + número de variante) y dibujadas con `RectDraw` y dos tipos de dibujo nuevos, `PathDraw` y gradiente, añadidos a `types.ts`, `pdf.ts` y `canvas.ts`. Prueba: la misma semilla da el mismo dibujo; ninguna capa de texto sale de la zona segura en 3 formatos y 3 grosores; contraste del título de 4,5 a 1 o más contra el fondo bajo él. PR: `Book Studio: cover templates and generative backgrounds`.
- **T4.3 Editor.** `src/web/cover-editor.ts`: vista de la cubierta completa con guías (sangrado, zona segura, lomo, código de barras); elegir plantilla y variante generativa; editar textos; subir imagen, recortarla y moverla, con control de oscurecer o aclarar; mover capas con ratón y con flechas; alinear a guías; deshacer y rehacer; avisos en vivo (texto fuera de zona segura, imagen por debajo de 300 ppp, lomo demasiado estrecho para texto). Accesible con teclado; axe sin fallos. PR: `Book Studio: cover editor`.
- **T4.4 Contraportada y salidas.** Sinopsis, biografía y foto del autor, logotipo de editorial, código de barras del ISBN o hueco. Salidas: PDF de cubierta, JPG de portada de 1600 × 2560 para el ebook (y uso como cubierta del EPUB) y PNG de 1200 × 630 para redes. Prueba: tamaño de página del PDF igual al de `coverGeometry` en 9 combinaciones. PR: `Book Studio: back cover, barcode and cover exports`.
- **T4.5 Cubierta en el asistente.** Paso nuevo «Cubierta» entre «Datos» y «Descarga», que propone 4 cubiertas ya hechas con el título y autor del libro; un clic elige una. e2e: del Word a PDF y cubierta en no más de 6 clics. PR: `Book Studio: cover step in the wizard`.

**Hecho cuando (hilo D):** las 20 plantillas pasan las comprobaciones en 3 formatos y 3 grosores.

### HILO E: Estilos y paridad

- **T5.1 Cuatro estilos generales gratis** (`literary`, `minimal`, `memoir`, `textbook`) en `themes.ts`, con solo los tipos de letra ya incluidos. Cada uno con su página dorada.
- **T5.2 Doce estilos de género Pro** (dos por género: romántica, negra, fantasía, ciencia ficción, infantil, poesía) con adornos de escena y aperturas de capítulo propias; apertura de capítulo con imagen (`chapter-image:` en la nota del capítulo).
- **T5.3 Editor de estilo:** tamaño de letra, interlínea, márgenes, sangría, adorno de escena y capitular, gratis; guardar como estilo propio y cargar tipos de letra propios, Pro.
- **T5.4 Formatos:** los 4 formatos de KDP que faltan y tapa dura (comprobar medidas y márgenes en la ayuda oficial; geometría de cubierta de tapa dura en `geometry.ts`).
- **T5.5 Vista previa de ebook** en marcos de Kindle, móvil y tableta (el EPUB dentro de un `iframe` con tamaño fijo y los CSS del libro), y salida PDF/X para otras imprentas (Pro): comprobar primero si `pdf-lib` permite `OutputIntent`; si no, apuntarlo y dejarlo fuera.

### HILO F: Lanzamiento

- **T6.1** Vídeos para X (uno por hilo terminado) a partir de las grabaciones de Playwright, con el texto del post, en `/mnt/project-files/book-studio-vellum/`. Publicar solo con OK de Enrique.
- **T6.2** Seis guías nuevas en `site/es` y `site/en`: alternativa gratis a Vellum, Vellum para Windows, maquetar un libro para Amazon gratis, hacer la cubierta de un libro para KDP, pasar de Word a libro, tamaños y lomo.
- **T6.3** Enlace a Book Studio desde el catálogo de github.io y los README de los plugins; borradores de fichas para directorios de alternativas, que se envían con OK de Enrique.
