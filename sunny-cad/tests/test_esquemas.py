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
    componente["dimensiones"]["largo_mm"] = -1
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


def test_cubierta_plana_muy_inclinada_falla(proyecto: dict[str, Any], biblioteca: dict) -> None:
    proyecto["vivienda"]["cubiertas"][0]["tipo"] = "plana"
    assert _errores(proyecto, biblioteca)  # tiene 15°, el máximo para plana es 5°


def test_proyecto_real_con_componente_de_ejemplo_falla(
    proyecto: dict[str, Any], biblioteca: dict
) -> None:
    proyecto["es_ejemplo"] = False
    assert any("componente de ejemplo" in e for e in _errores(proyecto, biblioteca))
