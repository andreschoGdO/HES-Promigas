# sunny-cad

Herramienta de diseño 3D y planos para sistemas solares residenciales con almacenamiento
(proyecto Sunny). Las reglas y el plan por pasos están en [CLAUDE.md](CLAUDE.md).

Estado: **Paso 7** — planos con cajetín y PDF.

## Preparar el entorno

Linux / macOS:

```bash
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Windows (PowerShell):

```powershell
py -3.11 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

## Validar y probar

```bash
python -m engine.validar     # valida library/ y projects/ contra los esquemas
pytest                       # pruebas
ruff check . && ruff format --check .
```

## Contratos de datos

- `engine/esquemas/componente.schema.json` — un equipo de `library/`. Obligatorio el campo
  `fuente` con la ficha técnica de origen.
- `engine/esquemas/proyecto.schema.json` — `projects/<vivienda>/proyecto.json`, fuente de verdad
  de cada instalación.
- `engine/esquemas/datos_privados.schema.json` — datos personales para el cajetín (ver abajo).

Los archivos con `"es_ejemplo": true` son ficticios y solo sirven para las pruebas.

## Datos personales (cajetín)

Los datos del cliente y del ingeniero responsable **no** van en `proyecto.json`. Copia
`templates/datos_privados.plantilla.json` a `projects/<vivienda>/privado/datos_privados.json`
y llénalo. La carpeta `privado/` está en `.gitignore` y nunca se sube al repositorio;
`python -m engine.validar` la revisa si existe.

## Lectura de una vivienda nueva (Paso 3)

1. Crear el proyecto (las coordenadas exactas quedan en `privado/`, al proyecto van con 2 decimales):

   ```bash
   python -m engine.lectura nuevo casa-ejemplo --nombre "Casa ejemplo" --municipio Cali \
       --departamento "Valle del Cauca" --lat 3.3197 --lon -76.5441
   ```

2. Copiar las fotos en `projects/<id>/privado/fotos/` y la captura de Google Maps (vista satelital,
   desde arriba, norte arriba, **con la barra de escala visible** y la casa ocupando buena parte de
   la imagen) en `projects/<id>/privado/`.
3. Escribir `projects/<id>/insumos/lectura.json` (esquema `engine/esquemas/lectura.schema.json`):
   contornos en píxeles de cada cubierta y obstáculo, y la escala (barra de escala, una medida
   conocida o el zoom del mapa). Lo propone la IA; lo revisa el usuario.
4. Armar la propuesta, revisar la imagen `privado/verificacion_trazado.png` (trazado con las
   medidas de cada lado) y la diferencia que se imprime:

   ```bash
   python -m engine.lectura proponer casa-ejemplo
   ```

5. Si está bien, aplicarla:

   ```bash
   python -m engine.lectura proponer casa-ejemplo --aplicar
   ```

Lo que no se ve en la imagen (inclinación, azimut, alturas, tipología…) queda en `null` y en
`informacion_faltante`; el proyecto no puede salir de `borrador` mientras haya datos pendientes.

### Escala con "Medir distancia" de Google Maps

Lo más práctico: en Maps, clic derecho → *Medir distancia*, marcar el contorno de la terraza y
capturar la pantalla con el área y la distancia total. En `lectura.json` se usa
`"metodo": "poligono_medido"` con los vértices en píxeles, `area_m2` y `perimetro_m`. El área da la
escala y el perímetro la comprueba (si difieren más de 2 %, la propuesta se rechaza).

## Distribución de módulos (Paso 4)

1. Escribir las zonas de instalación en `projects/<id>/insumos/zonas.json`: contorno en mm,
   estructura (coplanar, pérgola…), inclinación, azimut, orientación del módulo, separación y retiro.
2. Proponer y revisar `salidas/verificacion_distribucion.png`:

   ```bash
   python -m engine.distribucion proponer <id> --modulo ja-solar-jam72d40-595-mb
   ```

