// Notas "(GUDS)" en el historial de Odoo (decisión D del dueño, 29-sep): la traza de lo que GUDS crea o cambia en Odoo.
// La nota es siempre interna (odoo.js → nota(): message_type 'comment' + subtipo "Nota", sin destinatarios): no envía correos.
// Si la nota falla, la escritura principal NO se revierte: el error queda en el resultado de la escritura (campo `nota`).
// En modo simular no se envía nada: la nota queda solo en el plan, con el texto que se dejaría.

const MAX = 1500;

// Recorta un texto largo para la nota (Odoo lo guarda como texto plano)
export const recortar = (t, n = MAX) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

// Deja (o simula) una nota. Nunca lanza: devuelve { modelo, id, texto, ok | simulada, error? }.
export async function dejarNota(odoo, { modelo, id, texto }, cid, aplicar) {
  const nota = { modelo, id, texto: recortar(texto) };
  if (!aplicar) return { ...nota, simulada: true };
  try {
    const mensajeId = await odoo.nota(modelo, id, nota.texto, cid);
    return { ...nota, ok: true, mensaje_id: typeof mensajeId === 'number' ? mensajeId : null };
  } catch (e) {
    return { ...nota, ok: false, error: String(e?.message || e).slice(0, 300) };
  }
}

// "campo: antes → después" para las notas de cambios
export const cambiosTexto = (cambios = []) => cambios.map((c) => `${c.etiqueta ?? c.campo}: ${c.antes ?? '—'} → ${c.despues ?? '—'}`).join('; ');
