# Proceso para una vivienda nueva (sunny-cad)

Guía paso a paso, construida con el primer proyecto real (**Terraza Riomar, Barranquilla**:
`projects/riomar-terraza-barranquilla/`, que sirve de ejemplo completo de cada archivo).

Regla de oro: la fuente de verdad es `projects/<id>/proyecto.json`. Todo cambio se **propone**
(copia + validación + diferencia) y solo se **aplica** con `--aplicar` cuando el usuario lo aprueba.
Lo que no se sabe queda en `null` y en `informacion_faltante`; nunca se supone sin decirlo.

---

## 0. Entorno (una vez por máquina)

```bash
cd sunny-cad
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
sudo apt-get install -y blender python3-numpy   # renders (Blender 4 + numpy del sistema)
.venv/bin/pytest -q                              # todo debe pasar
```

## 1. Información que hay que pedirle al usuario

Pedir todo esto antes de diseñar (regla 1 de CLAUDE.md). Marcar lo que falte.

**Ubicación y geometría**
- [ ] Coordenadas de la vivienda (van exactas a `privado/`; al proyecto, con 2 decimales).
- [ ] Captura de Google Maps (satelital, desde arriba, norte arriba) con la herramienta
      **"Medir distancia"** trazada sobre el contorno de la cubierta: debe verse la **superficie
      total (m²)** y la **distancia total (m)**. Es el mejor método de escala.
- [ ] Si hay varios niveles o zonas, una captura por zona (se alinean entre sí por correlación).
- [ ] Altura de cada nivel (por ejemplo, "la terraza alta está 2 m más arriba"), número de pisos,
      material de la cubierta, sombras de edificios vecinos.

**Fotos**
- [ ] Cubierta / terraza (general y detalle).
- [ ] Muro donde irán los equipos, **anotado** (recuadro del área, medida del muro, obstáculos como
      buitrones, cajas, columnas). Una foto anotada vale más que una descripción.
- [ ] Tablero existente y por dónde llega el cableado (buitrón, ducto, cuántos pisos baja).

**Sistema eléctrico**
- [ ] Tipología: T1 bifásica o T2 trifásica.
- [ ] Arquitectura: serie o paralelo; conmutación: bypass, ATS (contactor) o SmartGuard.
- [ ] Respaldo: toda la vivienda o cargas críticas.
- [ ] Inversor y batería (kWh) elegidos por el usuario; módulo FV.
- [ ] Capacidad del totalizador / demanda de la vivienda (en serie toda la carga pasa por el
      inversor: no superar su potencia máxima de entrada AC).

**Estructura y preferencias**
- [ ] Tipo de montaje: coplanar, pérgola / carport (área y forma), estructura inclinada.
- [ ] Inclinación y orientación deseadas.
- [ ] Separación entre módulos (Riomar: 30 mm en losa, 10 mm en pérgola).

**Cajetín**
- [ ] Diseñador (va a `privado/datos_privados.json`; sin tarjeta profesional si el usuario no la da).
- [ ] Código corto del proyecto para la codificación `PRO-<disciplina>-<proyecto>-<tipo>-<nnn>`.

## 2. Crear el proyecto

```bash
.venv/bin/python -m engine.lectura nuevo <id> --nombre "…" --municipio "…" \
    --departamento "…" --lat <lat> --lon <lon>
```

Copiar las capturas a `projects/<id>/privado/` y las fotos a `projects/<id>/privado/fotos/`
(nunca a git: traen GPS y direcciones).

## 3. Trazado de la vivienda (Paso 3)

1. Ubicar los vértices del polígono de "Medir distancia" en la captura (borde oscuro de los
   marcadores) y escribir `insumos/lectura.json` con `"metodo": "poligono_medido"`, el área y el
   perímetro. Ver el ejemplo de Riomar.
2. Si la cubierta tiene niveles, partir el polígono en una `cubierta-NN` por nivel, con su
   `cota_base_mm` (Z = 0 en el nivel más bajo).
3. Capturas adicionales (otro encuadre): alinearlas con la primera por correlación de imagen antes
   de usar sus puntos (en Riomar el desplazamiento fue de unos píxeles con correlación 0,999).
4. Proponer, revisar `privado/verificacion_trazado.png` (medidas de cada lado) y aplicar:

```bash
.venv/bin/python -m engine.lectura proponer <id>
.venv/bin/python -m engine.lectura proponer <id> --aplicar
```

Control: el perímetro calculado debe coincidir con el de Maps (tolerancia 2 %).

## 4. Distribución de módulos (Paso 4)

1. Escribir `insumos/zonas.json` (una zona por superficie: contorno en mm, estructura, inclinación,
   azimut, orientación del módulo, separación, retiro, `es_supuesto`).
2. **Comparar orientaciones**: si el edificio está girado respecto al norte, mirar exactamente al
   sur puede dejar la mitad de módulos (Riomar: 7 al sur contra 15 alineados con el edificio).
3. Ajustar las medidas de la zona a filas completas: pequeños cambios de proporción con la misma
   área pueden sumar una fila (Riomar: 6,84 × 4,97 m en vez de 6,74 × 5,04 m = 12 módulos en vez de 10).
4. Proponer, revisar `salidas/verificacion_distribucion.png` y aplicar:

```bash
.venv/bin/python -m engine.distribucion proponer <id> --modulo <id-modulo>
.venv/bin/python -m engine.distribucion proponer <id> --modulo <id-modulo> --aplicar
```

## 5. Motor eléctrico (Paso 5)

