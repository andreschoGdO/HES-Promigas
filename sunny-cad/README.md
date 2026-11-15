# sunny-cad

Herramienta de diseño 3D y planos para sistemas solares residenciales con almacenamiento
(proyecto Sunny). Las reglas y el plan por pasos están en [CLAUDE.md](CLAUDE.md).

Estado: **Paso 4** — distribución de módulos.

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
