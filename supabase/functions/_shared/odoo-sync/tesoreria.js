// Bancos y tesorería (Fase 7): saldo de cada banco según Odoo, extractos bancarios con sus líneas (conciliadas o no)
// y depósitos por identificar (cobros sin contacto). Espejo de Odoo, solo lectura en GUDS.

import { m2oId, m2oNombre } from './odoo.js';
import { round2, txt, jsonbLit, lotes } from './util.js';

const VED = 2;

// ── Lectura por empresa ────────────────────────────────────────────────
export async function leerTesoreria(odoo, cid, diarios) {
  const L = (m, dom, campos) => odoo.leerTodo(m, dom, campos, { empresa: cid });
  const d = {};
  // Los extractos sin diario (vacíos) no se leen: la empresa sale del diario
  d.extractos = await L('account.bank.statement', [['journal_id.company_id', '=', cid]],
    ['name', 'journal_id', 'date', 'balance_start', 'balance_end', 'balance_end_real', 'is_complete', 'is_valid', 'write_date']);
  d.lineas = await L('account.bank.statement.line', [['company_id', '=', cid]],
    ['statement_id', 'journal_id', 'date', 'payment_ref', 'partner_id', 'partner_name', 'amount', 'amount_currency', 'foreign_currency_id',
      'is_reconciled', 'amount_residual', 'running_balance', 'transaction_type', 'account_number', 'write_date']);
  d.porIdentificar = await L('account.payment',
    [['company_id', '=', cid], ['partner_id', '=', false], ['payment_type', '=', 'inbound'], ['state', 'in', ['in_process', 'paid']]],
    ['name', 'amount', 'currency_id', 'date', 'journal_id', 'memo', 'write_date']);
  // Saldo contable de cada banco: suma de los apuntes publicados de su cuenta. En USD sale agregado; en Bs Odoo no agrega
  // amount_currency (mezcla monedas), así que se suman los apuntes de las cuentas de diarios en VED.
  const cuentas = [...new Set(diarios.map((j) => m2oId(j.default_account_id)).filter(Boolean))];
  d.saldos = cuentas.length
    ? await odoo.leer('account.move.line', 'read_group',
      [[['account_id', 'in', cuentas], ['parent_state', '=', 'posted'], ['company_id', '=', cid]], ['balance:sum'], ['account_id']],
      { lazy: false }, cid)
    : [];
  const cuentasVed = [...new Set(diarios.filter((j) => m2oId(j.currency_id) === VED).map((j) => m2oId(j.default_account_id)).filter(Boolean))];
  d.apuntesVed = cuentasVed.length
    ? await L('account.move.line', [['account_id', 'in', cuentasVed], ['parent_state', '=', 'posted'], ['company_id', '=', cid]], ['account_id', 'amount_currency'])
    : [];
  return d;
}

