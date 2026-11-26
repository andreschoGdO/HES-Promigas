# sunny-cad — Herramienta de diseño 3D y planos para sistemas solares residenciales (proyecto Sunny)

## Objetivo
Cargar la información de una vivienda, generar un modelo 3D editable de la instalación
fotovoltaica con almacenamiento, modificarlo con instrucciones en lenguaje natural y producir
renders y planos PDF con el cajetín corporativo.

## Principio de diseño (no negociable)
- La fuente de verdad es `projects/<vivienda>/proyecto.json`. Nunca se edita a mano un plano, un IFC o un render.
- La IA propone y traduce instrucciones a operaciones sobre el JSON. Los cálculos y la geometría los hace código determinista.
- Todo cambio se aplica primero a una copia, se valida y se muestra la diferencia. Solo se aplica tras aprobación del usuario.
- Los planos son borradores técnicos. Los revisa y firma el ingeniero responsable.

## Estructura del repositorio
- `library/`    componentes (módulos, inversores, baterías, tableros, protecciones, estructuras), un JSON por equipo
- `projects/`   una carpeta por vivienda: insumos/, proyecto.json, salidas/
- `templates/`  cajetín, estilos gráficos, simbología, plantilla de proyecto
- `engine/`     lectura de planos, distribución, cálculo eléctrico, IFC, planos 2D, renders
- `app/`        interfaz web (chat + visor 3D + aprobación de cambios)
- `tests/`      pruebas, con casos calculados a mano

## Convenciones
- Unidades: milímetros para geometría, metros solo en la interfaz. Ángulos en grados. Potencia en W, energía en kWh.
- Ejes: X hacia el este, Y hacia el norte, Z hacia arriba. Origen en la esquina suroeste de la vivienda.
- Identificadores: `modulo-001`, `inversor-01`, `bateria-01`, `tablero-01`; minúsculas, sin tildes ni espacios.
- Idioma: documentación, notas de planos y mensajes al usuario en español. Código y nombres de campos en español sin tildes.
- Python 3.11+, tipado con type hints, pruebas con pytest, formato con ruff.

## Contexto técnico del proyecto Sunny
- Sistemas fotovoltaicos con almacenamiento (BESS) en viviendas en Colombia.
- Tipologías estándar: T1 bifásica (inversor híbrido bifásico, o monofásico conectado entre dos fases como el Huawei SUN2000-LC0) y T2 trifásica (inversor híbrido trifásico). El nivel de tensión de la batería lo define el inversor: los equipos del piloto (LUNA2000, DEYE GB-L) son de alta tensión.
- Arquitecturas: inversor en serie (toda la carga pasa por el inversor) e inversor en paralelo (la carga se alimenta de la red y el inversor entra en respaldo). En serie con punto único de falla exige BYPASS o ATS; en paralelo el ATS (o SmartGuard en Huawei) es indispensable.
- Bloques mínimos de toda instalación: generación FV, inversor híbrido, BESS con BMS, punto de conexión común (PCC) accesible, CT o medidor bidireccional en el PCC, tablero de cargas críticas (EPS) o respaldo total, monitoreo.
- Equipos de referencia del piloto: inversores Huawei SUN2000-10K-LC0, DEYE SUN-15K-SG01HP3-US-AM2 y Livoltek HP3-10KL2 / HP3-15KL2; baterías Huawei LUNA2000-7/14/21-S1, DEYE GB-L y Livoltek BHF; Huawei SmartGuard-63A-S0; módulo JA Solar JAM72D40-595/MB; medidor STAR DTSY23S de riel DIN dentro del tablero; plataforma FusionSolar. No se usa SmartLogger.
- Normativa de referencia: RETIE y NTC 2050. No inventar requisitos normativos: si falta un dato, preguntar.

## Reglas de trabajo para Claude
1. Antes de generar cualquier diseño, listar la información faltante y pedirla.
2. No inventar dimensiones ni datos eléctricos de equipos. Todo dato de componente debe venir de una ficha técnica citada en el campo `fuente`.
3. Cada paso termina con pruebas que pasan y una lista de decisiones que debe confirmar el usuario.
4. No guardar claves, contraseñas ni credenciales en el repositorio. La clave de API se lee de la variable de entorno `ANTHROPIC_API_KEY`.
5. Cambios pequeños y commits frecuentes con mensajes claros en español.
6. No pasar al siguiente paso hasta que el usuario lo apruebe.

## Plan por pasos
1. Entorno, estructura y contratos de datos
2. Biblioteca de componentes
3. Lectura de la vivienda (DXF, PDF, fotos)
4. Motor de distribución de módulos
5. Motor eléctrico
6. Modelo IFC, visor 3D y renders
7. Planos con cajetín y PDF
8. Edición por lenguaje natural con aprobación (`engine/edicion`, ver PROCESO.md §8)
9. Interfaz web
10. Piloto y validación

