import { NextResponse } from 'next/server';
import { listDealsByGroup } from '@/lib/activecampaign';

const PIPELINE_VENTAS_ID = '1';   // "Prospectos Sunny" — el embudo es SOLO este pipeline

/**
 * Orden de las etapas del pipeline de ventas — reconstruido a partir de
 * /api/3/dealGroups (ver historial de esta sesión). Los "buckets" del
 * dashboard de referencia ("Proyecto Sunny · Dashboard Comercial", de
 * innovación digital/CIIEG, ajeno a este repo) agrupan varias etapas
 * crudas en una sola categoría comercial — reconstruido comparando
 * capturas de esa herramienta contra los datos reales de TopLeads.
 */
const STAGE_ORDER: Record<string, number> = {
  '20': 1,  // Postulaciones
  '19': 2,  // Evaluación comercial
  '58': 2,  // Pendiente por revisar consumo
  '1': 3,   // Hábitos de Consumo
  '56': 4,  // Validación con negocio
  '57': 5,  // Valoración de escritorio
  '34': 6,  // En dimensionamiento
  '5': 7,   // Dimensionado
  '44': 8,  // Pendiente por enviar oferta
  '7': 9,   // Oferta enviada
  '8': 10,  // Contrato enviado
  '47': 11, // Contrato firmado
  '55': 12, // Instalados
  '30': 13, // PRUEBAS
  '45': 13, // Validar con negocio
  '6': 0,   // No viable — no cuenta en el orden de avance
};

/**
 * GET /api/topleads/funnel-comercial
 *
 * Réplica del "Funnel Comercial" de la herramienta de innovación digital:
 * categorías agrupadas y ACUMULADAS (un lead en "Firmado" también cuenta
 * en "Contrato", "Oferta Comercial" y "Dimensionamiento" — cada bucket es
 * "llegó hasta acá o más lejos"), más el desglose por bandas
 * (Interesados/Evaluación/Cierre/Ejecución) que se ve en la tabla de
 * control diaria de esa herramienta.
 *
 * El embudo es SOLO el pipeline "Prospectos Sunny" (id 1) — "Lista de
 * Espera" es otro pipeline aparte y no se mezcla acá.
 *
 * NOTA DE PRECISIÓN: la mayoría de los números están verificados contra
 * capturas reales del Kanban (En Dimensionamiento, Dimensionado, Pend.
 * Confirm. Oferta/Contrato, Firmados sin Instalar, Instalados, Energizados
 * cierran exacto). El corte entre "Leads Completos" y "Leads Incompletos" y
 * el número exacto de "Descartados" son mejor-esfuerzo — no tenemos acceso
 * al query original de esa herramienta, así que quedan calculados con una
 * regla propia (ver código) que puede no coincidir 1:1 con la de ellos.
 *
 * Se consulta en vivo (sin snapshot): es liviano (1 pipeline paginado), y
 * así nunca queda desactualizado.
 */
