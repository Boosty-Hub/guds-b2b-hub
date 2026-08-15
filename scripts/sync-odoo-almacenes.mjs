/**
 * Sincroniza ALMACENES + INVENTARIO desde Odoo → Supabase.
 * SOLO LECTURA en Odoo. Idempotente.
 *   node scripts/sync-odoo-almacenes.mjs [--apply]
 *
 * - almacenes: stock_warehouse (tipo propio/consignacion; cliente_id por match de nombre en consignación)
 * - inventario_almacen: existencias por (producto de catálogo × almacén), desde stock_quant (ubicaciones internas)
 * - actualiza productos.stock_actual = suma en almacenes propios
 */
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(`Mgmt API ${r.status}: ${JSON.stringify(b)}`);
  return b;
}
const jsonbLit = (a) => `'${JSON.stringify(a).replace(/'/g, "''")}'::jsonb`;
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const isConsig = (name) => /consignado|consginado/i.test(name);
const norm = (s) => (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(C\.?A\.?|S\.?A\.?|SRL|SA|CA|COMPANIA|ANONIMA)\b/g, '')
  .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// ── 1. EXTRACCIÓN ───────────────────────────────────────────────────────
const odoo = new pg.Client({
  host: process.env.ODOO_PG_HOST, port: 5432, user: process.env.ODOO_PG_USER,
  password: process.env.ODOO_PG_PASSWORD, database: 'guds-master.agroo.net.ve',
  ssl: false, connectionTimeoutMillis: 20000, statement_timeout: 120000,
});
await odoo.connect();
let rawWh, rawClientes, rawStock;
try {
  rawWh = (await odoo.query(`select id, name, code, coalesce(active,true) as active from stock_warehouse order by id`)).rows;
  rawClientes = (await odoo.query(`select id, name from res_partner where customer_rank>0`)).rows;
  rawStock = (await odoo.query(`
    select w.id as almacen_odoo_id, pp.product_tmpl_id as prod_odoo_id, round(sum(sq.quantity),2) as cantidad
    from stock_quant sq
    join stock_location loc on loc.id=sq.location_id and loc.usage='internal'
    join stock_warehouse w on w.id=loc.warehouse_id
    join product_product pp on pp.id=sq.product_id
    join product_template pt on pt.id=pp.product_tmpl_id and pt.active and pt.sale_ok and pt.type='consu'
    group by 1,2 having sum(sq.quantity) <> 0`)).rows;
} finally { await odoo.end(); }

// ── 2. TRANSFORMACIÓN ───────────────────────────────────────────────────
// índice de clientes por nombre normalizado (para match de consignación)
const cliIndex = rawClientes.map(c => ({ odoo_id: c.id, norm: norm(c.name) })).filter(c => c.norm.length >= 4);
function matchCliente(whName) {
  const stripped = norm(whName.replace(/.*consignad?o/i, '')); // quita "X-CONSIGNADO"
  if (stripped.length < 4) return null;
  // match por contención en ambos sentidos, elige el nombre de cliente más largo que contenga o esté contenido
  let best = null;
  for (const c of cliIndex) {
    if (c.norm.includes(stripped) || stripped.includes(c.norm)) {
      if (!best || c.norm.length > best.norm.length) best = c;
    }
  }
  return best?.odoo_id ?? null;
}

let matched = 0, unmatched = 0;
const almacenes = rawWh.map(w => {
  const consig = isConsig(w.name);
  let cliente_odoo_id = null;
  if (consig) { cliente_odoo_id = matchCliente(w.name); cliente_odoo_id ? matched++ : unmatched++; }
  return {
    odoo_id: w.id, nombre: w.name, codigo: w.code || null,
    tipo: consig ? 'consignacion' : 'propio',
    cliente_odoo_id, activo: w.active,
  };
});

const inventario = rawStock.map(s => ({
  almacen_odoo_id: s.almacen_odoo_id,
  prod_odoo_id: s.prod_odoo_id,
  cantidad: Number(s.cantidad),
}));

console.log(`\n=== SYNC ALMACENES + INVENTARIO  [${APPLY ? 'APPLY' : 'DRY-RUN'}] ===`);
console.log('Almacenes:', almacenes.length,
  `(propios ${almacenes.filter(a => a.tipo === 'propio').length}, consignación ${almacenes.filter(a => a.tipo === 'consignacion').length})`);
console.log('Consignación con cliente matcheado:', matched, '| sin match:', unmatched);
console.log('Filas de inventario (producto×almacén):', inventario.length);

