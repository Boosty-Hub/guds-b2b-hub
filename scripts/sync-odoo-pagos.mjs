/**
 * Importa PAGOS (recibos) + BANCOS desde Odoo y ajusta la deuda de cada cliente
 * para que calce con el residual contable de Odoo. SOLO LECTURA en Odoo.
 *   node scripts/sync-odoo-pagos.mjs [--apply]
 *
 * - bancos:  account_journal (bank/cash), deduplicados por nombre (2 compañías G/Q).
 * - pagos:   account_payment inbound (in_process/paid) → recibos (monto=amount_usd) + movimiento bancario.
 * - deuda:   por cliente, marca órdenes pagadas (FIFO) para que el saldo == residual de Odoo;
 *            si Odoo debe más que nuestras órdenes, crea una cuenta_cobrar origen='odoo'.
 */
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const REF = process.env.SUPABASE_PROJECT_REF, TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const b = await r.json(); if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(b)}`); return b;
}
const jsonbLit = (a) => `'${JSON.stringify(a).replace(/'/g, "''")}'::jsonb`;
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// ── 1. EXTRACCIÓN ───────────────────────────────────────────────────────
const odoo = new pg.Client({
  host: process.env.ODOO_PG_HOST, port: 5432, user: process.env.ODOO_PG_USER,
  password: process.env.ODOO_PG_PASSWORD, database: 'guds-master.agroo.net.ve',
  ssl: false, connectionTimeoutMillis: 20000, statement_timeout: 120000,
});
await odoo.connect();
let rawJournals, rawPagos, rawResidual;
try {
  rawJournals = (await odoo.query(`select id, name, code, type, currency_id, coalesce(active,true) active from account_journal where type in ('bank','cash')`)).rows;
  rawPagos = (await odoo.query(`
    select ap.id, ap.amount, ap.amount_usd, ap.journal_id, ap.date, ap.name as pago_ref, cc.name as moneda,
      case when cp.customer_rank>0 then cp.id when p.customer_rank>0 then p.id end as cliente_odoo_id
    from account_payment ap
    left join res_partner p on p.id=ap.partner_id
    left join res_partner cp on cp.id=p.commercial_partner_id
    left join res_currency cc on cc.id=ap.currency_id
    where ap.payment_type='inbound' and ap.state in ('in_process','paid')`)).rows;
  rawResidual = (await odoo.query(`
    select (case when cp.customer_rank>0 then cp.id when p.customer_rank>0 then p.id end) as cliente_odoo_id,
      round(sum(case when m.currency_id=1 then m.amount_residual else m.amount_residual/nullif(m.invoice_currency_rate,0) end),2) as deuda_usd
    from account_move m
    join res_partner p on p.id=m.partner_id
    left join res_partner cp on cp.id=p.commercial_partner_id
    where m.move_type='out_invoice' and m.state='posted' and m.amount_residual>0
    group by 1`)).rows;
} finally { await odoo.end(); }

// ── 2. TRANSFORMACIÓN ───────────────────────────────────────────────────
// account_journal.name es jsonb traducible → extraer string
const jn = (j) => (j.name && typeof j.name === 'object')
  ? (j.name.es_VE || j.name.en_US || Object.values(j.name)[0] || `Journal ${j.id}`)
  : String(j.name || `Journal ${j.id}`);
// bancos deduplicados por nombre
const monedaJournal = (j) => (j.currency_id === 1 || /\bUSD\b|\bME\b|panam|zelle|d[oó]lar/i.test(jn(j))) ? 'USD' : 'BS';
const bankByName = new Map();          // nombre -> { odoo_id, nombre, moneda }
const journalToName = new Map();       // journal_id -> nombre
for (const j of rawJournals) {
  const name = jn(j);
  journalToName.set(j.id, name);
  const ex = bankByName.get(name);
  if (!ex) bankByName.set(name, { odoo_id: j.id, nombre: name, moneda: monedaJournal(j) });
  else if (j.id < ex.odoo_id) ex.odoo_id = j.id;
}
const bancos = [...bankByName.values()];

