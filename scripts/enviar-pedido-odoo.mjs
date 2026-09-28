/**
 * Envía UN pedido de GUDS a Odoo como cotización (borrador), marcado "(GUDS)". Fase 9b de docs/PLAN-ESPEJO-ODOO.md.
 * Nunca borra ni modifica nada en Odoo; si la cotización ya existe (misma referencia), solo la vincula.
 *
 *   node scripts/enviar-pedido-odoo.mjs <número o id del pedido>            → simulación: muestra lo que se enviaría
 *   node scripts/enviar-pedido-odoo.mjs <número o id del pedido> --apply    → crea la cotización en Odoo y la vincula
 */
import { requerir } from './lib/entorno.mjs';
import { sql } from './lib/supabase-admin.mjs';
import { crearClienteOdoo } from '../supabase/functions/_shared/odoo-sync/odoo.js';
import { enviarPedido } from '../supabase/functions/_shared/odoo-sync/enviar.js';

const [clave] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!clave) { console.error('Uso: node scripts/enviar-pedido-odoo.mjs <número o id del pedido> [--apply]'); process.exit(1); }
const aplicar = process.argv.includes('--apply');
const nota = (process.argv.find((a) => a.startsWith('--nota=')) || '').slice(7);

const esUuid = /^[0-9a-f-]{36}$/i.test(clave);
const [orden] = await sql(`select id, numero from ordenes where ${esUuid ? `id = '${clave}'` : `numero = '${clave.replace(/'/g, "''")}' or numero_guds = '${clave.replace(/'/g, "''")}'`}`);
if (!orden) { console.error(`No existe el pedido ${clave}`); process.exit(1); }

const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY } = requerir('ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_API_KEY');
const odoo = crearClienteOdoo({ url: ODOO_URL, db: ODOO_DB, usuario: ODOO_USER, apiKey: ODOO_API_KEY });
const r = await enviarPedido({ odoo, sql, ordenId: orden.id, aplicar, nota });
console.log(JSON.stringify(aplicar ? { odoo: { id: r.odoo.id, nombre: r.odoo.name, estado: r.odoo.state, total: r.odoo.amount_total, moneda: r.odoo.currency_id?.[1],
  vendedor: r.odoo.user_id?.[1], referencia: r.odoo.client_order_ref, origen: r.odoo.origin, lineas: r.odoo.lineas.map((l) => ({ producto: l.product_id?.[1], cantidad: l.product_uom_qty, precio: l.price_unit, subtotal: l.price_subtotal })) },
  almacen: r.odoo.warehouse_id?.[1], aviso: r.aviso, lineasVinculadas: r.lineasVinculadas } : { pedido: r.pedido, empresa: r.empresa, cliente: r.cliente, moneda: r.moneda, almacen: r.almacen, aviso: r.aviso, existente: r.existente, vals: r.vals }, null, 2));