1. Temperaturas de diseño del sitio en `condiciones_diseno` del proyecto (confirmarlas).
2. Escribir `insumos/electrico.json`: inversor, batería y configuración, medidor, ubicaciones de los
   equipos sobre el muro (`muro_equipos`, distancias desde la esquina), buitrón, pisos que baja el
   cableado hasta el tablero existente, rumbos del edificio y del muro.
   - La bajante puede ser un buitrón adosado (`"tipo": "buitron"`, alto ≥ 1,2 m) o una claraboya
     (`"tipo": "claraboya"`, brocal bajo). Si la claraboya está separada del muro (> 0,3 m), la AC
     baja al piso pasando la claraboya, cruza el piso y sube por el lado del brocal.
   - Con `"edificio_inferior": {"modelar": true, ...}` se modelan los pisos de abajo (losas, fachada
     y vacío translúcidos), la AC baja por el vacío, corre por el techo del último piso el
     `recorrido_horizontal_tablero_existente_m` hacia `"lado_recorrido"` ("derecha" o "izquierda",
     mirando la bajante desde el muro de equipos; preguntarlo) y baja al tablero existente; se genera la vista de corte `render_bajante.png` y su
     lámina REN.
3. Proponer, leer `salidas/memoria_electrica.md` y aplicar:

```bash
.venv/bin/python -m engine.electrico proponer <id>
.venv/bin/python -m engine.electrico proponer <id> --aplicar
```

Los factores de NTC 2050 / RETIE están en `templates/criterios_electricos.json` **por confirmar**:
el ingeniero responsable los valida.

## 6. Modelo 3D, IFC y renders (Paso 6)

```bash
.venv/bin/python -m engine.modelo3d generar <id> --render
```

Salen `modelo.ifc`, `modelo.glb`, `visor_3d.html` y 7 renders (terraza, isométrica, aéreas, superior,
cableado, equipos). Revisar en especial:
- que la ductería quede **adosada a muros o sobre losas** y bajo la coronación de los muros;
- que el piso sea continuo donde lo es en obra;
- que nada choque (la prueba de choques 3D lo verifica entre equipos, buitrón y estructura).

## 7. Planos con cajetín Promigas (Paso 7)

```bash
.venv/bin/python -m engine.planos generar <id>
```

Láminas A3 (planta, alzado del muro de equipos, unifilar y dos o tres de renders) en PDF y DXF. Si
hay datos personales (diseñador, cliente) en `privado/datos_privados.json`, los planos se guardan
en `privado/planos/` y no se suben a git.

## 8. Cambios por lenguaje natural (Paso 8)

Cualquier ajuste posterior ("sube el inversor 20 cm", "inclina los paneles a 10°", "quita el
módulo 8 por sombra", "cambia a 2 strings de 4") se pide en español. Claude lo traduce a
operaciones; el código las aplica sobre una copia, redistribuye y recalcula lo eléctrico, valida y
muestra la diferencia. Nada cambia hasta `aplicar`:

```bash
.venv/bin/python -m engine.edicion proponer <id> "sube el inversor 20 cm"
.venv/bin/python -m engine.edicion ver <id>                 # resumen y diferencia
.venv/bin/python -m engine.edicion aplicar <id> --regenerar # o: descartar <id>
.venv/bin/python -m engine.edicion operaciones              # operaciones disponibles
```

- Requiere `ANTHROPIC_API_KEY` en el entorno (nunca en el repositorio). Sin clave, las operaciones
  se pueden escribir a mano en un JSON y pasar con `--operaciones ops.json`.
- Operaciones: `establecer` (campo existente), `mover_equipo`, `cambiar_equipo`,
  `cambiar_strings`, `cambiar_zona`, `quitar_modulos`.
- La propuesta queda en `propuestas/edicion/` (fuera de git); lo aplicado queda en
  `historial_ediciones.json`. Una propuesta inválida no se puede aplicar.
- Después de aplicar, regenerar renders (`--render`) y planos.

## 9. Cierre

```bash
.venv/bin/ruff check . && .venv/bin/pytest -q && .venv/bin/python -m engine.validar
```

Commit con mensaje en español, push y entregar al usuario el PDF de planos, los renders y la lista
de decisiones y supuestos por confirmar.

---

## Lecciones del proyecto Riomar

- **"Medir distancia" de Maps** es el mejor insumo: área + perímetro dan y comprueban la escala.
- Los rótulos sueltos de Maps (por ejemplo "40,00 m" al pasar el cursor) no son medidas: ignorarlos.
- Pedir **fotos anotadas** del muro de equipos; ahorran varias vueltas (en Riomar la ubicación de los
  equipos y del buitrón cambió tres veces hasta tener la foto anotada).
- El buitrón real era un volumen adosado más bajo que la pérgola (1,7 m): confirmar alturas antes de
  suponer choques.
- El alzado del muro de equipos detecta choques que la planta esconde.
- La ductería debe ir siempre por muros, losas o estructura; nunca en el aire.
- Dejar en el proyecto solo coordenadas con 2 decimales; lo exacto y las fotos, en `privado/`.

## Lecciones del proyecto Natura

- Preguntar la separación entre la bajante (claraboya/buitrón) y el muro o la puerta: en Natura la
  claraboya estaba a 0,70 m de la puerta y eso cambia la ruta por el piso.
- Para mostrar el recorrido hasta el punto de conexión, modelar los pisos inferiores
  (`edificio_inferior`) y revisar `render_bajante.png`: es un corte, la cámara recorta la fachada.
