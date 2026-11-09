# Book Studio como «Vellum gratis, en el navegador y en español»: plan de creación

Fecha: 2026-11-09. Solo plan: nada de esto está construido todavía. El avance se apunta en `docs/VELLUM-PROGRESS.md`.

## 1. La meta en una frase

Un autor sube su Word, elige un estilo y en 10 minutos descarga el interior, la cubierta y el ebook listos para Amazon KDP, con calidad de editorial, sin instalar nada, sin cuenta y gratis.

Lo que se le promete al autor, en este orden:

1. **Se ve como un libro de editorial.** Nadie debe poder distinguir una página nuestra de una de Vellum.
2. **No pierdo nada de mi Word.** Lo que escribí está todo ahí, y la app me lo demuestra.
3. **Tengo la cubierta completa.** Portada, lomo y contraportada con las medidas exactas de KDP.
4. **Es rápido y es mío.** 10 minutos, en mi navegador, sin subir el manuscrito a ningún sitio.

## 2. Dónde estamos hoy (medido el 2026-11-09 sobre los dos libros de muestra)

Book Studio ya tiene una base buena: parte las líneas con el mismo método que TeX, tiene guiones en 7 idiomas, evita viudas y huérfanas, importa Word básico y dibuja la cubierta completa (hoy en Pro). Lo que lo separa de Vellum se ve en estos números:

| Qué se mide | *El mago de Oz* (inglés) | *Leyendas* de Bécquer (español) | Meta |
|---|---|---|---|
| Páginas de texto que acaban más cortas que las demás | 28 de 91 | 33 de 109 | 0, salvo fin de capítulo |
| Dobles páginas con alturas distintas (izquierda y derecha desiguales) | 15 | 25 | 0 |
| Tres o más líneas seguidas acabadas en guion | 0 | 9 | 0 |
| Líneas con huecos muy grandes entre palabras | 1 | 13 | 0 |
| Líneas con huecos grandes | 19 de 2.770 | 27 de 3.439 | menos de 1 de cada 500 |
| Tiempo de maquetar el libro entero | 0,65 s | 0,74 s | menos de 1,5 s para 300 páginas |

Traducción: hoy evitamos las viudas dejando páginas cortas. Eso es justo lo que delata a un libro autopublicado: abres el libro y la página izquierda y la derecha no acaban a la misma altura. En español, además, hay demasiados guiones seguidos y huecos. Ese es el trabajo del motor nuevo.

Otras faltas frente a Vellum: la página de inicio explica pero no vende, el Word pierde tablas y cajas de texto, la cubierta no tiene editor (solo coloca una imagen y textos fijos) y solo hay 8 estilos.

## 3. Decisiones que he tomado por ti (dijiste que aplicara mi recomendación)

Todas se pueden cambiar; ninguna se ejecuta hasta la fase que la toca.

1. **Qué es gratis.** Todo lo que un autor necesita para publicar *un* libro en KDP: todos los formatos de página, la cubierta completa con editor, notas al pie y los estilos básicos. Sin esto no se puede decir «Vellum gratis» con honestidad. Pro (apagado) se queda con lo que multiplica a un autor profesional: colecciones y series, varias ediciones de una vez, índice analítico, paquete de EPUB accesible, estilos y cubiertas de género prémium, y salida para imprentas fuera de Amazon. Nunca se cobrará por algo que ya haya sido gratis.
2. **La web es el producto.** El plugin de Obsidian recibe el motor nuevo porque comparte código, pero no se sube su versión mientras Pro esté apagado.
3. **Español primero.** La página de inicio, los ejemplos y las reglas tipográficas se hacen primero en español y luego en inglés.
4. **Sin analítica.** Se mantiene la promesa de «sin cuentas, sin cookies, sin analítica». El alcance se mide con Search Console y las estrellas y visitas del repositorio.
5. **Sin IA dentro del producto.** Coste cero por usuario, para siempre.
6. **Orden.** Motor, página de inicio, Word, cubiertas, estilos, lanzamiento. El motor va primero porque todo lo demás enseña páginas hechas con él.

## 4. Las fases

Cada fase es un hilo propio con un máximo de 5 PRs. Cada PR se fusiona solo con todas las pruebas pasadas y deja la web publicada. «Sesiones» es una estimación de sesiones largas de trabajo.