const pagos = rawPagos
  .filter(p => p.cliente_odoo_id && Number(p.amount) > 0)
  .map(p => ({
    odoo_id: p.id,
    cliente_odoo_id: p.cliente_odoo_id,
    banco_odoo_id: bankByName.get(journalToName.get(p.journal_id))?.odoo_id ?? null,
    monto_moneda: round2(p.amount),
    monto_usd: p.amount_usd != null ? round2(p.amount_usd) : (p.moneda === 'USD' ? round2(p.amount) : null),
    moneda: p.moneda === 'USD' ? 'USD' : 'BS',
    fecha: p.date,
    referencia: p.pago_ref || null,
  }))
  .filter(p => p.banco_odoo_id && p.monto_usd != null);

const residual = rawResidual.filter(r => r.cliente_odoo_id).map(r => ({ cliente_odoo_id: r.cliente_odoo_id, deuda_usd: round2(r.deuda_usd) }));

// solo los bancos que realmente recibieron pagos (evita journals internos vacíos)
const usados = new Set(pagos.map(p => p.banco_odoo_id));
const bancosImport = bancos.filter(b => usados.has(b.odoo_id));

console.log(`\n=== IMPORT PAGOS + BANCOS + DEUDA  [${APPLY ? 'APPLY' : 'DRY-RUN'}] ===`);
console.log('Bancos con pagos:', bancosImport.length, '(de', bancos.length, 'journals)');
console.log('Pagos inbound:', rawPagos.length, '→ importables (con cliente+banco+usd):', pagos.length);
console.log('  sin cliente:', rawPagos.filter(p => !p.cliente_odoo_id).length, '| sin amount_usd:', rawPagos.filter(p => p.amount_usd == null && p.moneda !== 'USD').length);
console.log('Clientes con deuda en Odoo:', residual.length, '| deuda total USD:', round2(residual.reduce((s, r) => s + r.deuda_usd, 0)));
console.log('Total recibos USD:', round2(pagos.reduce((s, p) => s + p.monto_usd, 0)));

if (!APPLY) { console.log('\nDRY-RUN: nada escrito. Usá --apply.'); process.exit(0); }

// ── 3. DDL ──────────────────────────────────────────────────────────────
console.log('\n[1/6] DDL (odoo_id en bancos/pagos + función ajustar_deuda_odoo)…');
await mgmt(`
  alter table public.bancos add column if not exists odoo_id integer;
  create unique index if not exists bancos_odoo_id_key on public.bancos(odoo_id);
  alter table public.pagos add column if not exists odoo_id integer;
  create unique index if not exists pagos_odoo_id_key on public.pagos(odoo_id);

  create or replace function public.ajustar_deuda_odoo(p_cliente_id uuid, p_deuda numeric)
  returns void language plpgsql security definer set search_path=public as $$
  declare v_tot numeric; v_pay numeric; v_rest numeric; r record; v_apl numeric;
  begin
    update ordenes set monto_pagado=0, estado_pago='pendiente', pagado=false
      where cliente_id=p_cliente_id and estado<>'cancelado';
    delete from cuentas_cobrar where cliente_id=p_cliente_id and origen='odoo';
    select coalesce(sum(total),0) into v_tot from ordenes where cliente_id=p_cliente_id and estado<>'cancelado';
    v_pay := greatest(0, v_tot - p_deuda);
    v_rest := v_pay;
    for r in select id, total from ordenes where cliente_id=p_cliente_id and estado<>'cancelado'
             order by fecha_pedido asc nulls last, created_at asc loop
      exit when v_rest <= 0.009;
      v_apl := least(v_rest, r.total);
      update ordenes set monto_pagado=v_apl,
        estado_pago=case when v_apl >= r.total-0.009 then 'pagado' else 'parcial' end,
        pagado=(v_apl >= r.total-0.009) where id=r.id;
      v_rest := v_rest - v_apl;
    end loop;
    if p_deuda > v_tot + 0.009 then
      insert into cuentas_cobrar (cliente_id, concepto, monto, origen, fecha)
      values (p_cliente_id, 'Saldo pendiente según Odoo', round(p_deuda - v_tot, 2), 'odoo',
              (now() at time zone 'America/Caracas')::date);
    end if;
    perform recalcular_credito(p_cliente_id);
  end $$;`);

