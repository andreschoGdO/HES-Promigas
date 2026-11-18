---
name: nueva-vivienda
description: Diseñar una instalación solar FV + BESS para una vivienda nueva del proyecto Sunny con sunny-cad, de la captura de Google Maps y las fotos hasta los planos con cajetín Promigas. Usar cuando el usuario pida empezar o continuar el diseño de otra casa o terraza.
---

# Vivienda nueva con sunny-cad

1. Leer `sunny-cad/CLAUDE.md` (reglas, convenciones, decisiones confirmadas) y
   `sunny-cad/PROCESO.md` (paso a paso, lista de información a pedir y lecciones).
2. Antes de diseñar, pedir la información de la sección 1 de `PROCESO.md` y marcar lo que falte.
3. Seguir los pasos 2 a 9 de `PROCESO.md`, usando `projects/riomar-terraza-barranquilla/` como
   ejemplo de cada archivo de insumos.
4. En cada paso: proponer, mostrar la imagen de verificación o la diferencia, y aplicar solo con la
   aprobación del usuario. Terminar cada paso con pruebas que pasan y la lista de decisiones por
   confirmar.
5. Datos personales, coordenadas exactas y fotos siempre en `projects/<id>/privado/`.
6. Los ajustes posteriores en lenguaje natural van con `python -m engine.edicion proponer <id> "…"`
   (PROCESO.md §8): mostrar la diferencia y aplicar solo con aprobación.
