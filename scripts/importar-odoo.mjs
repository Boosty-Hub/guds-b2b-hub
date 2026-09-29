/**
 * Importa Odoo → GUDS (espejo) por la API de Odoo, separado por empresa. Fase 2 de docs/PLAN-ESPEJO-ODOO.md.
 * El motor vive en supabase/functions/_shared/odoo-sync/ (lo reutilizará la sincronización periódica).
 *
 *   node scripts/importar-odoo.mjs            → simulación: lee Odoo y muestra qué importaría
 *   node scripts/importar-odoo.mjs --apply    → escribe en Supabase (queda registrado en sync_corridas)
 *
 * Antes de aplicar conviene un respaldo: node scripts/respaldo-supabase.mjs
 */
import { requerir } from './lib/entorno.mjs';
import { sql } from './lib/supabase-admin.mjs';
import { crearStorageAdmin } from './lib/storage-admin.mjs';
import { crearClienteOdoo } from '../supabase/functions/_shared/odoo-sync/odoo.js';
import { importarOdoo } from '../supabase/functions/_shared/odoo-sync/importar.js';

const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY } = requerir('ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_API_KEY');
const odoo = crearClienteOdoo({ url: ODOO_URL, db: ODOO_DB, usuario: ODOO_USER, apiKey: ODOO_API_KEY });

// Fotos de producto que cambian en Odoo (20r): sin acceso al almacenamiento la importación sigue, solo no las trae
const storage = await crearStorageAdmin().catch((e) => { console.warn(`⚠ ${e.message}: no se traerán fotos de Odoo`); return null; });

const resumen = await importarOdoo({ odoo, sql, storage, aplicar: process.argv.includes('--apply') });
console.log('\nResumen:');
console.table(resumen.entidades);
if (resumen.contenido) console.log('Fotos y descripciones:', JSON.stringify(resumen.contenido));
if (resumen.avisos.length) console.log('Avisos:\n- ' + resumen.avisos.join('\n- '));
