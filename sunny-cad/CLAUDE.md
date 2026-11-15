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
1. Entorno, estructura y contratos de datos (este paso)
2. Biblioteca de componentes
3. Lectura de la vivienda (DXF, PDF, fotos)
4. Motor de distribución de módulos
5. Motor eléctrico
6. Modelo IFC, visor 3D y renders
7. Planos con cajetín y PDF
8. Edición por lenguaje natural con aprobación
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
