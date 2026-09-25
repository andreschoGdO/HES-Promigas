# Firma certificada (con ubicación) en las actas de Visitas

## Contexto

El módulo de Visitas en Campo (`/visitas`) tiene 6 tipos de acta: `previa`, `instalacion`,
`emergencia`, `normalizacion`, `om` y `abastecimiento`. Solo **Abastecimiento** tiene firma
dibujada en pantalla (`SignaturePad`, componente en `webapp/src/app/visitas/page.tsx`): un
canvas que se guarda como PNG data-URL en `form_data[key]` y se imprime en el PDF
(`webapp/src/lib/visit-pdf.ts`) dentro de un recuadro con el nombre debajo — sin fecha/hora
ni ubicación. Las otras 5 actas cierran con un nombre de texto plano
(`quien_realiza_visita`) o, en algunos casos, un checkbox de conformidad
(`firma_cliente`) — nunca con un trazo dibujado.

El pedido: que la firma quede "con la ubicación y como si fuera firma de un certificado
digital" — un tratamiento visual y de metadata (nombre, fecha/hora, GPS) que se sienta como
un certificado, no una firma criptográfica real con validez legal de firma digital.

## Alcance

- Se agrega el flujo de firma certificada a **todas las actas** (las 5 que hoy no tienen
  firma dibujada, más Abastecimiento que ya la tiene y hereda el nuevo comportamiento).
- Cada firma captura su **propio GPS** en el momento de certificarse (no se reutiliza el GPS
  general del acta) — dos firmantes de la misma acta pueden certificar en momentos y sitios
  distintos.
- El sello visual muestra: **nombre, fecha/hora y coordenadas GPS** (con link a Google
  Maps), visible siempre junto a la firma, tanto en pantalla como en el PDF.

### Fuera de alcance

- Nada de PKI/certificados criptográficos reales — es metadata de contexto sobre una firma
  dibujada a mano, sin validez legal de firma digital certificada.
- Sin geocodificación inversa (lat/lng → dirección legible) — se muestran coordenadas +
  link a mapa, sin depender de una API externa nueva.
- Sin número de documento del firmante.
- Sin migración de base de datos — todo vive dentro de `field_visits.form_data` (jsonb).

## Modelo de datos

El valor de un campo `type: 'signature'` en `form_data` cambia de:

```ts
string // data-URL PNG, ej. "data:image/png;base64,..."
```

a:

```ts
interface SignatureValue {
  png: string;          // data-URL PNG del trazo, igual que antes
  ts: string;            // ISO 8601, momento de la certificación
  lat: number | null;    // null si el GPS falló o se negó el permiso
  lng: number | null;
}
```

El nombre del firmante sigue siendo un campo de texto **aparte** (mismo patrón que hoy:
`firma_elaboro_nombre` + `firma_elaboro`), no se mete dentro de `SignatureValue`.

**Compatibilidad con datos existentes**: las actas de Abastecimiento ya guardadas antes de
este cambio tienen `form_data[key]` como `string` plano (data-URL sin metadata). Todo el
código que lea un valor de firma debe aceptar ambas formas:

```ts
function parseSignatureValue(raw: unknown): SignatureValue | { png: string; legacy: true } | null {
  if (typeof raw === 'string' && raw.startsWith('data:image')) return { png: raw, legacy: true };
  if (raw && typeof raw === 'object' && 'png' in raw) return raw as SignatureValue;
  return null;
}
```

Una firma `legacy` se sigue mostrando (imagen + nombre), simplemente sin la línea de sello
("Certificada · fecha · GPS") ni en pantalla ni en el PDF.

## Schema (`visit-schemas.ts`)

Se agrega una propiedad opcional `nameKey` a la definición de campo `type: 'signature'`,
apuntando al campo de texto hermano que contiene el nombre del firmante (mismo patrón que
`qtyKey` ya usa `serial_list`):

```ts
{ key: 'firma_elaboro', label: 'Elaboró / Realizó verificación — Firma', type: 'signature', nameKey: 'firma_elaboro_nombre' }
```

Se agrega una sección **"Firmas"** (2 firmantes: nombre + firma certificada cada uno) a los
5 schemas que hoy no la tienen, con nombres de rol ajustados a cada acta:

