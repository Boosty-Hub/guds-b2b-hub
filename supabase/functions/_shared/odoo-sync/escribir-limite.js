// Límite de crédito editado en GUDS → Odoo (Fase 9b, flanco 28; migración 20s). Se envía cuando clientes.limite_credito_pendiente
// es verdadero (lo marca el disparador de 18l al editar el límite) y, al quedar escrito, se apaga el pendiente.
//
// Qué se escribe en el res.partner del cliente (verificado con fields_get de Odoo 18, 29-sep):
//   · credit_limit: límite estándar de Odoo, POR COMPAÑÍA (company_dependent): se escribe con el contexto de la compañía del
//     cliente (en un cliente compartido, en cada compañía de GUDS).
//   · use_partner_credit_limit: "Límite del contacto" (calculado con inverso): verdadero si el límite es mayor que 0; en falso,
//     Odoo vuelve credit_limit al valor por defecto de la compañía.
//   · credit_limit_value: "Límite de Crédito" del módulo propio de Corpo Eureka (eu_customer_limit_category), que no es por
//     compañía. Es el que lee primero la sincronización (importar.js: credit_limit_value || credit_limit), así que se escribe
//     también: si no, la próxima sincronización devolvería a GUDS el valor viejo.
// El límite estándar solo se aplica en Odoo si la compañía tiene activo account_use_credit_limit (se informa en el plan).
// aplicar = false (modo "simular"): lee Odoo y devuelve el plan (con la nota); no escribe en Odoo ni apaga el pendiente.
import { fechaCaracas } from './util.js';
import { dejarNota } from './notas.js';

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const usd = (n) => `$${r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CAMPOS = ['name', 'company_id', 'credit_limit', 'credit_limit_value', 'use_partner_credit_limit'];

export async function escribirLimite({ odoo, sql, fila, aplicar, log = () => {}, quien = 'GUDS' }) {
  const [c] = await sql(`select c.id, c.odoo_id, c.nombre_negocio, c.empresa_id, c.limite_credito, c.limite_credito_pendiente, e.odoo_company_id
    from clientes c left join empresas e on e.id = c.empresa_id where c.id = ${lit(fila.referencia_id)}`);
  if (!c) throw new Error('Cliente no encontrado en GUDS');
  if (!c.odoo_id) return { omitida: 'El cliente aún no está en Odoo: el límite se envía cuando quede vinculado' };
  if (!c.limite_credito_pendiente) return { omitida: 'No hay un cambio de límite pendiente de enviar (ya se envió)' };
  const [nuevo] = await sql(`select count(*)::int n from odoo_escrituras o join odoo_escrituras f on f.id = ${lit(fila.id)}
    where o.tipo = 'cliente_limite' and o.referencia_id = f.referencia_id and o.id <> f.id and o.created_at > f.created_at
      and o.estado in ('pendiente', 'procesando', 'hecha')`);
  if (nuevo?.n > 0) return { omitida: 'Hay un envío más reciente del límite de este cliente' };

  if (!odoo.empresas) await odoo.autenticar();
  const valor = r2(c.limite_credito);
  const companias = c.odoo_company_id ? [c.odoo_company_id]
    : (await sql(`select odoo_company_id from empresas where activo and odoo_company_id is not null order by orden`)).map((x) => x.odoo_company_id);
  const campos = await odoo.leer('res.partner', 'fields_get', [CAMPOS], { attributes: ['type', 'readonly', 'company_dependent'] }, companias[0]);
  if (!campos.credit_limit || !campos.use_partner_credit_limit) throw new Error('Odoo no tiene los campos de límite de crédito esperados (credit_limit / use_partner_credit_limit)');
  const conValorPropio = !!campos.credit_limit_value && !campos.credit_limit_value.readonly;
  const aplicaOdoo = await odoo.leer('res.company', 'search_read', [[['id', 'in', companias]]], { fields: ['name', 'account_use_credit_limit'] });

  const antes = [];
  for (const cid of companias) {
    const [p] = await odoo.leer('res.partner', 'read', [[c.odoo_id]], { fields: CAMPOS.filter((k) => campos[k]) }, cid);
    if (!p) throw new Error(`El cliente ${c.nombre_negocio} (Odoo ${c.odoo_id}) ya no existe en Odoo`);
    antes.push({ compania: cid, credit_limit: r2(p.credit_limit), usa_limite: !!p.use_partner_credit_limit, credit_limit_value: conValorPropio ? r2(p.credit_limit_value) : null, nombre: p.name });
  }
  const escrituras = companias.map((cid) => ({ compania: cid, vals: { credit_limit: valor, use_partner_credit_limit: valor > 0 } }));
  const comun = conValorPropio ? { credit_limit_value: valor } : null;
  const previo = antes[0];
  const nota = { modelo: 'res.partner', id: c.odoo_id, texto: `(GUDS) Límite de crédito actualizado desde GUDS por ${quien} el ${fechaCaracas()}: `
    + `${usd(previo.credit_limit_value || previo.credit_limit)} → ${usd(valor)}${companias.length > 1 ? ' (en cada compañía)' : ''}.` };
  const plan = {
    cliente: c.nombre_negocio, partner: c.odoo_id, valor, companias, antes, escrituras, comun,
    odoo_aplica_limite: aplicaOdoo.map((x) => ({ compania: x.name, account_use_credit_limit: !!x.account_use_credit_limit })),
    avisos: aplicaOdoo.every((x) => !x.account_use_credit_limit)
      ? ['En Odoo la compañía no tiene activado el límite de crédito en ventas (account_use_credit_limit): el límite estándar queda registrado pero Odoo no avisa al confirmar pedidos']
      : [],
  };
  if (!aplicar) return { modo: 'simulacion', ...plan, nota: { ...nota, simulada: true } };

  if (comun) await odoo.escribir('res.partner', [c.odoo_id], comun, companias[0]);
  for (const e of escrituras) await odoo.escribir('res.partner', [c.odoo_id], e.vals, e.compania);
  const despues = [];
  for (const cid of companias) {
    const [p] = await odoo.leer('res.partner', 'read', [[c.odoo_id]], { fields: CAMPOS.filter((k) => campos[k]) }, cid);
    despues.push({ compania: cid, credit_limit: r2(p.credit_limit), usa_limite: !!p.use_partner_credit_limit, credit_limit_value: conValorPropio ? r2(p.credit_limit_value) : null });
  }
  const noAplicado = despues.filter((d) => d.credit_limit !== valor || (conValorPropio && d.credit_limit_value !== valor));
  if (noAplicado.length) throw new Error(`Odoo no dejó el límite en ${usd(valor)} (${noAplicado.map((d) => `compañía ${d.compania}: ${usd(d.credit_limit)}`).join(', ')})`);
  // Se apaga el pendiente solo si el límite de GUDS sigue siendo el que se envió (si cambió mientras tanto, sigue pendiente)
  const [r] = await sql(`select public.marcar_limite_credito_enviado(${lit(c.id)}, ${valor}) apagado`);
  const notaHecha = await dejarNota(odoo, nota, companias[0], true);
  log(`límite de ${c.nombre_negocio} (Odoo ${c.odoo_id}): ${usd(valor)} · pendiente apagado: ${r?.apagado}`);
  return { modo: 'aplicada', ...plan, despues, pendiente_apagado: !!r?.apagado, nota: notaHecha };
}
