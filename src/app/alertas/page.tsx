'use client';

// La página /alertas y el tab NAR del dashboard comparten el mismo
// componente NarFullView — un único lugar mantiene la vista completa
// de Ranking, Notificaciones, Alertas, Recomendaciones, Reactiva, Reglas.
import { NarFullView } from '@/components/NarFullView';

export default function NarPage() {
  return <NarFullView />;
}