| Fase | Qué entrega | Sesiones |
|---|---|---|
| 0 | Banco de pruebas de calidad | 0,5 |
| 1 | Motor tipográfico nuevo | 3 |
| 2 | Página de inicio «en 10 minutos» y asistente de 4 pasos | 1,5 |
| 3 | Word sin pérdidas | 2 |
| 4 | Editor de cubiertas | 3 |
| 5 | Estilos de género y paridad con Vellum | 2 |
| 6 | Lanzamiento | 1 |

### Fase 0. Banco de pruebas de calidad

Sin esto no se puede demostrar que el motor mejora ni evitar que empeore después.

- **0.1 Marcador de calidad.** El motor devuelve, junto al libro, las cifras de la tabla de arriba (`Layout.quality`). Se calculan dentro del motor, no mirando el PDF.
- **0.2 Seis libros de prueba** de dominio público, elegidos para romper cosas: novela en inglés (Oz, ya está), cuentos en español (Leyendas, ya está), novela española con mucho diálogo con rayas, poesía, ensayo con notas al pie y citas largas, y un libro en francés o alemán con palabras largas.
- **0.3 Orden `npm run quality`** que imprime la tabla de los seis libros y falla si una cifra empeora respecto a la guardada en `tests/quality-baseline.json`.
- **0.4 Páginas doradas.** 12 dobles páginas guardadas como imagen; una prueba avisa si cambia un píxel sin haberlo decidido.

Hecho cuando: la tabla sale en CI local y en el PR, con los números de hoy como punto de partida.

### Fase 1. Motor tipográfico nuevo

Cinco piezas, una por PR. El orden importa: cada una se apoya en la anterior.

**1.1 Líneas (PR 1).** El párrafo se sigue partiendo «de una vez» buscando el mejor conjunto de líneas, pero con las reglas que usa una editorial:

- Márgenes ópticos: guiones, puntos, comas y comillas sobresalen un poco del margen para que el borde se vea recto.
- Letras elásticas: cada línea puede estrechar o ensanchar sus letras hasta un 2 %, invisible al ojo, para no abrir huecos entre palabras.
- Como mucho dos líneas seguidas acabadas en guion.
- La última línea de un párrafo nunca es una sílaba suelta ni una palabra corta sola.
- No se parte la última palabra de un párrafo.
- Se intenta primero sin guiones, pero solo se acepta si queda muy bien; si no, con guiones. Hoy se acepta un resultado mediocre sin guiones.
- El motor puede dar el mismo párrafo con una línea más o una menos. Esto es la llave de la pieza 1.3.

**1.2 Guiones por idioma (PR 2).**

- Mínimos por idioma (en español se puede dejar «ca-» al final; en inglés hacen falta tres letras al principio de la línea siguiente).
- Idiomas nuevos: catalán, gallego y euskera (las lenguas de España) y neerlandés. Los diccionarios se cargan solo cuando el libro usa ese idioma, para que la app no pese más.
- Reglas del español: no dejar una vocal sola, no partir dejando palabras malsonantes («espectá-culo», «dis-puta»), no partir siglas ni números, penalizar partir nombres propios.
- Lista de excepciones por idioma y una forma de que el autor diga «esta palabra no se parte» o «pártela aquí».
- Texto en otro idioma dentro del libro (una cita en inglés en un libro en español) usa los guiones de su idioma.

**1.3 Páginas (PR 3).** Es el cambio que más se nota.

- Las dos páginas de una doble página acaban siempre a la misma altura.
- Viudas y huérfanas se arreglan como lo hace un maquetador: se recompone un párrafo de la página con una línea más o menos, eligiendo el que menos lo nota. Solo si no hay arreglo, la doble página entera se acorta una línea, las dos a la vez.
- La última página de un capítulo tiene al menos 4 líneas.
- Una página derecha no acaba en palabra partida (no se pasa de página a media palabra).
- Un título nunca queda al pie de una página y lleva al menos 2 líneas debajo.
- Todo sigue alineado a una rejilla: las líneas de la página izquierda y la derecha quedan a la misma altura.

**1.4 Ortotipografía (PR 4).** Los detalles que un corrector español mira:

- Diálogos con raya: la raya pegada a la palabra, sin que se quede sola a final de línea.
- Espacios que no se rompen: «Sr. García», «20 km», «pág. 3», «siglo XIX», «¿…?».
- Siglos y siglas en versalitas; cifras de estilo antiguo en el texto y de caja alta en tablas.
- Comillas en su orden («…“…‘…’…”…»), puntos suspensivos y rayas corregidos al importar.
- Capitulares mejores: comilla o raya inicial delante de la letra grande, y el texto ceñido a la forma de la letra.
- El EPUB recibe lo que le toca: mismos guiones opcionales, mismas correcciones, y reglas para que el lector de ebooks evite viudas.

