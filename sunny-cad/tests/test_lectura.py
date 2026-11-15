"""Pruebas del Paso 3: lectura de la vivienda desde una vista superior y fotos.

Casos calculados a mano sobre imágenes sintéticas (no se usan fotos reales: son privadas).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest
from PIL import ExifTags, Image, ImageDraw

from engine import validar
from engine.lectura import fotos, trazado
from engine.lectura.__main__ import main as cli
from engine.lectura.escala import mm_por_pixel
from engine.pendientes import errores_pendientes, errores_privacidad, rutas_pendientes

# --- Escala ------------------------------------------------------------------


def test_escala_por_barra() -> None:
    # 100 px = 10 m → 100 mm/px
    e = {"metodo": "barra_escala", "p1_px": [10, 10], "p2_px": [110, 10], "longitud_m": 10}
    assert mm_por_pixel(e) == pytest.approx(100)


def test_escala_por_medida_conocida_en_diagonal() -> None:
    # Diagonal de un triángulo 3-4-5: 50 px = 8,5 m → 170 mm/px
    e = {"metodo": "medida_conocida", "p1_px": [0, 0], "p2_px": [30, 40], "longitud_m": 8.5}
    assert mm_por_pixel(e) == pytest.approx(170)


@pytest.mark.parametrize(
    ("latitud", "zoom", "pantalla", "esperado_mm_px"),
    [
        # 156 543,034 m/px / 2^20 = 0,149291 m/px en el ecuador
        (0, 20, 1, 149.291),
        # × cos(3,32°) = 0,998322 → 149,04 mm/px (Pance, Cali)
        (3.32, 20, 1, 149.040),
        # Pantalla retina: la mitad
        (3.32, 20, 2, 74.520),
    ],
)
def test_escala_web_mercator(
    latitud: float, zoom: int, pantalla: int, esperado_mm_px: float
) -> None:
    e = {
        "metodo": "web_mercator",
        "latitud_deg": latitud,
        "zoom": zoom,
        "escala_pantalla": pantalla,
    }
    assert mm_por_pixel(e) == pytest.approx(esperado_mm_px, abs=0.01)


def test_escala_con_puntos_iguales_falla() -> None:
    e = {"metodo": "barra_escala", "p1_px": [5, 5], "p2_px": [5, 5], "longitud_m": 10}
    with pytest.raises(ValueError):
        mm_por_pixel(e)


# --- Trazado → mm --------------------------------------------------------------


def _lectura(rotacion: float = 0, **cubierta: Any) -> dict[str, Any]:
    c = {
        "id": "cubierta-01",
        "contorno_px": [[100, 100], [200, 100], [200, 150], [100, 150]],
        "tipo": "plana",
        "material": "losa_concreto",
        "obstaculos": [
            {
                "id": "obstaculo-01",
                "tipo": "tanque",
                "contorno_px": [[180, 110], [190, 110], [190, 120], [180, 120]],
                "altura_mm": 1500,
            }
        ],
    }
    c.update(cubierta)
    return {
        "version_esquema": "1.1.0",
        "imagen": {
            "archivo": "privado/maps.png",
            "ancho_px": 300,
            "alto_px": 200,
            "fuente": "google_maps_satelital",
            "rotacion_norte_deg": rotacion,
        },
        "escala": {
            "metodo": "barra_escala",
            "p1_px": [10, 190],
            "p2_px": [110, 190],
            "longitud_m": 10,
        },
        "cubiertas": [c],
    }


def test_lectura_cumple_esquema() -> None:
    assert validar.errores_esquema(_lectura(), "lectura") == []


def test_rectangulo_a_mm_con_origen_suroeste() -> None:
    # 100 × 50 px a 100 mm/px = 10 × 5 m. Norte arriba: la fila y=150 px es el lado sur (y = 0).
    c = trazado.cubiertas_desde_lectura(_lectura())[0]
    assert c["contorno_mm"] == [[0, 5000], [10000, 5000], [10000, 0], [0, 0]]
    assert trazado.medidas_de_lados(c["contorno_mm"]) == [10.0, 5.0, 10.0, 5.0]


def test_obstaculo_en_coordenadas_de_la_vivienda() -> None:
    # x: (180-100)×100 = 8000 … 9000 mm; y: (150-110)×100 = 4000 … (150-120)×100 = 3000 mm
    o = trazado.cubiertas_desde_lectura(_lectura())[0]["obstaculos"][0]
    assert o["contorno_mm"] == [[8000, 4000], [9000, 4000], [9000, 3000], [8000, 3000]]


def test_rotacion_norte_90() -> None:
    # Norte hacia la derecha de la imagen: el lado largo (10 m en la imagen) queda norte-sur.
    c = trazado.cubiertas_desde_lectura(_lectura(rotacion=90))[0]
    xs = [p[0] for p in c["contorno_mm"]]
    ys = [p[1] for p in c["contorno_mm"]]
    assert (max(xs) - min(xs), max(ys) - min(ys)) == (5000, 10000)
    assert (min(xs), min(ys)) == (0, 0)


def test_rotacion_conserva_medidas() -> None:
    c = trazado.cubiertas_desde_lectura(_lectura(rotacion=37))[0]
    assert trazado.medidas_de_lados(c["contorno_mm"]) == [10.0, 5.0, 10.0, 5.0]
    assert min(p[0] for p in c["contorno_mm"]) == 0
    assert min(p[1] for p in c["contorno_mm"]) == 0


def test_punto_a_planta_giro_horario() -> None:
    # Un píxel "arriba" (norte de la imagen) con el norte girado 90° queda al oeste.
    x, y = trazado.a_planta([0, -10], 1000, 90)
    assert (round(x), round(y)) == (-10000, 0)
    assert math.isclose(math.hypot(x, y), 10000)


# --- Datos pendientes y propuesta --------------------------------------------


def _proyecto_base() -> dict[str, Any]:
    p = validar.cargar_json(validar.RAIZ / "templates" / "proyecto.plantilla.json")
    p.update(id="vivienda-prueba", nombre="Vivienda de prueba", es_ejemplo=True)
    p["ubicacion"].update(municipio="Cali", departamento="Valle del Cauca")
    p["informacion_faltante"] = ["Nota manual que debe conservarse"]
    return p


def test_propuesta_marca_lo_que_no_se_ve_como_pendiente() -> None:
    propuesta = trazado.proponer_proyecto(_proyecto_base(), _lectura())
    pendientes = rutas_pendientes(propuesta)
    for campo in ("cota_base_mm", "inclinacion_deg", "azimut_deg"):
        assert f"cubierta-01/{campo}" in pendientes
    assert "sistema/tipologia" in pendientes
    assert "vivienda/cubiertas" not in pendientes
    assert "Nota manual que debe conservarse" in propuesta["informacion_faltante"]
    assert errores_pendientes(propuesta) == []
    assert validar.validar_proyecto(propuesta) == []


def test_propuesta_no_modifica_el_original() -> None:
    base = _proyecto_base()
    copia = json.loads(json.dumps(base))
    trazado.proponer_proyecto(base, _lectura())
    assert base == copia


def test_null_sin_informacion_faltante_falla() -> None:
    propuesta = trazado.proponer_proyecto(_proyecto_base(), _lectura())
    propuesta["informacion_faltante"] = [
        f for f in propuesta["informacion_faltante"] if not f.startswith("cubierta-01/azimut_deg")
    ]
    assert any("azimut_deg: está en null" in e for e in errores_pendientes(propuesta))


def test_fuera_de_borrador_no_se_admiten_pendientes() -> None:
    propuesta = trazado.proponer_proyecto(_proyecto_base(), _lectura())
    propuesta["estado"] = "en_revision"
    assert any("exige que no haya datos pendientes" in e for e in errores_pendientes(propuesta))


@pytest.mark.parametrize(("lat", "valido"), [(3.32, True), (3.319689532070376, False)])
def test_coordenadas_redondeadas_en_el_proyecto(lat: float, valido: bool) -> None:
    p = _proyecto_base()
    p["ubicacion"]["latitud_deg"] = lat
    assert (errores_privacidad(p) == []) is valido


def test_obstaculo_fuera_de_la_cubierta_se_detecta() -> None:
    lectura = _lectura()
    lectura["cubiertas"][0]["obstaculos"][0]["contorno_px"] = [
        [195, 140],
        [210, 140],
        [210, 160],
        [195, 160],
    ]
    propuesta = trazado.proponer_proyecto(_proyecto_base(), lectura)
    assert any("se sale de la cubierta" in e for e in validar.validar_proyecto(propuesta))


# --- Fotos -------------------------------------------------------------------


def test_foto_con_gps_no_copia_coordenadas(tmp_path: Path) -> None:
    carpeta = tmp_path / "privado" / "fotos"
    carpeta.mkdir(parents=True)
    exif = Image.Exif()
    exif[ExifTags.Base.Make] = "CamaraPrueba"
    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
    gps[ExifTags.GPS.GPSLatitudeRef] = "N"
    gps[ExifTags.GPS.GPSLatitude] = (3.0, 19.0, 11.0)
    Image.new("RGB", (40, 30), "white").save(carpeta / "techo.jpg", exif=exif)
    (insumo,) = fotos.insumos_de_fotos(tmp_path)
    assert insumo["archivo"] == "privado/fotos/techo.jpg"
    assert "trae GPS" in insumo["descripcion"]
    assert "CamaraPrueba" in insumo["descripcion"]
    assert "3.0" not in insumo["descripcion"] and "19" not in insumo["descripcion"]


# --- Recorrido completo por la línea de comandos -----------------------------


def test_cli_nuevo_proponer_aplicar(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    monkeypatch.setattr(validar, "DIR_PROYECTOS", tmp_path)
    assert (
        cli(
            [
                "nuevo",
                "casa-prueba",
                "--nombre",
                "Casa de prueba",
                "--municipio",
                "Cali",
                "--departamento",
                "Valle del Cauca",
                "--lat",
                "3.319689",
                "--lon",
                "-76.544112",
            ]
        )
        == 0
    )
    carpeta = tmp_path / "casa-prueba"
    proyecto = validar.cargar_json(carpeta / "proyecto.json")
    assert proyecto["ubicacion"]["latitud_deg"] == 3.32  # redondeada
    privados = validar.cargar_json(carpeta / "privado" / "datos_privados.json")
    assert privados["ubicacion_exacta"]["latitud_deg"] == 3.319689  # exacta, fuera de git
    assert "vivienda/cubiertas" in rutas_pendientes(proyecto)

    imagen = Image.new("RGB", (300, 200), (40, 90, 40))
    ImageDraw.Draw(imagen).rectangle([100, 100, 200, 150], fill=(200, 200, 200))
    imagen.save(carpeta / "privado" / "maps.png")
    Image.new("RGB", (40, 30)).save(carpeta / "privado" / "fotos" / "fachada.jpg")
    lectura = _lectura()
    (carpeta / "insumos" / "lectura.json").write_text(json.dumps(lectura), encoding="utf-8")

    assert cli(["proponer", "casa-prueba"]) == 0
    salida = capsys.readouterr().out
    assert "cubierta-01: [10.0, 5.0, 10.0, 5.0]" in salida
    assert "Propuesta válida" in salida
    assert (carpeta / "privado" / "verificacion_trazado.png").is_file()
    # Sin --aplicar, proyecto.json no cambia.
    assert validar.cargar_json(carpeta / "proyecto.json") == proyecto

    assert cli(["proponer", "casa-prueba", "--aplicar"]) == 0
    aplicado = validar.cargar_json(carpeta / "proyecto.json")
    assert aplicado["vivienda"]["cubiertas"][0]["contorno_mm"][2] == [10000, 0]
    assert aplicado["insumos"] == [
        {"archivo": "privado/fotos/fachada.jpg", "descripcion": "Foto · 40×30 px"}
    ]
    assert not (carpeta / "proyecto.propuesta.json").exists()
    assert validar.validar_archivo(carpeta / "proyecto.json") == []


def test_cli_rechaza_propuesta_invalida(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    monkeypatch.setattr(validar, "DIR_PROYECTOS", tmp_path)
    cli(["nuevo", "casa-mala", "--nombre", "X", "--municipio", "Cali", "--departamento", "Valle"])
    carpeta = tmp_path / "casa-mala"
    lectura = _lectura()
    # Contorno cruzado (corbatín)
    lectura["cubiertas"][0]["contorno_px"] = [[100, 100], [200, 150], [200, 100], [100, 150]]
    lectura["cubiertas"][0]["obstaculos"] = []
    (carpeta / "insumos" / "lectura.json").write_text(json.dumps(lectura), encoding="utf-8")
    original = (carpeta / "proyecto.json").read_text()
    assert cli(["proponer", "casa-mala", "--aplicar"]) == 1
    assert "NO es válida" in capsys.readouterr().out
    assert (carpeta / "proyecto.json").read_text() == original