// ── Transformación + escritura ─────────────────────────────────────────
export async function escribirTesoreria({ tes, diarios, E, sql, escribir, ts, aplicar, clienteDe, provDe }) {
  const usdCuenta = new Map(tes.saldos.map((s) => [m2oId(s.account_id), Number(s.balance || 0)]));
  const vedCuenta = new Map();
  for (const a of tes.apuntesVed) vedCuenta.set(m2oId(a.account_id), (vedCuenta.get(m2oId(a.account_id)) || 0) + Number(a.amount_currency || 0));
  const diariosPorCuenta = new Map();
  for (const j of diarios) { const c = m2oId(j.default_account_id); if (c) diariosPorCuenta.set(c, (diariosPorCuenta.get(c) || 0) + 1); }
  const saldos = diarios.filter((j) => m2oId(j.default_account_id)).map((j) => {
    const c = m2oId(j.default_account_id);
    return {
      odoo_id: j.id, saldo: round2(m2oId(j.currency_id) === VED ? vedCuenta.get(c) || 0 : usdCuenta.get(c) || 0), saldo_usd: round2(usdCuenta.get(c) || 0),
      saldo_extracto: round2(j.current_statement_balance), compartida: (diariosPorCuenta.get(c) || 0) > 1, cuenta: txt(j.bank_acc_number),
    };
  });

  const extractos = tes.extractos.filter((x) => m2oId(x.journal_id)).map((x) => ({
    odoo_id: x.id, empresa_id: E, banco_odoo_id: m2oId(x.journal_id), nombre: txt(x.name), fecha: x.date || null,
    saldo_inicial: round2(x.balance_start), saldo_final: round2(x.balance_end), saldo_final_real: round2(x.balance_end_real),
    completo: !!x.is_complete, valido: !!x.is_valid,
  }));

  const lineas = tes.lineas.map((l) => {
    const partner = m2oId(l.partner_id);
    return {
      odoo_id: l.id, empresa_id: E, extracto_odoo_id: m2oId(l.statement_id), banco_odoo_id: m2oId(l.journal_id), fecha: l.date || null,
      referencia: txt(l.payment_ref), contacto: txt(m2oNombre(l.partner_id)) || txt(l.partner_name),
      cliente_odoo_id: partner ? clienteDe(partner) : null, proveedor_odoo_id: partner ? provDe(partner) : null,
      monto: round2(l.amount), monto_otra_moneda: m2oId(l.foreign_currency_id) ? round2(l.amount_currency) : null,
      otra_moneda: txt(m2oNombre(l.foreign_currency_id)), saldo: round2(l.running_balance), conciliada: !!l.is_reconciled,
      pendiente: round2(l.amount_residual), tipo_transaccion: txt(l.transaction_type), cuenta_contraparte: txt(l.account_number),
    };
  });

  const porIdentificar = tes.porIdentificar.map((p) => ({
    odoo_pago_id: p.id, empresa_id: E, banco_odoo_id: m2oId(p.journal_id), monto: round2(p.amount), referencia: txt(p.memo, 100),
    descripcion: `Depósito por identificar (${txt(p.name) || `Odoo ${p.id}`})`, fecha: p.date,
  }));

  const resumen = { extractos_odoo: extractos.length, lineas_extracto: lineas.length, depositos_por_identificar: porIdentificar.length };
  if (!aplicar) return resumen;

  const upsert = async (filas, n, sqlFn) => { for (const lote of lotes(filas, n)) await escribir(sqlFn(jsonbLit(lote))); };
  const banco = (col) => `(select b.id from bancos b where b.odoo_id = x.${col})`;

  // Saldo de cada banco (la fecha del saldo solo se mueve si el saldo cambió)
  await upsert(saldos, 500, (j) => `
    update bancos b set saldo_odoo = x.saldo, saldo_odoo_usd = x.saldo_usd, saldo_extracto = x.saldo_extracto, cuenta_compartida = x.compartida,
      cuenta_odoo = x.cuenta, saldo_odoo_at = '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, saldo numeric, saldo_usd numeric, saldo_extracto numeric, compartida boolean, cuenta text)
    where b.odoo_id = x.odoo_id and (b.saldo_odoo, b.saldo_odoo_usd, b.saldo_extracto, b.cuenta_compartida, b.cuenta_odoo)
      is distinct from (x.saldo, x.saldo_usd, x.saldo_extracto, x.compartida, x.cuenta)`);

  await upsert(extractos, 500, (j) => `
    insert into extractos_odoo (odoo_id, empresa_id, banco_id, nombre, fecha, saldo_inicial, saldo_final, saldo_final_real, completo, valido, odoo_sync_at)
    select x.odoo_id, x.empresa_id, ${banco('banco_odoo_id')}, x.nombre, x.fecha, x.saldo_inicial, x.saldo_final, x.saldo_final_real, x.completo, x.valido, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, banco_odoo_id int, nombre text, fecha date, saldo_inicial numeric,
      saldo_final numeric, saldo_final_real numeric, completo boolean, valido boolean)
    on conflict (odoo_id) do update set banco_id = excluded.banco_id, nombre = excluded.nombre, fecha = excluded.fecha,
      saldo_inicial = excluded.saldo_inicial, saldo_final = excluded.saldo_final, saldo_final_real = excluded.saldo_final_real,
      completo = excluded.completo, valido = excluded.valido, odoo_sync_at = excluded.odoo_sync_at
    where (extractos_odoo.banco_id, extractos_odoo.nombre, extractos_odoo.fecha, extractos_odoo.saldo_inicial, extractos_odoo.saldo_final,
      extractos_odoo.saldo_final_real, extractos_odoo.completo, extractos_odoo.valido)
    is distinct from (excluded.banco_id, excluded.nombre, excluded.fecha, excluded.saldo_inicial, excluded.saldo_final, excluded.saldo_final_real,
      excluded.completo, excluded.valido)`);

  await upsert(lineas, 1000, (j) => `
    insert into extracto_odoo_lineas (odoo_id, empresa_id, extracto_id, banco_id, fecha, referencia, contacto, cliente_id, proveedor_id, monto,
      monto_otra_moneda, otra_moneda, saldo, conciliada, pendiente, tipo_transaccion, cuenta_contraparte, odoo_sync_at)
    select x.odoo_id, x.empresa_id, (select e.id from extractos_odoo e where e.odoo_id = x.extracto_odoo_id), ${banco('banco_odoo_id')}, x.fecha,
      x.referencia, x.contacto, (select c.id from clientes c where c.odoo_id = x.cliente_odoo_id),
      (select pv.id from proveedores pv where pv.odoo_id = x.proveedor_odoo_id), x.monto, x.monto_otra_moneda, x.otra_moneda, x.saldo,
      x.conciliada, x.pendiente, x.tipo_transaccion, x.cuenta_contraparte, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, extracto_odoo_id int, banco_odoo_id int, fecha date, referencia text,
      contacto text, cliente_odoo_id int, proveedor_odoo_id int, monto numeric, monto_otra_moneda numeric, otra_moneda text, saldo numeric,
      conciliada boolean, pendiente numeric, tipo_transaccion text, cuenta_contraparte text)
    on conflict (odoo_id) do update set extracto_id = excluded.extracto_id, banco_id = excluded.banco_id, fecha = excluded.fecha,
      referencia = excluded.referencia, contacto = excluded.contacto, cliente_id = excluded.cliente_id, proveedor_id = excluded.proveedor_id,
      monto = excluded.monto, monto_otra_moneda = excluded.monto_otra_moneda, otra_moneda = excluded.otra_moneda, saldo = excluded.saldo,
      conciliada = excluded.conciliada, pendiente = excluded.pendiente, tipo_transaccion = excluded.tipo_transaccion,
      cuenta_contraparte = excluded.cuenta_contraparte, odoo_sync_at = excluded.odoo_sync_at
    where (extracto_odoo_lineas.extracto_id, extracto_odoo_lineas.banco_id, extracto_odoo_lineas.fecha, extracto_odoo_lineas.referencia,
      extracto_odoo_lineas.contacto, extracto_odoo_lineas.cliente_id, extracto_odoo_lineas.proveedor_id, extracto_odoo_lineas.monto,
      extracto_odoo_lineas.monto_otra_moneda, extracto_odoo_lineas.otra_moneda, extracto_odoo_lineas.saldo, extracto_odoo_lineas.conciliada,
      extracto_odoo_lineas.pendiente, extracto_odoo_lineas.tipo_transaccion, extracto_odoo_lineas.cuenta_contraparte)
    is distinct from (excluded.extracto_id, excluded.banco_id, excluded.fecha, excluded.referencia, excluded.contacto, excluded.cliente_id,
      excluded.proveedor_id, excluded.monto, excluded.monto_otra_moneda, excluded.otra_moneda, excluded.saldo, excluded.conciliada,
      excluded.pendiente, excluded.tipo_transaccion, excluded.cuenta_contraparte)`);

  // Depósitos por identificar: movimientos bancarios de entrada sin cliente (base de la conciliación de GUDS)
  await upsert(porIdentificar, 500, (j) => `
    insert into movimientos_bancarios (odoo_pago_id, empresa_id, banco_id, tipo, monto, referencia, descripcion, fecha, origen)
    select x.odoo_pago_id, x.empresa_id, ${banco('banco_odoo_id')}, 'entrada', x.monto, x.referencia, x.descripcion, x.fecha::timestamptz, 'por_identificar'
    from jsonb_to_recordset(${j}) as x(odoo_pago_id int, empresa_id uuid, banco_odoo_id int, monto numeric, referencia text, descripcion text, fecha date)
    where ${banco('banco_odoo_id')} is not null
    on conflict (odoo_pago_id) where odoo_pago_id is not null do update set banco_id = excluded.banco_id, monto = excluded.monto,
      referencia = excluded.referencia, descripcion = excluded.descripcion, fecha = excluded.fecha
    where (movimientos_bancarios.banco_id, movimientos_bancarios.monto, movimientos_bancarios.referencia, movimientos_bancarios.descripcion,
      movimientos_bancarios.fecha) is distinct from (excluded.banco_id, excluded.monto, excluded.referencia, excluded.descripcion, excluded.fecha)`);

  // Lo que ya no viene de Odoo (un depósito ya identificado deja de estar "por identificar"; si está conciliado en GUDS se conserva)
  await sql(`delete from movimientos_bancarios m where m.empresa_id = '${E}' and m.origen = 'por_identificar'
    and m.odoo_pago_id <> all (array[${porIdentificar.map((p) => p.odoo_pago_id).join(',') || 0}]::int[])
    and not exists (select 1 from extracto_lineas el where el.movimiento_bancario_id = m.id)`);
  await sql(`delete from extracto_odoo_lineas where empresa_id = '${E}' and odoo_id <> all (array[${lineas.map((l) => l.odoo_id).join(',') || 0}]::int[])`);
  await sql(`delete from extractos_odoo where empresa_id = '${E}' and odoo_id <> all (array[${extractos.map((x) => x.odoo_id).join(',') || 0}]::int[])`);
  return resumen;
}