**1.5 Velocidad (PR 5).**

- El libro se maqueta por capítulos y se guarda cada capítulo ya hecho: al escribir solo se rehace el capítulo tocado.
- La maquetación corre en segundo plano (un «worker»), para que la escritura nunca se trabe.
- Presupuesto: 300 páginas en menos de 1,5 s la primera vez y menos de 150 ms al escribir.

Hecho cuando: los seis libros cumplen las metas de la tabla, las pruebas de siempre pasan (267 hoy), el PDF sigue pasando la comprobación de KDP, y hay un «antes y después» de 4 dobles páginas en el PR.

### Fase 2. Página de inicio «Tu libro listo para Amazon en 10 minutos»

La página no explica el producto: **es el primer paso del producto**.

- **Arriba del todo:** el titular, una frase y una caja grande «Suelta aquí tu Word». Al soltarlo, el autor ve su propio libro maquetado en segundos, sin registrarse. Al lado, «Probar con un libro de ejemplo».
- **Antes y después:** una misma página, a la izquierda como sale de Word y a la derecha como sale de Book Studio, con una barra que se arrastra. Hecha con el motor real, no con un dibujo.
- **Tres pasos** con una captura real cada uno: sube, elige estilo, descarga.
- **Lo que descargas:** PDF de imprenta, cubierta completa y EPUB, con los dos libros de muestra para bajar.
- **Comparación honesta** con Vellum (249,99 USD, solo Mac), Atticus (147 USD) y Kindle Create, con los datos de `docs/web-launch/FACTS.md` y sus fuentes.
- **Privacidad** como argumento de venta: el manuscrito nunca sale del ordenador.
- **Preguntas frecuentes** que también sirven para buscadores: ¿es gratis de verdad?, ¿sirve para tapa dura?, ¿y si mi libro tiene imágenes?
- **Vídeo de 30 a 45 segundos** del recorrido completo, grabado de la app real. Sirve también para X.
- En español e inglés, cada una con su URL, y pensada para móvil.

Dentro de la app, un **asistente de 4 pasos** para quien llega por primera vez: Sube, Estilo, Datos del libro, Descarga. Quien ya tiene libros entra directo a «Mis libros».

La promesa de los 10 minutos se prueba: una prueba automática hace el recorrido completo con un Word real de 60.000 palabras y mide el tiempo de máquina (meta: menos de 20 s en total, lo demás es el autor eligiendo).

Hecho cuando: la página carga en menos de 1,5 s en móvil, cero fallos de accesibilidad, las pruebas de navegador pasan, y soltar un Word en la portada acaba en un PDF descargado sin más de 4 clics.

### Fase 3. Word sin pérdidas

Hoy se pierden tablas, cajas de texto, ecuaciones y parte del formato. Meta: que el autor no tenga que tocar nada después de importar.

- **Garantía de palabras:** al importar, la app cuenta las palabras del Word y las del libro y lo enseña: «78.412 palabras en tu Word, 78.412 en tu libro». Si falta una, dice cuál y dónde. Ningún competidor lo hace.
- **Lo que hoy se pierde y dejará de perderse:** tablas, cajas de texto (pasan a recuadros), texto centrado y a la derecha, versalitas, tachado, subíndices, versos y poemas (saltos de línea que se respetan), separadores de escena (`***`, líneas en blanco, adornos centrados), imágenes con su pie, notas al pie y notas finales, y estilos propios del autor (se le pregunta una vez «tu estilo “Cap” ¿es un título de capítulo?»).
- **Detección de estructura:** portada, dedicatoria, prólogo, partes, capítulos, epílogo, agradecimientos y «sobre el autor» reconocidos por su título, en español e inglés.
- **Limpieza automática:** dobles espacios, tabuladores usados como sangría, saltos de línea en mitad de párrafo, comillas rectas, guiones usados como rayas.
- **Más orígenes:** Word de verdad, Google Docs, LibreOffice, Pages (exportado a .docx), Scrivener (compilado a .docx), `.odt` y `.rtf`.
- **Ida y vuelta:** exportar el libro otra vez a Word, para mandarlo a un corrector.
- **Informe de importación** claro: qué se convirtió, qué se adaptó y qué conviene revisar, con enlace a cada sitio.
- Ecuaciones: se conservan como imagen en el PDF y como MathML en el EPUB. Es lo último de la fase y puede quedar fuera.