| Acta | Firmante 1 | Firmante 2 |
|---|---|---|
| `previa` | Técnico | Cliente / Responsable en sitio |
| `instalacion` | Técnico instalador | Cliente / Responsable |
| `emergencia` | Técnico | Responsable en sitio |
| `normalizacion` | Técnico | Contratista |
| `om` | Técnico | Cliente |
| `abastecimiento` | *(sin cambios — ya existe)* | |

Los campos de texto plano que hoy cumplen ese rol (`quien_realiza_visita`) no se eliminan —
la sección "Firmas" es adicional, al final del acta, igual que en Abastecimiento hoy.

## Componente (`SignaturePad` → firma certificada)

Mismo componente, comportamiento ampliado. Estados: `dibujando` → `certificada` (o
`legacy` si viene de datos viejos).

1. **Dibujando**: canvas en blanco o con trazo, botones "Borrar" (como hoy) y "Certificar
   firma" (nuevo, deshabilitado si el canvas está vacío).
2. Al presionar **"Certificar firma"**:
   - Si `nameKey` está configurado y ese campo está vacío, se muestra un mensaje inline
     ("Escribe el nombre antes de certificar") y no continúa.
   - Se llama `navigator.geolocation.getCurrentPosition` (mismo patrón que `captureGeo`
     existente, `enableHighAccuracy: true, timeout: 10000`). Si falla o el usuario niega el
     permiso, se certifica igual con `lat: null, lng: null` y un mensaje no bloqueante
     ("Firma certificada sin ubicación — GPS no disponible").
   - Se arma el `SignatureValue` (`png` del canvas + `ts: new Date().toISOString()` +
     `lat`/`lng`) y se emite por `onChange`.
3. **Certificada**: el canvas se deshabilita (`pointer-events: none` + opacidad reducida
   sutil), y debajo se muestra el sello:

   ```
   🛡 Firma certificada
      <nombre desde nameKey, o "—" si no aplica>
      <fecha corta es-CO> · <hora HH:mm>
      📍 <lat.toFixed(5)>, <lng.toFixed(5)> · Ver en mapa   (o "Ubicación no disponible")
   ```

   Con un botón **"Revocar y volver a firmar"** (pide `confirm()`, igual que
   `deletePhoto`/`deleteVisit`) que limpia el valor a vacío y vuelve a estado "dibujando".
4. **Legacy** (valor es `string` plano): se muestra la imagen + nombre, sin sello, con una
   nota discreta ("Firma registrada antes de esta función — sin datos de certificación") y
   el mismo botón de revocar/rehacer si se necesita reemplazarla.

## PDF (`visit-pdf.ts`)

El bloque que ya dibuja el recuadro de cada firmante (nombre + imagen, usado hoy solo para
`firmasSection`) se generaliza: ahora **toda** acta tiene una sección "Firmas" (excepto que
el fallback de texto plano se conserva como defensa si algún schema futuro no la define).
Debajo de la línea `Nombre: ...` se agrega, solo si el valor no es legacy:

```
Certificada · 25 sep 2026 14:32 · GPS 3.45123, -76.53211
```

con las coordenadas como link cliqueable a Google Maps
(`doc.textWithLink(text, x, y, { url: 'https://www.google.com/maps?q=lat,lng' })`). Si
`lat`/`lng` son `null`, esa parte se omite y queda solo "Certificada · 25 sep 2026 14:32".

## Manejo de errores

- GPS denegado/falla al certificar → certifica igual, sin bloquear (ver arriba).
- Nombre vacío al certificar → bloquea con mensaje inline, no certifica.
- Valor de firma corrupto/inesperado en `form_data` (ni string de imagen ni objeto válido)
  → se trata como vacío (canvas en blanco, estado "dibujando"), sin romper el render.

## Pruebas

- `parseSignatureValue`: casos string-legacy, objeto válido, `null`/`undefined`, objeto
  corrupto.
- Certificar con GPS disponible, con GPS denegado, y con nombre vacío (bloquea).
- Revocar y volver a firmar: limpia el valor y reactiva el canvas.
- PDF: firma nueva (con sello + link), firma legacy (sin sello), sin firma (recuadro vacío
  con línea "Firma").
- Verificación manual en el navegador (no automatizable en headless, como el resto de
  Visitas): certificar en mobile (touch) y desktop (mouse), confirmar que el permiso de GPS
  se pide una sola vez por certificación, y que el link "Ver en mapa" abre las coordenadas
  correctas.
