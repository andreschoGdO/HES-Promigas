# sunny-cad

Herramienta de diseño 3D y planos para sistemas solares residenciales con almacenamiento
(proyecto Sunny). Las reglas y el plan por pasos están en [CLAUDE.md](CLAUDE.md).

Estado: **Paso 1** — entorno, estructura y contratos de datos.

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

Los archivos con `"es_ejemplo": true` son ficticios y solo sirven para las pruebas.
