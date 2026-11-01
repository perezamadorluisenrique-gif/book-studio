---
title: "EPUB accesible: qué necesita y cómo exportarlo desde Markdown"
description: "Qué hace accesible a un EPUB, cómo validarlo con EPUBCheck y cómo Book Studio exporta un EPUB 3 limpio desde tus notas en Markdown."
slug: epub-accesible
pair: accessible-epub
updated: 2026-11-02
type: article
order: 2
---
Un EPUB accesible es el que puede usar igual de bien quien lee con lector de pantalla, con línea braille o con letra grande. Casi todo depende de una estructura limpia, y Markdown ya te la da en buena parte. Puedes [abrir la app](app:) y exportar un EPUB 3 desde tus notas.

## Qué hace accesible a un EPUB

La accesibilidad en un libro electrónico se reduce a unos pocos hábitos aplicados con constancia.

- **Estructura semántica.** Los títulos son títulos de verdad, las listas son listas y un párrafo es un párrafo. La tecnología de apoyo usa esa estructura para moverse por el libro. Un EPUB hecho solo de texto con estilos no ofrece nada por lo que navegar.
- **Índice navegable.** Quien lee puede saltar a cualquier capítulo, y el EPUB declara marcadores de estructura (landmarks), como la portada y el inicio del texto.
- **Idioma.** Si el idioma del libro está declarado, el lector de pantalla elige la voz y la pronunciación correctas. Importa sobre todo en libros bilingües o en un idioma distinto del inglés.
- **Descripciones de imagen.** Toda imagen que aporte información necesita una alternativa de texto. Las decorativas no.
- **Texto fluido.** Cada persona elige el tamaño de letra y los colores, y el libro no debe estorbar.

## Las descripciones salen de tu Markdown

En Markdown, la descripción es el texto entre corchetes:

```markdown
![Mapa de Toledo con el recorrido de la leyenda](mapa.png)
```

Book Studio usa ese texto como texto alternativo de la imagen en el EPUB. Escribe lo que necesita saber quien no ve la imagen, no el nombre del archivo. Si una imagen no tiene descripción, la comprobación de accesibilidad de Book Studio la marca, así que ves el hueco antes de exportar.

## Qué hace Book Studio

La app web gratuita escribe un EPUB 3 con:

- XHTML semántico,
- índice navegable y marcadores de estructura,
- fuentes incrustadas,
- portada,
- el idioma del libro en cada página,
- las descripciones de imagen tomadas de tu texto alternativo.

El idioma lo defines en las propiedades de la nota de libro. En [de Markdown a libro](guide:markdown-a-libro) verás dónde va.

## Compruébalo con EPUBCheck

EPUBCheck es el validador del W3C para archivos EPUB. Te dice si el paquete está bien formado. Los EPUB que exporta Book Studio pasan EPUBCheck 5.2.1 sin errores ni avisos, y los dos libros de muestra se vuelven a comprobar en cada compilación de este sitio.

Puedes pasar la misma comprobación a tu archivo. Descarga los ejemplos y compáralos: [el EPUB de Leyendas y rimas](download:leyendas/epub) y [el EPUB en inglés de Oz](download:oz/epub).

Que EPUBCheck lo dé por bueno significa que el archivo es válido. No garantiza que cada imagen tenga una buena descripción ni que el orden de lectura tenga sentido. Alguien tiene que leer el libro con un lector de pantalla o, al menos, revisar la estructura.

## La accesibilidad en Pro

El paquete de EPUB accesible de Book Studio Pro añade metadatos de accesibilidad, una declaración de conformidad y un informe. La estructura, el índice, el idioma y las descripciones de imagen de arriba están en el plan gratuito. Si necesitas algo más que un archivo limpio, ahí entra [Book Studio Pro](pro:) (pago único).

## Una nota sobre la ley

La Ley Europea de Accesibilidad (European Accessibility Act) se aplica a los libros electrónicos vendidos en la UE desde el 28 de junio de 2025. Esto no es asesoramiento jurídico: comprueba qué te afecta según dónde vendas.

## Dónde encaja en tu edición

Tu EPUB y tu PDF de imprenta salen de las mismas notas, así que corriges una descripción una vez y mejoran los dos. Para la parte impresa, lee [tamaños de corte, márgenes y sangrado de KDP](guide:tamanos-kdp). Para todo el proceso en orden, [cómo formatear un libro para KDP](guide:como-formatear-un-libro-para-kdp).

[Abre la app](app:) y exporta tu primer EPUB accesible, o vuelve a [todas las guías](hub:).
