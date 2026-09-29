// Almacenamiento de Supabase para scripts (fotos de producto de Odoo, 20r). La secret key no se guarda en disco: se pide a la
// Management API con SUPABASE_ACCESS_TOKEN al arrancar y vive solo en memoria. Solo para scripts de mantenimiento/importación.
import { requerir } from './entorno.mjs';
import { crearStorage } from '../../supabase/functions/_shared/odoo-sync/storage.js';

export async function crearStorageAdmin() {
  const { SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_PROJECT_REF: REF } = requerir('SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF');
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`No se pudo obtener la clave del almacenamiento (${r.status})`);
  const claves = await r.json();
  const secreta = claves.find((k) => k.type === 'secret' && k.name === 'default') || claves.find((k) => k.type === 'secret');
  if (!secreta?.api_key) throw new Error('El proyecto no tiene una secret key');
  return crearStorage({ url: `https://${REF}.supabase.co`, clave: secreta.api_key });
}
