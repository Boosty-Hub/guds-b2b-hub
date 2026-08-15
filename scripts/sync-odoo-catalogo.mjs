/**
 * Sincroniza el CATÁLOGO (categorías + productos) desde Odoo → Supabase (GUDS).
 *
 * SOLO LECTURA en Odoo. Idempotente en Supabase (upsert por odoo_id).
 *
 * Uso (credenciales por variables de entorno):
 *   ODOO_PG_HOST=... ODOO_PG_USER=... ODOO_PG_PASSWORD=... \
 *   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... \
 *   node scripts/sync-odoo-catalogo.mjs [--apply] [--purge-mock]
 *
 *   (sin flags)      -> DRY RUN: extrae y reporta, NO escribe nada
 *   --apply          -> aplica DDL (odoo_id) + upsert de categorías y productos
 *   --purge-mock     -> además borra la data de prueba (órdenes mock + productos/categorías sin odoo_id)
 *
 * Reglas de negocio acordadas:
 *   - Catálogo = product_template active + sale_ok + type='consu'
 *   - precio_base = último precio de venta del histórico, normalizado a USD
 *       (orden USD -> price_unit ; orden VED -> price_unit_ref)
 *   - Producto sin historial: precio_base = 0 y activo = false (inhabilitado)
 *   - Categorías = complete_name (jerarquía "Padre / Hijo"), solo las que tienen productos
 */
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const PURGE = process.argv.includes('--purge-mock');

const REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Mgmt API ${r.status}: ${JSON.stringify(body)}`);
  return body;
}
// Embebe un array JS como literal jsonb seguro (escapa comillas simples del literal SQL)
const jsonbLit = (arr) => `'${JSON.stringify(arr).replace(/'/g, "''")}'::jsonb`;

// ── 1. EXTRACCIÓN DESDE ODOO (solo lectura) ─────────────────────────────
const odoo = new pg.Client({
  host: process.env.ODOO_PG_HOST, port: 5432,
  user: process.env.ODOO_PG_USER, password: process.env.ODOO_PG_PASSWORD,
  database: 'guds-master.agroo.net.ve', ssl: false,
  connectionTimeoutMillis: 20000, statement_timeout: 120000,
});
await odoo.connect();
let raw;
try {
  raw = (await odoo.query(`
    with precio as (
      select distinct on (pp.product_tmpl_id) pp.product_tmpl_id as tmpl,
        case when so.currency_id=1 then sol.price_unit
             when so.ref_currency_id=1 then sol.price_unit_ref end as usd
      from sale_order_line sol
      join sale_order so on so.id=sol.order_id
      join product_product pp on pp.id=sol.product_id
      where so.state='sale' and sol.display_type is null and sol.price_unit>0
      order by pp.product_tmpl_id, so.date_order desc
    ),
    stock as (
      select pp.product_tmpl_id as tmpl, sum(sq.quantity) as on_hand
      from stock_quant sq
      join stock_location sl on sl.id=sq.location_id and sl.usage='internal'
      join product_product pp on pp.id=sq.product_id
      group by pp.product_tmpl_id
    )
    select pt.id as odoo_id,
      nullif(trim(pt.default_code),'') as sku,
      trim(coalesce(pt.name->>'es_VE', pt.name->>'en_US', pt.name::text)) as nombre,
      coalesce(pt.description_sale->>'es_VE', pt.description_sale->>'en_US', '') as descripcion,
      pt.categ_id as categ_odoo_id,
      trim(pc.complete_name) as categoria_nombre,
      coalesce(u.name->>'es_VE', u.name->>'en_US', u.name::text) as unidad,
      round(pr.usd::numeric, 2) as precio_usd,
      coalesce(round(st.on_hand::numeric), 0) as stock
    from product_template pt
    left join product_category pc on pc.id=pt.categ_id
    left join uom_uom u on u.id=pt.uom_id
    left join precio pr on pr.tmpl=pt.id
    left join stock st on st.tmpl=pt.id
    where pt.active and pt.sale_ok and pt.type='consu'
    order by pt.id`)).rows;
} finally { await odoo.end(); }

// ── 2. TRANSFORMACIÓN ───────────────────────────────────────────────────
const skusUsados = new Set();
const productos = raw.map(p => {
  const tienePrecio = p.precio_usd != null && Number(p.precio_usd) > 0;
  let sku = p.sku || `ODOO-${p.odoo_id}`;
  if (skusUsados.has(sku)) sku = `${sku}-${p.odoo_id}`;   // dedup defensivo
  skusUsados.add(sku);
  return {
    odoo_id: p.odoo_id,
    sku,
    nombre: p.nombre || sku,
    descripcion: p.descripcion || '',
    categ_odoo_id: p.categ_odoo_id,
    unidad: p.unidad || 'Unidad',
    precio_base: tienePrecio ? Number(p.precio_usd) : 0,
    stock_actual: Math.max(0, Number(p.stock) || 0),   // sin negativos en el catálogo
    activo: tienePrecio,                                // sin precio -> inhabilitado
  };
});

