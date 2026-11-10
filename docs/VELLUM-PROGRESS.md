# Progreso del plan «Vellum gratis»

Plan: `docs/VELLUM-PLAN.md`. Las reglas de ejecución están en su sección 8 y las órdenes de trabajo en la 9. Una línea por orden terminada, con fecha y enlace al PR.

## Estado

| Hilo | Orden | Estado | PR |
|---|---|---|---|
| A | T0 Banco de pruebas de calidad | hecha (PR abierto) | |
| A | T1.1 Líneas | sin empezar | |
| A | T1.2 Márgenes ópticos y letras elásticas | sin empezar | |
| A | T1.3 Páginas | sin empezar | |
| A | T1.4 Guiones por idioma | sin empezar | |
| B | T1.5 Ortotipografía | sin empezar | |
| B | T1.6 Velocidad | sin empezar | |
| B | T2.0 Lo gratis nuevo | sin empezar | |
| B | T2.1 Página de inicio | sin empezar | |
| B | T2.2 Asistente de 4 pasos | sin empezar | |
| C | T3.1 a T3.5 Word sin pérdidas | sin empezar | |
| D | T4.1 a T4.5 Editor de cubiertas | sin empezar | |
| E | T5.1 a T5.5 Estilos y paridad | sin empezar | |
| F | T6.1 a T6.3 Lanzamiento | sin empezar | |

## Cifras de calidad

| Fecha | Libro | Páginas cortas | Dobles páginas desiguales | Escaleras | Huecos muy grandes | Huecos grandes | Tiempo |
|---|---|---|---|---|---|---|---|
| 2026-11-09 (medición externa, antes de T0) | Oz | 28 de 91 | 15 | 0 | 1 | 19 | 0,65 s |
| 2026-11-09 (medición externa, antes de T0) | Leyendas | 33 de 109 | 25 | 9 | 13 | 27 | 0,74 s |

Desde T0, pegar aquí la tabla de `npm run quality` tras cada orden.

### 2026-11-10, T0 (punto de partida del banco)

| Book | Pages | Lines | Short pages | Uneven spreads | Ladders | Very loose | Loose | Widows | Orphans | Hyphen turns | Hyphens | Layout ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| oz | 142 | 3220 | 43 | 15 | 0 | 5 | 92 | 0 | 0 | 2 | 138 | 326 |
| leyendas | 128 | 3486 | 36 | 25 | 11 | 4 | 62 | 0 | 0 | 3 | 421 | 352 |
| dialogo-es | 82 | 2132 | 17 | 12 | 27 | 1 | 54 | 0 | 0 | 5 | 458 | 307 |
| ensayo-es | 86 | 2312 | 12 | 7 | 40 | 0 | 36 | 0 | 0 | 6 | 714 | 457 |
| largo-de | 62 | 1742 | 6 | 6 | 38 | 6 | 166 | 0 | 0 | 2 | 572 | 273 |


## Desviaciones del plan

- T0: las cifras del banco no coinciden del todo con la medición externa de la sección 2 (Oz: 43 páginas cortas de 142 frente a 28 de 91; Leyendas: 36 frente a 33, escaleras 11 frente a 9, huecos muy grandes 4 frente a 13). Las dobles páginas desiguales sí coinciden (15 y 25). Se usan las definiciones exactas de la orden; la línea base nueva es la del banco, no la de la sección 2.
- T0: los libros de prueba salen de Project Gutenberg (Marianela, Ariel, Die Verwandlung); las 47 notas al pie de `ensayo-es` son de prueba, generadas a partir del propio texto.

Apuntar aquí lo que se hizo distinto y por qué, y las metas no alcanzadas.

## Diario

- 2026-11-09: plan escrito, punto de partida medido y reparto gratis/Pro cerrado (sección 3 del plan). No se ha tocado código.

## Siguiente paso

Hilo A, orden T0.
- 2026-11-10: T0 hecha. `npm run quality` imprime la tabla de 5 libros; `tests/quality-baseline.json` guarda la línea base y `tests/quality.test.ts` impide empeorarla; páginas doradas en `tests/golden/`.
