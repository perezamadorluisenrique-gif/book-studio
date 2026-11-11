---
title: "Comprobar un ISBN y crear su código de barras para KDP"
description: "Comprueba que un ISBN-10 o ISBN-13 es válido, convierte un ISBN-10 en ISBN-13 y descarga su código de barras EAN-13 en SVG o PNG. Gratis y privado."
tool: isbn
updated: 2026-11-11
---
Pega un ISBN con o sin guiones. La herramienta lo comprueba, muestra el ISBN-13 y dibuja el código de barras que va en la contracubierta.

{{tool}}

{{figures}}

## Cómo se comprueba

El último dígito de un ISBN es un dígito de control, calculado con los demás, así que casi cualquier errata se detecta. En un ISBN-13 se multiplican los 12 primeros dígitos alternando 1 y 3, se suman, y el dígito de control es el que lleva el total a un múltiplo de 10. Un ISBN-10 usa pesos de 10 a 1 y un total divisible entre 11, con la X como 10. El ISBN-13 de un libro empieza por 978 o 979. Un ISBN-10 pasa a ISBN-13 poniendo 978 delante de sus nueve primeros dígitos y calculando un dígito de control nuevo.

Los guiones son solo para leer: dónde van depende del grupo de registro y del editor, así que no se pueden deducir de los dígitos. Esta herramienta comprueba el número, no si el ISBN está asignado a un libro.

## El código de barras

Los códigos de barras de libros son símbolos EAN-13 del ISBN-13: 95 módulos con una zona de silencio de 11 módulos a la izquierda y 7 a la derecha, barras negras sobre blanco. Puedes subir una cubierta con o sin código de barras. Si no pones el tuyo, KDP lo coloca en la contracubierta por ti; si lo pones, deja libre la esquina inferior derecha de la contracubierta. La ayuda de KDP no publica el tamaño del código, así que consulta la plantilla de tu tamaño.

## Siguiente

Tu cubierta también necesita su [tamaño completo y una plantilla](tool:cover). [Book Studio](app:) puede poner el código de barras en la contracubierta a partir del ISBN de los detalles de tu libro.