// categorías = las que tienen al menos un producto de catálogo
const catMap = new Map();
for (const p of productos) {
  if (p.categ_odoo_id == null) continue;
  const nombre = raw.find(r => r.categ_odoo_id === p.categ_odoo_id)?.categoria_nombre || `cat-${p.categ_odoo_id}`;
  const c = catMap.get(p.categ_odoo_id) || { odoo_id: p.categ_odoo_id, nombre, n: 0 };
  c.n++; catMap.set(p.categ_odoo_id, c);
}
const categorias = [...catMap.values()].sort((a, b) => b.n - a.n)
  .map((c, i) => ({ odoo_id: c.odoo_id, nombre: c.nombre, orden: i }));

const conPrecio = productos.filter(p => p.activo).length;

// ── 3. REPORTE ──────────────────────────────────────────────────────────
console.log(`\n=== SYNC CATÁLOGO ODOO → SUPABASE  [${APPLY ? 'APPLY' : 'DRY-RUN'}${PURGE ? ' +PURGE-MOCK' : ''}] ===`);
console.log('Categorías:', categorias.length);
console.log('Productos :', productos.length, `(con precio/activos: ${conPrecio}, sin precio/inactivos: ${productos.length - conPrecio})`);
console.log('Ejemplos categorías:', categorias.slice(0, 5).map(c => `${c.nombre}`).join(' | '));

if (!APPLY) {
  console.log('\nDRY-RUN: no se escribió nada. Corré con --apply (y --purge-mock la primera vez) para aplicar.');
  process.exit(0);
}

// ── 4. ESCRITURA EN SUPABASE ────────────────────────────────────────────
console.log('\n[1/5] DDL: columnas odoo_id + índices únicos…');
await mgmt(`
  alter table public.categorias add column if not exists odoo_id integer;
  alter table public.productos  add column if not exists odoo_id integer;
  create unique index if not exists categorias_odoo_id_key on public.categorias(odoo_id);
  create unique index if not exists productos_odoo_id_key  on public.productos(odoo_id);`);

if (PURGE) {
  console.log('[2/5] Purga de data mock (órdenes + catálogo sin odoo_id)…');
  await mgmt(`
    delete from carrito                where producto_id in (select id from productos where odoo_id is null);
    delete from favoritos              where producto_id in (select id from productos where odoo_id is null);
    delete from movimientos_inventario where producto_id in (select id from productos where odoo_id is null);
    delete from producto_empaques      where producto_id in (select id from productos where odoo_id is null);
    delete from precios_lista          where producto_id in (select id from productos where odoo_id is null);
    delete from entregas;
    delete from pagos where orden_id is not null;
    delete from orden_items;
    delete from ordenes;
    delete from productos  where odoo_id is null;
    delete from categorias where odoo_id is null;`);
} else {
  console.log('[2/5] (sin --purge-mock: no se borra nada)');
}

console.log('[3/5] Upsert categorías…');
await mgmt(`
  insert into categorias (odoo_id, nombre, icono, color, orden, activo)
  select x.odoo_id, x.nombre, '📦', 'bg-gray-500', x.orden, true
  from jsonb_to_recordset(${jsonbLit(categorias)}) as x(odoo_id int, nombre text, orden int)
  on conflict (odoo_id) do update set nombre=excluded.nombre, orden=excluded.orden;`);

console.log('[4/5] Upsert productos…');
await mgmt(`
  insert into productos (odoo_id, sku, nombre, descripcion, categoria_id, unidad, precio_base, stock_actual, stock_minimo, activo, destacado)
  select x.odoo_id, x.sku, x.nombre, nullif(x.descripcion,''),
    (select c.id from categorias c where c.odoo_id = x.categ_odoo_id),
    x.unidad, x.precio_base, x.stock_actual, 0, x.activo, false
  from jsonb_to_recordset(${jsonbLit(productos)}) as x(
    odoo_id int, sku text, nombre text, descripcion text, categ_odoo_id int,
    unidad text, precio_base numeric, stock_actual numeric, activo boolean)
  on conflict (odoo_id) do update set
    sku=excluded.sku, nombre=excluded.nombre, descripcion=excluded.descripcion,
    categoria_id=excluded.categoria_id, unidad=excluded.unidad,
    precio_base=excluded.precio_base, stock_actual=excluded.stock_actual, activo=excluded.activo;`);

console.log('[5/5] Verificación…');
const v = await mgmt(`select
  (select count(*) from categorias) as categorias,
  (select count(*) from productos) as productos,
  (select count(*) from productos where activo) as productos_activos,
  (select count(*) from productos where not activo) as productos_inactivos,
  (select count(*) from productos where odoo_id is null) as productos_sin_odoo_id`);
console.log(JSON.stringify(v[0] ?? v, null, 1));
console.log('\n✓ Sync completado.');
