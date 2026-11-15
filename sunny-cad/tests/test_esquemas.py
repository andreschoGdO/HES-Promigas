"""Pruebas de los contratos de datos (Paso 1)."""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import pytest

from engine import validar

EJEMPLO_COMPONENTE = (
    validar.DIR_BIBLIOTECA / "inversores" / "ejemplo-inversor-hibrido-bifasico.json"
)
EJEMPLO_PROYECTO = validar.DIR_PROYECTOS / "ejemplo-vivienda-001" / "proyecto.json"


@pytest.fixture
def componente() -> dict[str, Any]:
    return validar.cargar_json(EJEMPLO_COMPONENTE)


@pytest.fixture
def proyecto() -> dict[str, Any]:
    return validar.cargar_json(EJEMPLO_PROYECTO)


@pytest.fixture
def biblioteca(componente: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {componente["id"]: componente}


@pytest.mark.parametrize("nombre", ["componente", "proyecto"])
def test_esquemas_bien_formados(nombre: str) -> None:
    validar.validador(nombre)  # lanza excepción si el esquema no es válido


# --- Ejemplos válidos --------------------------------------------------------


def test_ejemplo_componente_valido() -> None:
    assert validar.validar_archivo(EJEMPLO_COMPONENTE) == []


def test_ejemplo_proyecto_valido() -> None:
    assert validar.validar_archivo(EJEMPLO_PROYECTO) == []


def test_ejemplos_marcados_como_ficticios(
    componente: dict[str, Any], proyecto: dict[str, Any]
) -> None:
    assert componente["es_ejemplo"] is True
    assert proyecto["es_ejemplo"] is True
    assert "no real" in componente["fuente"]["documento"].lower()


def test_script_valida_todo(capsys: pytest.CaptureFixture[str]) -> None:
    assert validar.main([]) == 0
    assert "0 error(es)" in capsys.readouterr().out


# --- Componente: casos que deben fallar --------------------------------------


def test_componente_sin_fuente_falla(componente: dict[str, Any]) -> None:
    del componente["fuente"]
    assert any("fuente" in e for e in validar.validar_componente(componente))


def test_componente_fuente_sin_documento_falla(componente: dict[str, Any]) -> None:
    del componente["fuente"]["documento"]
    assert validar.validar_componente(componente)


def test_inversor_hibrido_sin_puerto_bateria_falla(componente: dict[str, Any]) -> None:
    del componente["electrico"]["bateria"]
    assert validar.validar_componente(componente)


def test_dimension_negativa_falla(componente: dict[str, Any]) -> None:
    componente["dimensiones"]["ancho_mm"] = -1
    assert validar.validar_componente(componente)


def test_id_con_mayusculas_falla(componente: dict[str, Any]) -> None:
    componente["id"] = "Inversor-Ejemplo"
    assert validar.validar_componente(componente)


def test_id_distinto_al_archivo_falla(componente: dict[str, Any]) -> None:
    errores = validar.validar_componente(componente, Path("otro-nombre.json"))
    assert any("no coincide con el archivo" in e for e in errores)


# --- Proyecto: casos que deben fallar ----------------------------------------


def _errores(proyecto: dict[str, Any], biblioteca: dict[str, dict[str, Any]]) -> list[str]:
    return validar.validar_proyecto(proyecto, biblioteca=biblioteca)


def test_proyecto_valido_en_memoria(proyecto: dict[str, Any], biblioteca: dict) -> None:
    assert _errores(proyecto, biblioteca) == []


def test_unidad_distinta_de_mm_falla(proyecto: dict[str, Any], biblioteca: dict) -> None:
    proyecto["sistema_coordenadas"]["unidad_longitud"] = "m"
    assert _errores(proyecto, biblioteca)


@pytest.mark.parametrize(
    ("arquitectura", "conmutacion", "valido"),
    [
        ("serie", "bypass", True),
        ("serie", "ats", True),
        ("serie", "smartguard", False),
        ("paralelo", "ats", True),
        ("paralelo", "smartguard", True),
        ("paralelo", "bypass", False),
    ],
)
def test_regla_arquitectura_conmutacion(
    proyecto: dict[str, Any], biblioteca: dict, arquitectura: str, conmutacion: str, valido: bool
) -> None:
    proyecto["sistema"]["arquitectura"] = arquitectura
    proyecto["sistema"]["conmutacion"] = conmutacion
    assert (_errores(proyecto, biblioteca) == []) is valido


@pytest.mark.parametrize(
    ("tipologia", "fases", "valido"),
    [("T1", "bifasica", True), ("T1", "trifasica", False), ("T2", "trifasica", True)],
)
def test_regla_tipologia_fases(
    proyecto: dict[str, Any], biblioteca: dict, tipologia: str, fases: str, valido: bool
) -> None:
    proyecto["sistema"]["tipologia"] = tipologia
    proyecto["sistema"]["fases_red"] = fases
    assert (_errores(proyecto, biblioteca) == []) is valido


@pytest.mark.parametrize("id_malo", ["inversor-1", "Inversor-01", "modulo-01", "bateria-01"])
def test_id_equipo_invalido_falla(proyecto: dict[str, Any], biblioteca: dict, id_malo: str) -> None:
    proyecto["equipos"][0]["id"] = id_malo  # el tipo sigue siendo 'inversor'
    assert _errores(proyecto, biblioteca)


def test_componente_ref_inexistente_falla(proyecto: dict[str, Any], biblioteca: dict) -> None:
    proyecto["equipos"][0]["componente_ref"] = "no-existe"
    assert any("no existe en library" in e for e in _errores(proyecto, biblioteca))


def test_equipo_repetido_falla(proyecto: dict[str, Any], biblioteca: dict) -> None:
    proyecto["equipos"].append(copy.deepcopy(proyecto["equipos"][0]))
    assert any("repetido" in e for e in _errores(proyecto, biblioteca))


def test_contorno_cruzado_falla(proyecto: dict[str, Any], biblioteca: dict) -> None:
    # Forma de "corbatín": los lados se cruzan.
    proyecto["vivienda"]["cubiertas"][0]["contorno_mm"] = [
        [0, 0],
        [1000, 1000],
        [1000, 0],
        [0, 1000],
    ]
    assert any("polígono válido" in e for e in _errores(proyecto, biblioteca))


def test_obstaculo_fuera_de_cubierta_falla(proyecto: dict[str, Any], biblioteca: dict) -> None:
    obstaculo = proyecto["vivienda"]["cubiertas"][0]["obstaculos"][0]
    obstaculo["contorno_mm"] = [[9500, 7500], [10500, 7500], [10500, 8500], [9500, 8500]]
    assert any("se sale de la cubierta" in e for e in _errores(proyecto, biblioteca))


def test_proyecto_real_con_componente_de_ejemplo_falla(
    proyecto: dict[str, Any], biblioteca: dict
) -> None:
    proyecto["es_ejemplo"] = False
    assert any("componente de ejemplo" in e for e in _errores(proyecto, biblioteca))


def test_tipo_de_cubierta_lo_decide_el_usuario(proyecto: dict[str, Any], biblioteca: dict) -> None:
    # Sin regla automática: una cubierta "plana" con 15° es válida si así la declara el usuario.
    proyecto["vivienda"]["cubiertas"][0]["tipo"] = "plana"
    assert _errores(proyecto, biblioteca) == []


# --- Baterías modulares (datos ficticios, solo para probar la estructura) ----


def _bateria_ficticia() -> dict[str, Any]:
    dims = {"ancho_mm": 500, "alto_mm": 200, "profundidad_mm": 300, "peso_kg": 40}
    return {
        "version_esquema": "1.1.0",
        "id": "ejemplo-bateria-modular",
        "tipo": "bateria",
        "es_ejemplo": True,
        "fabricante": "EJEMPLO, NO REAL",
        "modelo": "BAT-EJEMPLO",
        "fuente": {
            "documento": "Ficha ficticia, no real",
            "revision": "sin revision",
            "fecha_consulta": "2026-11-15",
        },
        "electrico": {
            "tecnologia": "lfp",
            "nivel_tension": "alta",
            "tiene_bms": True,
            "modulo_bateria": {"modelo": "MOD-EJEMPLO", "energia_kwh": 5, "dimensiones": dims},
            "partes": [
                {"modelo": "BMS-EJEMPLO", "funcion": "control_bms", "cantidad_por_sistema": 1}
            ],
            "configuraciones": [
                {"id": "m2", "modulos_bateria": 2, "energia_util_kwh": 9},
                {"id": "m3", "modulos_bateria": 3, "energia_util_kwh": 13.5},
            ],
        },
    }


def test_bateria_modular_valida_sin_dimensiones_globales() -> None:
    assert validar.validar_componente(_bateria_ficticia()) == []


def test_bateria_sin_configuraciones_falla() -> None:
    bateria = _bateria_ficticia()
    bateria["electrico"]["configuraciones"] = []
    assert validar.validar_componente(bateria)


def test_inversor_sin_dimensiones_falla(componente: dict[str, Any]) -> None:
    del componente["dimensiones"]
    assert validar.validar_componente(componente)


@pytest.mark.parametrize(
    ("configuracion", "mensaje"),
    [(None, "falta"), ("m9", "no existe"), ("m3", None)],
)
def test_configuracion_de_bateria_en_proyecto(
    proyecto: dict[str, Any], biblioteca: dict, configuracion: str | None, mensaje: str | None
) -> None:
    bateria = _bateria_ficticia()
    biblioteca[bateria["id"]] = bateria
    equipo: dict[str, Any] = {
        "id": "bateria-01",
        "tipo": "bateria",
        "componente_ref": bateria["id"],
    }
    if configuracion is not None:
        equipo["configuracion"] = configuracion
    proyecto["equipos"].append(equipo)
    errores = _errores(proyecto, biblioteca)
    if mensaje is None:
        assert errores == []
    else:
        assert any(mensaje in e for e in errores)


def test_configuracion_en_equipo_que_no_es_bateria_falla(
    proyecto: dict[str, Any], biblioteca: dict
) -> None:
    proyecto["equipos"][0]["configuracion"] = "m3"
    assert any("solo aplica a baterías" in e for e in _errores(proyecto, biblioteca))


# --- Módulo FV (datos ficticios) ---------------------------------------------


def test_modulo_ficticio_valido() -> None:
    modulo = {
        "version_esquema": "1.1.0",
        "id": "ejemplo-modulo",
        "tipo": "modulo",
        "es_ejemplo": True,
        "fabricante": "EJEMPLO, NO REAL",
        "modelo": "MOD-EJEMPLO",
        "fuente": {
            "documento": "Ficha ficticia, no real",
            "revision": "sin revision",
            "fecha_consulta": "2026-11-15",
        },
        "dimensiones": {"ancho_mm": 1000, "alto_mm": 2000, "profundidad_mm": 30, "peso_kg": 30},
        "electrico": {
            "potencia_stc_w": 500,
            "voc_v": 50,
            "isc_a": 12,
            "vmp_v": 42,
            "imp_a": 11.9,
            "coef_temp_voc_pct_c": -0.25,
            "coef_temp_pmax_pct_c": -0.3,
            "tension_max_sistema_v": 1500,
            "bifacial": True,
            "bifacialidad_pct": 80,
        },
    }
    assert validar.validar_componente(modulo) == []
    del modulo["electrico"]["voc_v"]
    assert validar.validar_componente(modulo)


# --- Datos privados -----------------------------------------------------------


def test_plantilla_de_datos_privados_cumple_esquema_al_llenarla() -> None:
    plantilla = validar.cargar_json(validar.RAIZ / "templates" / "datos_privados.plantilla.json")
    assert validar.validar_datos_privados(plantilla)  # vacía: falta el nombre
    plantilla["cliente"]["nombre"] = "Cliente de ejemplo"
    plantilla["ingeniero_responsable"]["nombre"] = "Ingeniero de ejemplo"
    assert validar.validar_datos_privados(plantilla) == []


def test_carpeta_privado_esta_ignorada_por_git() -> None:
    ignorados = (validar.RAIZ / ".gitignore").read_text(encoding="utf-8")
    assert "projects/*/privado/" in ignorados
