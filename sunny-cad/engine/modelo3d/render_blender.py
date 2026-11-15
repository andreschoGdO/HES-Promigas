"""Render con Blender (se ejecuta dentro de Blender, sin interfaz).

    blender -b --factory-startup --python render_blender.py -- \
        <modelo.glb> <vistas.json> <carpeta_salida> [ancho alto muestras]

vistas.json: [{"nombre", "camara": [x, y, z], "objetivo": [x, y, z], "lente_mm"}, ...] en metros,
X este, Y norte, Z arriba (coordenadas del proyecto / 1000, así importa Blender el glTF).
"""

import json
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :]
glb, vistas_json, salida = args[0], args[1], args[2]
ancho, alto, muestras = (int(a) for a in (args[3:6] if len(args) >= 6 else (1600, 1000, 48)))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)

# Material mate a partir del color de vértice/cara de glTF; los módulos algo brillantes.
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    for slot in obj.material_slots:
        mat = slot.material
        if mat and mat.use_nodes:
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Roughness"].default_value = (
                    0.35 if obj.name.startswith("modulo") else 0.8
                )

escena = bpy.context.scene
escena.render.engine = "CYCLES"
escena.cycles.device = "CPU"
escena.cycles.samples = muestras
escena.cycles.use_denoising = True
try:
    escena.cycles.denoiser = "OPENIMAGEDENOISE"
except TypeError:
    escena.cycles.use_denoising = False
escena.render.resolution_x, escena.render.resolution_y = ancho, alto
try:
    escena.view_settings.view_transform = "AgX"
except TypeError:
    escena.view_settings.view_transform = "Filmic"
escena.view_settings.look = "None"

mundo = bpy.data.worlds.new("cielo")
mundo.use_nodes = True
mundo.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.78, 0.95, 1)
mundo.node_tree.nodes["Background"].inputs[1].default_value = 0.6
escena.world = mundo

sol = bpy.data.objects.new("sol", bpy.data.lights.new("sol", type="SUN"))
sol.data.energy = 3.0
sol.data.angle = 0.02
sol.rotation_euler = (math.radians(35), math.radians(15), math.radians(160))
escena.collection.objects.link(sol)

bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.25))
suelo = bpy.context.active_object
mat_suelo = bpy.data.materials.new("suelo")
mat_suelo.use_nodes = True
mat_suelo.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
    0.42,
    0.44,
    0.40,
    1,
)
suelo.data.materials.append(mat_suelo)

camara = bpy.data.objects.new("camara", bpy.data.cameras.new("camara"))
escena.collection.objects.link(camara)
escena.camera = camara

for v in json.load(open(vistas_json)):
    camara.location = Vector(v["camara"])
    direccion = Vector(v["objetivo"]) - camara.location
    camara.rotation_euler = direccion.to_track_quat("-Z", "Y").to_euler()
    camara.data.lens = v.get("lente_mm", 35)
    escena.render.filepath = f"{salida}/render_{v['nombre']}.png"
    bpy.ops.render.render(write_still=True)
