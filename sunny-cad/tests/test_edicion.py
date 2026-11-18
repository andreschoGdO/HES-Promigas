"""Pruebas del Paso 8: edición por lenguaje natural con aprobación.

La IA no se llama en las pruebas: el intérprete se prueba con un cliente falso y el flujo con
operaciones escritas a mano.
"""

from __future__ import annotations

import json
import math
import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest

from engine import validar
from engine.edicion import flujo, interprete, operaciones
from engine.edicion.__main__ import main as cli

ID = "natura-barranquilla"
BIB = validar.cargar_biblioteca()


@pytest.fixture
def copia(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    destino = tmp_path / ID
    shutil.copytree(
        validar.DIR_PROYECTOS / ID,
        destino,
        ignore=shutil.ignore_patterns("privado", "render_*.png", "planos", "*.glb", "*.ifc"),
    )
    monkeypatch.setattr(validar, "DIR_PROYECTOS", tmp_path)
    return destino


def _estado(carpeta: Path) -> dict:
    e = flujo.cargar_estado(carpeta)
    e["_recalcular"], e["_quitar_modulos"] = set(), set()
    return e


# --------------------------------------------------------------------------- operaciones
def test_establecer_cambia_solo_campos_existentes(copia: Path) -> None:
    e = _estado(copia)
    operaciones.establecer(e, "electrico", "buitron.alto_mm", 600)
    assert e["electrico"]["buitron"]["alto_mm"] == 600
    with pytest.raises(operaciones.ErrorOperacion, match="no existe el campo"):
        operaciones.establecer(e, "electrico", "buitron.altura_mm", 600)  # typo: no se crea
    with pytest.raises(operaciones.ErrorOperacion, match="lo calculan los motores"):
        operaciones.establecer(e, "proyecto", "equipos[id=inversor-01].componente_ref", "x")
    with pytest.raises(operaciones.ErrorOperacion, match="mal escrita"):
        operaciones.establecer(e, "proyecto", "sistema..tipologia", "T1")


def test_mover_equipo_a_lo_largo_del_muro(copia: Path) -> None:
    e = _estado(copia)
    antes = list(e["electrico"]["ubicaciones"]["inversor-01"]["punto"])
    operaciones.mover_equipo(e, "inversor-01", a_lo_largo_mm=300, subir_mm=-200)
    ub = e["electrico"]["ubicaciones"]["inversor-01"]
    assert math.dist(antes, ub["punto"]) == pytest.approx(300, abs=1)
    assert ub["z_mm"] == 1300
    with pytest.raises(operaciones.ErrorOperacion, match="bajo el piso"):
        operaciones.mover_equipo(e, "inversor-01", subir_mm=-5000)
    with pytest.raises(operaciones.ErrorOperacion, match="no hay ubicación"):
        operaciones.mover_equipo(e, "inversor-09", subir_mm=10)


def test_cambiar_bateria_exige_configuracion_de_la_ficha(copia: Path) -> None:
    e = _estado(copia)
    with pytest.raises(operaciones.ErrorOperacion, match="no existe"):
        operaciones.cambiar_equipo(e, "bateria", "deye-gb-l", "m99", biblioteca=BIB)
    with pytest.raises(operaciones.ErrorOperacion, match="no está en la biblioteca"):
        operaciones.cambiar_equipo(e, "inversor", "inversor-inventado", biblioteca=BIB)


def test_operacion_desconocida() -> None:
    with pytest.raises(operaciones.ErrorOperacion, match="desconocida"):
        operaciones.aplicar({"proyecto": {}}, [{"op": "borrar_todo"}], BIB)


# --------------------------------------------------------------------------- flujo
def test_proponer_no_toca_los_archivos_y_aplicar_si(copia: Path) -> None:
    original = (copia / "proyecto.json").read_text()
    ops = [
        {"op": "mover_equipo", "id": "inversor-01", "a_lo_largo_mm": 0, "subir_mm": 100},
        {
            "op": "establecer",
            "archivo": "proyecto",
            "ruta": "sistema.arquitectura",
            "valor": "paralelo",
        },
    ]
    p = flujo.proponer(ID, ops, "sube el inversor 10 cm y pasa a paralelo")
    assert p["valida"], p["errores"]
    assert (copia / "proyecto.json").read_text() == original  # nada cambia aún
    diff = (copia / flujo.CARPETA_PROPUESTA / "cambios.diff").read_text()
    assert '"arquitectura": "paralelo"' in diff and "1600" in diff
    flujo.aplicar(ID)
    proyecto = validar.cargar_json(copia / "proyecto.json")
    assert proyecto["sistema"]["arquitectura"] == "paralelo"
    inv = next(x for x in proyecto["equipos"] if x["id"] == "inversor-01")
    assert inv["ubicacion_mm"]["z_mm"] == 1600  # el motor eléctrico copió la ubicación
    historial = validar.cargar_json(copia / "historial_ediciones.json")
    assert historial[-1]["instruccion"].startswith("sube el inversor")
    assert not (copia / "propuestas").exists()


def test_cambiar_zona_redistribuye(copia: Path) -> None:
    p = flujo.proponer(
        ID,
        [{"op": "cambiar_zona", "zona": "zona-01", "campos": {"orientacion_modulo": "horizontal"}}],
    )
    assert p["valida"], p["errores"]
    prop = validar.cargar_json(copia / flujo.CARPETA_PROPUESTA / "proyecto.json")
    mods = [e for e in prop["equipos"] if e["tipo"] == "modulo"]
    assert len(mods) == p["sistema_despues"]["modulos"]
    assert all(m["colocacion"]["orientacion"] == "horizontal" for m in mods)
    assert prop["vivienda"]["zonas_instalacion"][0]["orientacion_modulo"] == "horizontal"


def test_quitar_modulos_libera_los_strings_fijos(copia: Path) -> None:
    p = flujo.proponer(ID, [{"op": "quitar_modulos", "ids": ["modulo-008"]}])
    assert p["sistema_despues"]["modulos"] == 7
    assert any("strings fijados" in a for a in p["avisos"])


def test_propuesta_invalida_no_se_aplica(copia: Path) -> None:
    # Batería de otra marca: el validador la rechaza (cada batería con su propio inversor)
    otra = next(c["id"] for c in BIB.values() if c["tipo"] == "bateria" and "livoltek" in c["id"])
    conf = BIB[otra]["electrico"]["configuraciones"][0]["id"]
    p = flujo.proponer(
        ID, [{"op": "cambiar_equipo", "tipo": "bateria", "componente": otra, "configuracion": conf}]
    )
    assert not p["valida"]
    original = (copia / "proyecto.json").read_text()
    with pytest.raises(operaciones.ErrorOperacion, match="no es válida"):
        flujo.aplicar(ID)
    assert (copia / "proyecto.json").read_text() == original
    assert flujo.descartar(ID) and not (copia / "propuestas").exists()


def test_cli_con_operaciones(copia: Path, tmp_path: Path) -> None:
    ops = tmp_path / "ops.json"
    ops.write_text(json.dumps([{"op": "cambiar_strings", "strings": [4, 4]}]))
    assert cli(["proponer", ID, "--operaciones", str(ops)]) == 0
    assert cli(["ver", ID]) == 0
    assert cli(["aplicar", ID]) == 0
    calc = validar.cargar_json(copia / "salidas" / "calculo_electrico.json")
    assert [s["modulos"] for s in calc["strings"]] == [4, 4]


# --------------------------------------------------------------------------- intérprete
class _ClienteFalso:
    def __init__(self, respuesta: dict) -> None:
        self.respuesta, self.pedido = respuesta, None
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.pedido = kw
        bloque = SimpleNamespace(type="text", text=json.dumps(self.respuesta))
        return SimpleNamespace(stop_reason="end_turn", content=[bloque])


def test_interprete_traduce_a_operaciones(copia: Path) -> None:
    falso = _ClienteFalso(
        {
            "operaciones": [
                {"op": "mover_equipo", "id": "inversor-01", "a_lo_largo_mm": 0, "subir_mm": 200},
                {
                    "op": "cambiar_zona",
                    "zona": "zona-01",
                    "inclinacion_deg": 10,
                    "azimut_deg": None,
                    "orientacion_modulo": None,
                    "separacion_mm": None,
                    "retiro_mm": None,
                    "altura_estructura_mm": None,
                },
                {
                    "op": "establecer",
                    "archivo": "electrico",
                    "ruta": "buitron.alto_mm",
                    "valor_json": "600",
                },
            ],
            "explicacion": "Subo el inversor 20 cm, inclino a 10° y el brocal a 0,6 m.",
            "preguntas": [],
        }
    )
    r = interprete.interpretar("sube el inversor 20 cm…", flujo.cargar_estado(copia), BIB, falso)
    assert r["operaciones"][1] == {
        "op": "cambiar_zona",
        "zona": "zona-01",
        "campos": {"inclinacion_deg": 10},
    }
    assert r["operaciones"][2]["valor"] == 600
    pedido = falso.pedido
    assert pedido["model"] == "claude-opus-5-5"
    assert pedido["output_config"]["format"]["type"] == "json_schema"
    assert "tool_choice" not in pedido
    # El contexto no lleva datos personales (privado/ no se lee)
    assert "cliente" not in pedido["messages"][0]["content"]
    # Las operaciones traducidas se aplican con el flujo normal
    assert flujo.proponer(ID, r["operaciones"])["valida"]


def test_interprete_rechazo() -> None:
    falso = _ClienteFalso({})
    falso.beta.messages.create = lambda **kw: SimpleNamespace(stop_reason="refusal", content=[])
    estado = flujo.cargar_estado(validar.DIR_PROYECTOS / ID)
    with pytest.raises(interprete.ErrorInterprete):
        interprete.interpretar("x", estado, BIB, falso)