if (!APPLY) { console.log('\nDRY-RUN: nada escrito. Usá --apply.'); process.exit(0); }

// ── 3. DDL ──────────────────────────────────────────────────────────────
console.log('\n[1/5] DDL (tablas + RLS + grants)…');
await mgmt(`
  create table if not exists public.almacenes (
    id uuid primary key default gen_random_uuid(),
    odoo_id integer unique,
    nombre text not null,
    codigo text,
    tipo text not null default 'propio',
    cliente_id uuid references public.clientes(id) on delete set null,
    activo boolean default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table if not exists public.inventario_almacen (
    id uuid primary key default gen_random_uuid(),
    almacen_id uuid not null references public.almacenes(id) on delete cascade,
    producto_id uuid not null references public.productos(id) on delete cascade,
    cantidad numeric not null default 0,
    updated_at timestamptz default now(),
    unique (almacen_id, producto_id)
  );
  create index if not exists inventario_almacen_producto_idx on public.inventario_almacen(producto_id);
  create index if not exists almacenes_cliente_idx on public.almacenes(cliente_id);
  grant select, insert, update, delete on public.almacenes to authenticated, service_role;
  grant select, insert, update, delete on public.inventario_almacen to authenticated, service_role;
  alter table public.almacenes enable row level security;
  alter table public.inventario_almacen enable row level security;
  drop policy if exists almacenes_auth_all on public.almacenes;
  create policy almacenes_auth_all on public.almacenes for all to authenticated using (true) with check (true);
  drop policy if exists inventario_auth_all on public.inventario_almacen;
  create policy inventario_auth_all on public.inventario_almacen for all to authenticated using (true) with check (true);`);

// ── 4. Upserts ──────────────────────────────────────────────────────────
console.log('[2/5] Upsert almacenes…');
await mgmt(`
  insert into public.almacenes (odoo_id, nombre, codigo, tipo, cliente_id, activo)
  select x.odoo_id, x.nombre, x.codigo, x.tipo,
    (select id from public.clientes c where c.odoo_id = x.cliente_odoo_id), x.activo
  from jsonb_to_recordset(${jsonbLit(almacenes)}) as x(
    odoo_id int, nombre text, codigo text, tipo text, cliente_odoo_id int, activo boolean)
  on conflict (odoo_id) do update set
    nombre=excluded.nombre, codigo=excluded.codigo, tipo=excluded.tipo,
    cliente_id=excluded.cliente_id, activo=excluded.activo, updated_at=now();`);

console.log('[3/5] Upsert inventario (por lotes)…');
let n = 0;
for (const lote of chunk(inventario, 1000)) {
  await mgmt(`
    insert into public.inventario_almacen (almacen_id, producto_id, cantidad)
    select (select id from public.almacenes a where a.odoo_id = x.almacen_odoo_id),
           (select id from public.productos p where p.odoo_id = x.prod_odoo_id),
           x.cantidad
    from jsonb_to_recordset(${jsonbLit(lote)}) as x(almacen_odoo_id int, prod_odoo_id int, cantidad numeric)
    where exists (select 1 from public.productos p where p.odoo_id = x.prod_odoo_id)
    on conflict (almacen_id, producto_id) do update set cantidad=excluded.cantidad, updated_at=now();`);
  n += lote.length;
  console.log(`   … ${n}/${inventario.length}`);
}

console.log('[4/5] Recalcular productos.stock_actual = suma en almacenes propios…');
await mgmt(`
  update public.productos p set stock_actual = coalesce(s.total, 0)
  from (
    select ia.producto_id, sum(ia.cantidad) as total
    from public.inventario_almacen ia
    join public.almacenes a on a.id = ia.almacen_id and a.tipo = 'propio'
    group by ia.producto_id
  ) s
  where s.producto_id = p.id;`);

console.log('[5/5] Verificación…');
const v = await mgmt(`select
  (select count(*) from almacenes) as almacenes,
  (select count(*) from almacenes where tipo='propio') as propios,
  (select count(*) from almacenes where tipo='consignacion') as consignacion,
  (select count(*) from almacenes where tipo='consignacion' and cliente_id is not null) as consig_con_cliente,
  (select count(*) from inventario_almacen) as inventario_filas,
  (select round(sum(cantidad),2) from inventario_almacen ia join almacenes a on a.id=ia.almacen_id and a.tipo='propio') as unidades_propias`);
console.log(JSON.stringify(v[0] ?? v, null, 1));
console.log('\n✓ Sync almacenes + inventario completado.');