export async function GET() {
  try {
    const ventas = await listDealsByGroup(PIPELINE_VENTAS_ID);

    const open = ventas.filter((d) => d.status === '0');
    const lost = ventas.filter((d) => d.status === '2');
    const won = ventas.filter((d) => d.status === '1');

    const openAtStage = (stageId: string) => open.filter((d) => d.stage === stageId).length;
    const openAtLeastOrder = (minOrder: number) =>
      open.filter((d) => (STAGE_ORDER[d.stage] ?? 0) >= minOrder).length;

    // "Completo" = el lead ya pasó la captura inicial de datos (llegó a
    // Hábitos de Consumo, orden 3, o más lejos). Todo lo perdido/ganado ya
    // pasó ese punto igual, así que won cuenta como completo y lost se
    // resta aparte (bucket "Descartados").
    const incompletos = open.filter((d) => {
      const o = STAGE_ORDER[d.stage] ?? 0;
      return o === 1 || o === 2;
    }).length;
    const descartados = lost.length;
    // El embudo es solo el pipeline "Prospectos Sunny" — "Lista de Espera"
    // es otro pipeline aparte y no se mezcla acá.
    const totalLeads = ventas.length;
    const completos = ventas.length - incompletos - descartados; // resto — incluye ganados

    // Funnel acumulado (izquierda): cada bucket = abiertos con orden >= X,
    // + ganados — EXCEPTO "Instalados", que se filtra por GANADO puro. Un
    // deal abierto parado en la etapa "Instalados" todavía se está
    // instalando, no terminó — sigue contando en "Firmado" (que ya lo
    // incluye vía orden >= 11) pero no en "Instalados".
    const dimensionamiento = openAtLeastOrder(6) + won.length;
    const ofertaComercial = openAtLeastOrder(8) + won.length;
    const contrato = openAtLeastOrder(10) + won.length;
    const firmado = openAtLeastOrder(11) + won.length;
    const instalados = won.length; // ganado = instalación terminada
    const energizados = won.length;

    // Bandas (derecha): valores puntuales por etapa cruda, todos abiertos —
    // salvo "Energizados", filtrado por ganado. "En instalación" son los
    // abiertos parados en la etapa "Instalados" (obra en curso, sin
    // terminar todavía) — separado de "Firmados sin Instalar" (contrato
    // firmado, obra sin empezar) para no mezclar "en cola" con "en obra".
    const enDimensionamiento = openAtStage('34');
    const dimensionado = openAtStage('5');
    const pendientesOferta = openAtStage('44');
    const pendConfirmOferta = openAtStage('7');
    const pendConfirmContrato = openAtStage('8');
    const firmadosSinInstalar = openAtStage('47');
    const enInstalacionBanda = openAtStage('55');

    return NextResponse.json({
      capturedAt: new Date().toISOString(),
      funnel: [
        { key: 'total', label: 'Total Leads', value: totalLeads },
        { key: 'completos', label: 'Leads Completos', value: completos },
        { key: 'dimensionamiento', label: 'Dimensionamiento', value: dimensionamiento },
        { key: 'oferta', label: 'Oferta Comercial', value: ofertaComercial },
        { key: 'contrato', label: 'Contrato', value: contrato },
        { key: 'firmado', label: 'Firmado', value: firmado },
        { key: 'instalados', label: 'Instalados', value: instalados },
        { key: 'energizados', label: 'Energizados', value: energizados },
        { key: 'perdidos', label: 'Perdidos', value: descartados },
      ],
      totalLeads,
      bandas: [
        {
          // Sin "Descartados" acá a propósito — el estado Perdido solo se
          // muestra en el Funnel de la izquierda, no en esta tabla.
          nombre: 'INTERESADOS',
          total: totalLeads,
          filas: [
            { label: 'Total Leads', value: totalLeads },
            { label: 'Leads Incompletos', value: incompletos, activos: true },
            { label: 'Leads Completos', value: completos, activos: true },
          ],
        },
        {
          nombre: 'EVALUACIÓN',
          total: enDimensionamiento + dimensionado + pendientesOferta,
          filas: [
            { label: 'En Dimensionamiento', value: enDimensionamiento },
            { label: 'Dimensionado', value: dimensionado },
            { label: 'Pendientes de Oferta', value: pendientesOferta },
          ],
        },
        {
          nombre: 'CIERRE',
          total: pendConfirmOferta + pendConfirmContrato,
          filas: [
            { label: 'Pend. Confirm. Oferta', value: pendConfirmOferta },
            { label: 'Pend. Confirm. Contrato', value: pendConfirmContrato },
          ],
        },
        {
          nombre: 'EJECUCIÓN',
          total: firmadosSinInstalar + enInstalacionBanda + energizados,
          filas: [
            { label: 'Firmados sin Instalar', value: firmadosSinInstalar },
            { label: 'En instalación', value: enInstalacionBanda },
            { label: 'Energizados', value: energizados },
          ],
        },
      ],
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