## Decisiones confirmadas por el usuario
- El proyecto vive en la carpeta `sunny-cad/` del repositorio HES-Promigas.
- Esquemas en `engine/esquemas/`; unidades en el nombre del campo (`_mm`, `_w`, `_deg`…).
- Dimensiones de equipos como en las fichas: ancho × alto × profundidad.
- Azimut desde el norte en sentido horario (180 = sur), indica hacia dónde cae el agua.
- El tipo de cubierta (plana / inclinada) lo indica el usuario en cada vivienda.
- Datos personales (cliente, ingeniero) solo en `projects/<vivienda>/privado/`, fuera de git.
- En `library/fichas/` se guardan solo fichas técnicas, no manuales.
- Cada batería solo se usa con inversores de su misma marca.
- DEYE GB-L con el SUN-15K: hasta 3 torres en paralelo de 4 módulos cada una.
- Se usa el SmartGuard-63A-S0 definitivo (la ficha disponible es la preliminar 04-202311).
- Livoltek BHF G2 (módulo 5,12 kWh): hasta 2 torres de 3 módulos en paralelo (≈ 30 kWh). Livoltek HP3 variante L2 (127/220 V).
- El medidor STAR DTSY23S es de medida directa (sin CT) y se usa tanto en viviendas bifásicas como trifásicas.

- Una vivienda nueva se lee desde fotos y una vista de Google Maps (no hay DWG/DXF). La IA propone el
  trazado en píxeles; el código lo convierte a mm con la escala; el usuario lo revisa sobre la imagen.
- Datos que no se ven quedan en null y en `informacion_faltante`; nunca se suponen.
- Coordenadas: 2 decimales en `proyecto.json`; las exactas, fotos y capturas solo en `privado/`.
- Los planos de "Casa de la Gerente" y "Reserva Pance Casa 2" son ejemplos del resultado esperado.

## Prácticas observadas en instalaciones reales (guía, no norma)
Tomadas de un layout de referencia (Revit, Cali, HP3-15KL2 + BHF 3 módulos) y fotos de obra.
- Módulos coplanares con la cubierta (al ras), sobre lámina metálica trapezoidal, entre pretiles.
- Separación entre módulos de 20 mm; se combinan filas horizontales y verticales según el espacio.
- Un string por campo de módulos (por ejemplo, S1.1 con 12 módulos y S1.2 con 10).
- Inversor, batería, tablero fotovoltaico y tablero con contactor van juntos en un muro exterior
  protegido, cerca del tablero existente. La batería va en el piso, junto al inversor.
- DC en coraza americana de 1" (cable FV 2×4 mm² + tierra); AC en tubo IMC; cajas de paso de
  10×10 cm IP66 y canaleta metálica con doble división hacia el tablero existente.
- Señalización de peligro y de doble fuente en el inversor y los tableros.
- Planos con el cajetín y el logo de Promigas (plano de referencia PRO-ELE-SPEC-DIS-001); códigos `PRO-<disciplina>-<proyecto>-<tipo>-<nnn>`.
- En Riomar los equipos van en la cara noroeste (costado izquierdo) de la terraza alta; el buitrón (80 cm de saliente, 1,7 m de alto) baja dos pisos hasta el tablero existente.
- Diseñador en los planos: Santiago Osorio, sin número de tarjeta profesional (guardado en `privado/`).
- El proceso completo para viviendas nuevas está en `PROCESO.md` (y en el skill `.claude/skills/nueva-vivienda`).
- Piso de la terraza continuo; ductería siempre adosada a muros, losas o estructura, nunca en el aire.
- Unifilares por casa (`engine/planos/unifilar_casas.py`): esquema trifásico de la guía DEYE (tablero FV
  con transferencia K1, red aguas arriba del medidor 1, módem alimentado desde la salida de K1); Livoltek
  usa el mismo esquema que DEYE; Huawei bifásico según la guía SSFV_CASA_BIFASICA (SmartGuard,
  autotransformador, DTSY23S en la salida del inversor, Smart Dongle).
- Torres Livoltek BHF: hasta 4 módulos en una torre; más de 4, dos torres de 3 + 3 o 3 + 2, con 1 BMS
  y 1 top cover. DEYE: un BMS por torre. Huawei: LUNA2000-7-E1 (bifásicas a 240 V).
- Strings de más de 10 módulos se dividen en dos (un string por MPPT).
- Bifásicos Huawei: hoja 2 con el plano de comunicaciones (SmartGuard ↔ inversor ↔ torre 1 ↔ torre 2,
  según la guía SSFV_..._COMUNICACIÓN); solo cambia con una o dos torres. Autotransformador con toma
  central (N) hacia el tablero existente; sin línea separada de bypass del neutro.
- Trifásicos: alimentador hasta el punto final del tablero de conexión en 6 AWG Cu.

- Planos de conjuntos (Primavera, Doral): módulos en filas rectas y continuas, alineadas entre filas
  cuando cabe; hoja 4 de detalles con la estructura lastrada en 3D, corte 1:20 y rutas DC/AC con
  tramos numerados, curvas y tabla. Longitudes y curvas de materiales salen de la ruta 3D.
- Estructura lastrada (detalle tipo): rieles a 542 mm de cada borde del módulo (1244 entre rieles),
  soporte trasero 412 mm, 10°; en una sola hilera el bloque trasero va bajo el borde alto (3665 mm
  solo entre filas). Bloques esquemáticos: dimensiones y peso según proveedor.
- Pance Campestre 16 (`engine/planos/casas_pance.py`): cubierta tipo sándwich, módulos coplanares
  sobre mini riel (2 por junta, a 542 mm de los bordes, sobre cresta); equipos en la fachada oeste
  sobre la terraza del 2° piso; la AC baja por un buitrón a través de la claraboya del piso de la terraza (frente al listón de
  madera) hasta el tablero del 1° piso.