Pruebas: una colección de 30 archivos reales de dominio público o hechos a propósito, cada uno con su resultado esperado guardado, y la garantía de palabras al 100 % en todos.

Hecho cuando: los 30 archivos se importan sin perder una palabra y sin intervención.

### Fase 4. Editor de cubiertas

KDP exige una cubierta en PDF con medidas exactas; hoy es lo que más autores resuelven pagando. Todo en el navegador.

- **Cubierta completa en vivo:** portada, lomo y contraportada en una sola vista. El lomo se calcula solo con las páginas y el papel, y se recalcula si el libro crece.
- **20 plantillas por género** (novela romántica, negra, fantasía, ensayo, infantil, poesía, autoayuda…), cada una con sus tipos de letra y su composición.
- **Cubiertas generativas:** a partir del título y el género, la app dibuja fondos únicos (geométricos, degradados, texturas, ilustración por formas). Sin fotos de terceros, sin IA, sin coste y sin dos iguales. Es la idea original de esta fase.
- **Imagen propia:** subir, recortar, mover, oscurecer o aclarar para que el título se lea, con aviso si no llega a 300 ppp.
- **Texto:** título, subtítulo, autor, frase de reclamo, sinopsis de contraportada, biografía y foto del autor, logotipo de editorial. Arrastrar, alinear con guías, deshacer.
- **Guías de KDP a la vista:** sangrado, zona segura, zona del código de barras y lomo. Aviso si algo se sale o si el lomo es demasiado estrecho para llevar texto.
- **Código de barras** del ISBN dibujado, o el hueco para el de KDP.
- **Salidas:** PDF de cubierta para tapa blanda, JPG de portada para ebook (1600 × 2560) y miniatura para redes.
- Usable con teclado y con lector de pantalla.

Los números de KDP (grosor del lomo, margen del código de barras, lomo con texto desde 79 páginas) hoy no están comprobados con las plantillas oficiales. Se comprueban en esta fase, antes de publicar el editor.

Hecho cuando: una cubierta hecha con cada plantilla pasa la comprobación propia de medidas en 3 tamaños y 3 grosores, y un autor hace una cubierta completa en menos de 5 minutos.

### Fase 5. Estilos de género y paridad con Vellum

- De 8 a 24 estilos de interior, con aperturas de capítulo con imagen, adornos entre escenas y cabeceras distintas.
- Editor de estilo: cambiar tipo de letra, tamaño, márgenes y adornos sin tocar código, y guardarlo como estilo propio.
- Los 16 formatos de KDP y tapa dura.
- Letra grande como edición con un clic.
- Vista previa del ebook en marcos de Kindle, móvil y tableta.
- Colecciones: página «Otros libros del autor» que se actualiza sola en todos sus libros.
- Salida para otras imprentas (IngramSpark, Draft2Digital).

### Fase 6. Lanzamiento

- Un vídeo para X por cada fase terminada, del producto real.
- Guías nuevas para buscadores: «alternativa gratis a Vellum», «Vellum para Windows», «maquetar un libro para Amazon gratis», en español e inglés.
- Fichas en directorios de alternativas y en comunidades de autores autopublicados (cada publicación con tu OK).
- Los 36 plugins y las demás webs enlazan a Book Studio.

## 5. Cómo se gana dinero después (apagado hasta que tú digas)

- **Book Studio Pro (59 USD, pago único):** colecciones y series, varias ediciones en una exportación, índice analítico, paquete de EPUB accesible, salida para otras imprentas.
- **Packs de género (12 USD):** estilos de interior y plantillas de cubierta prémium por género.
- **Más adelante:** plantillas hechas por diseñadores con reparto de ingresos.
- Cada pieza nace con su interruptor ya puesto en `src/engine/entitlements.ts`, apagado.

## 6. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Que el PDF no llegue a la calidad de Vellum | El marcador de calidad y las páginas doradas; no se anuncia «calidad de editorial» hasta cumplir las metas |
| Que el motor nuevo sea lento | Presupuesto de tiempo como prueba; caché por capítulo |
| Que un Word raro salga mal | Garantía de palabras e informe de importación; nunca se pierde nada en silencio |
| Que KDP rechace una cubierta | Comprobar los números con las plantillas oficiales antes de publicar el editor |
| Que la app pese demasiado | Diccionarios y tipos de letra cargados solo cuando hacen falta |
| Prometer de más | Cada frase de la web sale de `FACTS.md`; se actualiza en el mismo PR que cambia el producto |

