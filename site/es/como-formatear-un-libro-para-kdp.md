---
title: "Cómo formatear un libro para KDP paso a paso, gratis"
description: "Formatea tu libro en tapa blanda y ebook para Amazon KDP en siete pasos, de notas en Markdown a PDF listo para imprenta y EPUB 3, con una app gratuita."
slug: como-formatear-un-libro-para-kdp
pair: format-a-book-for-kdp
updated: 2026-11-02
type: howto
order: 6
steps:
  - Escribe los capítulos como notas
  - Crea la nota de libro
  - Elige el tamaño de corte
  - Abre tu carpeta en la app
  - Corrige los problemas
  - Exporta el PDF y el EPUB
  - Revisa y sube a KDP
---
Para formatear un libro para KDP necesitas un PDF interior listo para imprenta, con el tamaño de corte y los márgenes correctos, y un EPUB para el ebook. Con estos pasos consigues los dos desde notas en Markdown y una herramienta gratuita. Puedes [abrir la app](app:) en otra pestaña y seguirlos con el libro de muestra.

## 1. Escribe los capítulos como notas

Guarda una nota en Markdown por capítulo, en el editor que prefieras. Obsidian funciona bien, y también una carpeta normal de archivos `.md`. Ve añadiendo las descripciones de imagen mientras escribes: `![descripción](imagen.png)`.

## 2. Crea la nota de libro

Añade una nota más con `book: true` en las propiedades. Bajo `## Preliminares`, `## Capítulos` y `## Parte final`, enumera tus notas como enlaces `[[así]]`. Pon el título, el autor, el idioma, la editorial, los ISBN y los derechos en sus propiedades. El formato está en [de Markdown a libro](guide:markdown-a-libro).

## 3. Elige el tamaño de corte

Decide el formato antes que nada, porque de él dependen el número de páginas y los márgenes. El plan gratuito imprime en 6 × 9 pulgadas, el tamaño de tapa blanda más habitual en KDP, y en 5 × 8 y 5,5 × 8,5. Book Studio Pro añade nueve formatos más (pago único): [ver Pro](pro:). Todos los formatos, la tabla de márgenes y las reglas de sangrado están en [tamaños de KDP: corte, márgenes y sangrado](guide:tamanos-kdp).

El margen interior (medianil) depende del número de páginas, y Book Studio lo fija por ti:

| Número de páginas | Margen interior |
|---|---|
| 24–150 | 0,375 in (9,6 mm) |
| 151–300 | 0,5 in (12,7 mm) |
| 301–500 | 0,625 in (15,9 mm) |
| 501–700 | 0,75 in (19,1 mm) |
| 701–828 | 0,875 in (22,3 mm) |

## 4. Abre tu carpeta en la app

En la app, elige tu carpeta. Chrome y Edge usan el selector de carpetas y pueden reabrir la última. Otros navegadores usan el diálogo de archivos. No se sube nada: el trabajo ocurre en tu dispositivo. La vista previa muestra páginas enfrentadas y permite acercar con el zoom.

## 5. Corrige los problemas

Abre la pestaña de Problemas. Lista enlaces rotos e imágenes que faltan, con la nota y la línea. Si una imagen no tiene descripción, la comprobación de accesibilidad la marca. Corrígelos en tus notas.

Decide aquí el sangrado. Solo lo necesitas si una imagen o un color llega al borde de la página. Con sangrado, una página de 6 × 9 pasa a 6,125 × 9,25 in. La mayoría de los libros de solo texto no lo necesitan.

## 6. Exporta el PDF y el EPUB

Exporta el PDF de imprenta y el EPUB. Book Studio construye los preliminares y las páginas finales, aplica el margen interior de tu número de páginas, incrusta las fuentes y rellena el libro hasta el mínimo de 24 páginas de KDP. También te da el ancho del lomo. Lo necesita quien diseñe tu cubierta, porque el plan gratuito no incluye diseñador de cubiertas.

El EPUB lleva un índice navegable, el idioma del libro en cada página y tus descripciones de imagen. Para ver qué se comprueba, lee la [guía de EPUB accesible](guide:epub-accesible).

## 7. Revisa y sube a KDP

Abre el PDF y recórrelo página a página. Mira la primera página de cada capítulo, el índice y las imágenes. Compáralo con un ejemplo terminado: el [PDF de muestra](download:leyendas/pdf) y el [EPUB de muestra](download:leyendas/epub).

Después sube el PDF como interior de tu tapa blanda y el EPUB como manuscrito de tu ebook en KDP. KDP acepta un PDF listo para imprenta como interior y exige fuentes incrustadas. La cubierta es otro archivo. La página de KDP sobre [tamaño de corte, sangrado y márgenes](https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6) (en inglés) es la referencia final, así que léela una vez antes de enviar.

## Si algo no cuadra

Mira primero el número de páginas. Si superó un umbral de la tabla de arriba, el margen interior cambió y el texto se reflujo. Después revisa el formato de corte. Después, las imágenes. Si comparas otras herramientas, mira [Book Studio frente a Vellum, Atticus y Kindle Create](guide:vellum-atticus-kindle-create).

Para un resumen de lo que hace la app, lee [formatear un libro para KDP gratis](guide:formatear-libro-kdp-gratis), o vuelve a [todas las guías](hub:).

¿Listo para exportar? [Abre la app](app:) y carga tu carpeta.
