---
title: "De Markdown a libro: notas de Obsidian a PDF y EPUB"
description: "Convierte una carpeta de notas en Markdown, de Obsidian o de cualquier editor, en un PDF de imprenta y un EPUB 3 con una sola nota que lista tus capítulos."
slug: markdown-a-libro
pair: markdown-to-book
updated: 2026-11-02
type: article
order: 4
---
Para pasar de Markdown a libro, guarda cada capítulo en su propia nota y añade una «nota de libro» que los enumera en orden. Book Studio lee esa nota y construye un PDF de imprenta y un EPUB 3. Sirve con una bóveda de Obsidian o con cualquier carpeta de archivos `.md`, y puedes [abrir la app](app:) para probarlo con un libro de muestra.

## La idea

Muchas personas que escriben en Markdown ya tienen una nota por capítulo. Book Studio añade una más, la nota de libro. Lleva `book: true` en las propiedades y enumera los capítulos como enlaces `[[así]]` bajo tres encabezados. El orden de los enlaces es el orden del libro.

## Una nota de libro mínima

```markdown
---
book: true
title: El camino del farol
author: Ana Ejemplo
language: es
publisher: Editorial Ejemplo
theme: classic
trim: 6x9
---

## Preliminares

- [[Dedicatoria]]

## Capítulos

### Parte primera

1. [[Capítulo 1]]
2. [[Capítulo 2]]

### Parte segunda

3. [[Capítulo 3]]

## Parte final

- [[Agradecimientos]]
```

Las propiedades guardan el título, el autor, el idioma, la editorial, los ISBN, los derechos, la dedicatoria, el epígrafe, la cubierta, el tema y el formato. Rellena solo las que uses. Los encabezados en español son `## Preliminares`, `## Capítulos` y `## Parte final`; también valen los ingleses `## Front matter`, `## Chapters` y `## Back matter`. Un encabezado `### Parte …` crea una página de parte.

## Qué pasa con el resto

Cada nota enlazada se convierte en un capítulo, en un preliminar o en una página final. La nota de libro también genera las páginas que rodean al texto: anteportada, portada, página de derechos, dedicatoria, epígrafe e índice. Las notas al pie pasan a notas finales bajo «Notas». Para saber qué hace el motor de maquetación con el texto, mira [formatear un libro para KDP gratis](guide:formatear-libro-kdp-gratis).

## Imágenes

Escribe las imágenes como siempre en Markdown y ponles una descripción:

```markdown
![Un farol encendido sobre un camino de piedra](camino.png)
```

El texto entre corchetes pasa a ser el texto alternativo en el EPUB. La [guía de EPUB accesible](guide:epub-accesible) explica por qué importa. Una imagen que falta o un enlace roto aparecen en la pestaña de Problemas, con la nota y la línea.

## Abrir tu carpeta

En Chrome y Edge, la app usa el selector de carpetas y puede reabrir la última que usaste. En otros navegadores eliges la carpeta desde el diálogo de archivos. En ambos casos los archivos se quedan en tu dispositivo. Las exportaciones se descargan como archivos.

Si usas Obsidian, el plugin de Book Studio hace lo mismo dentro de Obsidian, en escritorio y en móvil. Está en [obsidian.md/plugins](https://obsidian.md/plugins?id=book-studio).

## Mira una fuente terminada

La mejor forma de aprender el formato es leer uno real. Descarga la fuente en Markdown del libro de muestra en español: la [carpeta fuente de Leyendas y rimas](download:leyendas/zip). Abre su nota de libro y compárala con el [PDF de imprenta](download:leyendas/pdf) que produce.

## Resultado

Obtienes un PDF interior listo para KDP y un EPUB 3. El plan gratuito imprime en 6 × 9, 5 × 8 y 5,5 × 8,5 pulgadas con los temas Classic y Modern. Book Studio Pro añade nueve formatos más y más temas (pago único): [ver Pro](pro:). Para elegir tamaño, lee [tamaños de KDP](guide:tamanos-kdp).

## Siguiente paso

¿Quieres el proceso completo, de la carpeta a la subida? Sigue [cómo formatear un libro para KDP](guide:como-formatear-un-libro-para-kdp). O [abre la app](app:) y carga tus notas.