console.log('[2/6] Upsert bancos (desde Odoo)…');
await mgmt(`
  insert into public.bancos (odoo_id, nombre, moneda, metodo_pago, activo)
  select x.odoo_id, x.nombre, x.moneda, 'transferencia'::pago_metodo, true
  from jsonb_to_recordset(${jsonbLit(bancosImport)}) as x(odoo_id int, nombre text, moneda text)
  on conflict (odoo_id) do update set nombre=excluded.nombre, moneda=excluded.moneda;`);

console.log('[3/6] Importar recibos (pagos) — triggers de notificación off…');
await mgmt(`alter table public.pagos disable trigger trg_notif_pago_insert; alter table public.pagos disable trigger trg_notif_pago_estado;`);
try {
  let n = 0;
  for (const lote of chunk(pagos, 800)) {
    await mgmt(`
      insert into public.pagos (odoo_id, cliente_id, banco_id, metodo, monto, monto_moneda, moneda, referencia, estado, fecha_verificacion, created_at)
      select x.odoo_id,
        (select id from clientes c where c.odoo_id = x.cliente_odoo_id),
        (select id from bancos b where b.odoo_id = x.banco_odoo_id),
        'transferencia'::pago_metodo, x.monto_usd, x.monto_moneda, x.moneda, x.referencia, 'verificado', x.fecha::timestamptz, x.fecha::timestamptz
      from jsonb_to_recordset(${jsonbLit(lote)}) as x(
        odoo_id int, cliente_odoo_id int, banco_odoo_id int, monto_usd numeric, monto_moneda numeric, moneda text, referencia text, fecha date)
      where exists (select 1 from clientes c where c.odoo_id = x.cliente_odoo_id)
        and exists (select 1 from bancos b where b.odoo_id = x.banco_odoo_id)
      on conflict (odoo_id) do update set monto=excluded.monto, monto_moneda=excluded.monto_moneda, banco_id=excluded.banco_id;`);
    n += lote.length; console.log(`   … ${n}/${pagos.length}`);
  }
} finally {
  await mgmt(`alter table public.pagos enable trigger trg_notif_pago_insert; alter table public.pagos enable trigger trg_notif_pago_estado;`);
}

console.log('[4/6] Movimientos bancarios (entrada por recibo)…');
await mgmt(`
  insert into public.movimientos_bancarios (banco_id, tipo, monto, referencia, descripcion, pago_id, fecha)
  select pg.banco_id, 'entrada', pg.monto_moneda, pg.referencia, 'Cobro cliente (Odoo)', pg.id, pg.fecha_verificacion
  from public.pagos pg
  where pg.odoo_id is not null
    and not exists (select 1 from movimientos_bancarios mb where mb.pago_id = pg.id);`);

console.log('[5/6] Ajustar deuda por cliente al residual de Odoo…');
// resetear clientes sin residual (deuda 0) que tengan órdenes, y ajustar los que tienen residual
const conResidual = new Set(residual.map(r => r.cliente_odoo_id));
await mgmt(`
  do $$
  declare r record;
  begin
    for r in select distinct c.id from ordenes o join clientes c on c.id=o.cliente_id
             where c.odoo_id is not null loop
      perform ajustar_deuda_odoo(r.id, 0);  -- default 0; luego se sobreescribe con el residual
    end loop;
  end $$;`);
for (const lote of chunk(residual, 400)) {
  await mgmt(`
    do $$
    declare r record;
    begin
      for r in select (x->>'cliente_odoo_id')::int as oid, (x->>'deuda_usd')::numeric as deuda
               from jsonb_array_elements(${jsonbLit(lote)}) x loop
        perform ajustar_deuda_odoo(c.id, r.deuda) from clientes c where c.odoo_id = r.oid;
      end loop;
    end $$;`);
}

console.log('[6/6] Verificación…');
const v = await mgmt(`select
  (select count(*) from bancos) bancos,
  (select count(*) from pagos where odoo_id is not null) recibos,
  (select count(*) from movimientos_bancarios) movimientos,
  (select round(sum(total-monto_pagado),2) from ordenes where estado<>'cancelado' and total-monto_pagado>0.009) deuda_ordenes,
  (select round(sum(monto-monto_pagado),2) from cuentas_cobrar where origen='odoo') deuda_manual_odoo`);
console.log(JSON.stringify(v[0], null, 1));
console.log('Deuda esperada (Odoo):', round2(residual.reduce((s, r) => s + r.deuda_usd, 0)));
console.log('\n✓ Import de pagos + ajuste de deuda completado.');