## 7. Lo único que necesita Enrique

- Ya dado: permiso para fusionar y publicar en la web cuando todo esté en verde.
- Opcional: un Word suyo o de un conocido, guardado con Microsoft Word de verdad, para la fase 3.
- OK antes de cada publicación en X y en directorios.

## 8. Anexo técnico (para la sesión que construya)

Archivos y diseño ya pensados, para no volver a explorar.

**Estado actual.** `src/engine/linebreak.ts` (Knuth–Plass, `firstFit`), `hyphenate.ts` (7 idiomas, mínimos 2/3 fijos), `layout/inline.ts` (`ParagraphSetter`: tokeniza, crea cajas, pegamento y penalizaciones, y `lines()` coloca), `layout/blocks.ts` (`FlowBuilder.lineBoxes` pone `breakAfter = NO_BREAK` tras la línea 1 y la n−1), `layout/paginate.ts` (voraz: llena hasta el último corte permitido y deja la página corta), `layout/index.ts` (`compose`, `layChapter`).

**1.1 Líneas.**
- `linebreak.ts`: nueva `breakParagraph(items, opts): { breaks, demerits } | null`; `knuthPlass` queda como envoltorio. Campos nuevos: caja con `stretch`, `shrink`, `pl`, `pr`; penalización con `pr`. Opciones nuevas: `finalHyphenDemerits`, `maxHyphenRun` (el nodo lleva `run`), `lastLineMin` con `runtDemerits`, `lineCount`. La protrusión entra en `ratioFor` restando `rp[fin] + lp[inicio]`, con dos tablas calculadas una vez. Los nodos ya se agrupan por número de línea, así que conviven soluciones con distinto número de líneas y `lineCount` solo filtra al final.
- `inline.ts`: `BoxData` con `pl`/`pr` (tabla por carácter: guion 0,7; punto y coma 0,7; comillas 0,6; dos puntos 0,4; « » 0,3). `lines()` suma la protrusión al ancho y desplaza el inicio; reparte la razón entre pegamento y cajas (expansión 2 %; por encima de razón 1 las cajas se quedan en 2 % y el resto va al pegamento). `Piece.scale` y `TextDraw.scale`.
- `pdf.ts`: la escala horizontal va en la matriz `Tm`. `preview/canvas.ts`: `ctx.scale(s * scale, -s)`.
- Estrategia en `set()`: sin guiones con tolerancia 0,7; con guiones 1, 1,6, 2,5, 6; después `firstFit`. Nuevo `variant(delta)` con `lineCount = n ± 1` y tolerancia 1,3, que devuelve `null` si no existe.
- `SetLine.ratio` para el marcador.

**1.3 Páginas.**
- `VBox.group` en la primera línea de cada párrafo: `{ size, alt(delta): VBox[] | null }` con caché. `VBox.hyphenEnd`.
- `paginate.ts`: extraer `fill(items, i, capacidad)` del bucle actual. `layPage` prueba, cuando la página queda corta o una derecha acaba en guion, cada párrafo que empieza en la página (y el primero empujado fuera) con −1 y +1, y se queda con el arreglo más barato que la llene.
- Por dobles páginas: probar capacidad completa, −1 y −2 líneas para las dos; coste = diferencia de altura × 100 + reducción × 10. `paginate` recibe si la primera página es derecha (en `compose`, `list.length % 2`), con caché por capítulo y paridad.
- Fin de capítulo con menos de 4 líneas: rehacer desde la penúltima doble página aflojando hasta 3 párrafos.
- `FlowPage.stats` con líneas, flojas, guiones, escaleras, corta, guion al pasar página y párrafos ajustados; `compose` las suma en `Layout.quality`.
- Las notas al pie ya pasan por `fill`, así que el arreglo las respeta sin código extra.

**1.2 Guiones.** `hyphen` trae `ca`, `gl`, `eu`, `nl` (el neerlandés pesa 233 KB: carga con `import()`). Mínimos por idioma en una tabla. Lista de fragmentos vetados en español.

**Pruebas nuevas.** `tests/linebreak.test.ts` (protrusión, escalera, línea final corta, `lineCount`), `tests/paginate.test.ts` (dobles páginas iguales, arreglo por párrafo, fin de capítulo), `tests/quality.test.ts` contra `tests/quality-baseline.json`.

**Reglas que siguen valiendo.** No subir `manifest.json`. Pro apagado. Sin enlaces de sesión en commits ni PRs de este repositorio. Antes de fusionar: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run build:web`, `npm run e2e`.