3. Aplicar con `--aplicar` cuando el usuario apruebe.

Las filas quedan perpendiculares al azimut. Si el edificio está girado respecto al norte, mirar
exactamente al sur puede dejar muchos menos módulos: conviene comparar con el azimut alineado.

## Motor eléctrico (Paso 5)

1. Elegir equipos y ubicaciones en `projects/<id>/insumos/electrico.json` (inversor, batería y
   configuración, medidor, puntos de instalación, rumbo del edificio, longitudes AC conocidas) y
   las temperaturas de diseño en `condiciones_diseno` del proyecto.
2. Proponer: calcula strings (Voc en frío, Vmp en caliente, límites del MPPT), los asigna a los
   módulos, dimensiona conductores, protecciones y caídas de tensión y escribe
   `salidas/memoria_electrica.md` y `salidas/calculo_electrico.json`:

   ```bash
   python -m engine.electrico proponer <id>
   ```

3. Aplicar con `--aplicar`.

**Criterios:** los factores (1,25), la tabla de ampacidad, la corrección por temperatura y los
límites de caída de tensión están en `templates/criterios_electricos.json`, marcados
**por confirmar**. No son requisitos normativos validados: el ingeniero responsable debe
confirmarlos contra NTC 2050 y RETIE.

## Modelo 3D, visor y renders (Paso 6)

```bash
python -m engine.modelo3d generar <id>            # salidas/modelo.ifc, modelo.glb y visor_3d.html
python -m engine.modelo3d generar <id> --render   # además salidas/render_*.png (Blender)
```

- `modelo.ifc` (IFC4, mm): módulos como `IfcSolarDevice`, batería `IfcElectricFlowStorageDevice`,
  tablero `IfcElectricDistributionBoard`, estructura `IfcMember`; cada elemento con el
  `Pset_SunnyCad` (componente, modelo, potencia, string, zona…).
- `visor_3d.html`: se abre en el navegador (necesita internet para cargar three.js). Clic sobre un
  elemento para ver su identificador.
- Renders: Blender 4 con Cycles en CPU. En Ubuntu, el Blender del sistema necesita
  `sudo apt-get install blender python3-numpy`.

Es un modelo de borrador: cubiertas como losas, la terraza alta como volumen macizo, pérgola
esquemática (columnas y vigas perimetrales) y equipos como cajas con las medidas de su ficha.

## Planos con cajetín Promigas (Paso 7)

```bash
python -m engine.planos generar <id>
```

Láminas A3 generadas desde el proyecto (nunca se editan a mano), con el cajetín del plano de
referencia de Promigas (PRO-ELE-SPEC-DIS-001): marco con zonas 8…1 / F…A, tabla de revisiones,
lista de materiales calculada desde el proyecto, nota de confidencialidad, notas, datos de dibujo
y bloque con logo, proyecto, contenido, tamaño, código, revisión, escala, unidad y hoja.

Codificación: `PRO-<disciplina>-<proyecto>-<tipo>-<nnn>`:

| Código | Contenido |
|---|---|
| `PRO-ARQ-<P>-DIS-001` | Planta: distribución de módulos por string, pérgola, equipos y rutas de cableado |
| `PRO-ARQ-<P>-ALZ-002` | Alzado del muro de equipos a 1:20 con rutas de cableado |
| `PRO-ELE-<P>-UNI-003` | Diagrama unifilar desde el cálculo eléctrico |
| `PRO-ARQ-<P>-REN-004` | Renders: terraza, isométrica, aéreas |
| `PRO-ARQ-<P>-REN-005` | Renders: vista superior, rutas de cableado y muro de equipos |

Salida: un PDF con todas las láminas y un DXF por lámina. El cajetín sale de
`templates/cajetin.json` y el logo de `templates/logos/promigas.png`. Si existen datos personales en
`privado/datos_privados.json`, los planos se guardan en `privado/planos/` (fuera de git).
