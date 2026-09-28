// Estado de un documento de entrega de Odoo cerrado por un repartidor en GUDS → Odoo (fase 19v). Documentos: órdenes de
// entrega (stock.picking de salida) y reposiciones a consignación (traslado interno hacia un almacén de consignación).
// Lo único que GUDS escribe de una entrega (decisión del dueño, 28-sep; con la API key actual de Odoo):
//   · completa:   se valida el documento con lo reservado (es lo que llevó el camión).
//   · incompleta: se escriben las cantidades entregadas (en las líneas de lote de cada movimiento) y se valida.
//   Pendiente (backorder): se crea si faltó en el camión o si Odoo no tenía todo reservado (eso no salió); si no, se valida
//   sin pendiente (el cliente no lo quiso, dañado, etc.). Rechazos y reprogramaciones no llegan aquí (quedan en GUDS).
// aplicar = false (modo "simular"): SOLO LEE Odoo, verifica las precondiciones (estado "Listo", cantidades, lotes) y devuelve
// el plan exacto de escrituras. aplicar = true: relee el documento justo antes, escribe, valida y confirma leyendo el documento.
// Nunca borra ni cancela nada; si el documento ya está validado en Odoo no escribe nada. No cambia el comportamiento de
// Odoo al validar (p. ej. el SMS de confirmación al cliente se envía igual que al validar a mano).
import { m2oId, m2oNombre } from './odoo.js';

const EPS = 1e-6;
const r4 = (n) => Math.round(Number(n || 0) * 10000) / 10000;
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const lotesDe = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const ESTADOS = { draft: 'borrador', waiting: 'en espera', confirmed: 'en espera', assigned: 'listo', done: 'hecho', cancel: 'cancelado' };

// Lee el documento con sus movimientos, líneas de lote y lotes (solo lectura)
async function leerDocumento(odoo, pid, cid) {
  const [p] = await odoo.leer('stock.picking', 'search_read', [[['id', '=', pid]]], {
    fields: ['name', 'state', 'company_id', 'picking_type_code', 'picking_type_id', 'partner_id', 'origin', 'location_dest_id', 'write_date', 'date_done'],
  }, cid);
  if (!p) return null;
  const moves = await odoo.leer('stock.move', 'search_read', [[['picking_id', '=', pid]]], {
    fields: ['product_id', 'product_uom_qty', 'quantity', 'picked', 'state', 'product_uom', 'has_tracking', 'write_date'], order: 'id',
  }, cid);
  const lineas = await odoo.leer('stock.move.line', 'search_read', [[['picking_id', '=', pid]]], {
    fields: ['move_id', 'product_id', 'lot_id', 'lot_name', 'quantity', 'picked', 'write_date'], order: 'id',
  }, cid);
  const idsLote = [...new Set(lineas.map((l) => m2oId(l.lot_id)).filter(Boolean))];
  const lotes = idsLote.length
    ? await odoo.leer('stock.lot', 'search_read', [[['id', 'in', idsLote]]], { fields: ['name', 'expiration_date', 'product_expiry_alert'] }, cid)
    : [];
  return { p, moves, lineas, lote: new Map(lotes.map((l) => [l.id, l])) };
}

const firma = (doc) => JSON.stringify({ s: doc.p.state, w: doc.p.write_date, m: doc.moves.map((m) => [m.id, m.state, r4(m.quantity), m.picked]),
  l: doc.lineas.map((l) => [l.id, r4(l.quantity)]) });

export async function escribirEntrega({ odoo, sql, fila, aplicar, log = () => {} }) {
  const d = fila.datos || {};
  const pid = Number(d.transferencia_odoo_id);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('La escritura no trae el documento de Odoo');
  if (!['completa', 'incompleta'].includes(d.resultado)) throw new Error(`Resultado que no se escribe en Odoo: ${d.resultado}`);
  const [emp] = await sql(`select odoo_company_id, nombre_corto from empresas where id = ${lit(fila.empresa_id)}`);
  if (!emp?.odoo_company_id) throw new Error('La empresa de la entrega no está ligada a una compañía de Odoo');
  const cid = emp.odoo_company_id;

  // ── 1. Lectura y precondiciones ─────────────────────────────────────
  const doc = await leerDocumento(odoo, pid, cid);
  if (!doc) throw new Error(`El documento ${d.numero || pid} ya no existe en Odoo`);
  const { p } = doc;
  const documento = { id: pid, nombre: p.name, estado: p.state, write_date: p.write_date, empresa: emp.nombre_corto,
    tipo_operacion: m2oNombre(p.picking_type_id), contacto: m2oNombre(p.partner_id), origen: p.origin || null };
  if (m2oId(p.company_id) !== cid) throw new Error(`El documento ${p.name} es de otra compañía en Odoo (${m2oNombre(p.company_id)})`);
  // Reposición a consignación: traslado interno cuyo destino es un almacén de consignación (según el espejo de GUDS)
  const [espejo] = await sql(`select t.tipo, ad.tipo destino_tipo from transferencias t left join almacenes ad on ad.id = t.almacen_destino_id
    where t.odoo_id = ${pid}`);
  const esReposicion = p.picking_type_code === 'internal' && espejo?.tipo === 'interna' && espejo?.destino_tipo === 'consignacion';
  if (p.picking_type_code !== 'outgoing' && !esReposicion) {
    throw new Error(`${p.name} no es una orden de entrega ni una reposición a consignación (tipo ${p.picking_type_code})`);
  }
  documento.tipo = esReposicion ? 'reposicion_consignacion' : 'entrega';
  if (esReposicion) documento.destino = m2oNombre(p.location_dest_id);
  if (p.state === 'done') {
    const pendientes = await odoo.leer('stock.picking', 'search_read', [[['backorder_id', '=', pid]]], { fields: ['name', 'state'] }, cid);
    log(`${p.name} ya estaba validado en Odoo: no se escribe nada`);
    return { modo: aplicar ? 'activo' : 'simulacion', resultado: 'ya_validado', mensaje: 'Ya validado en Odoo: no se escribió nada',
      documento: { ...documento, fecha_validado: p.date_done }, pendientes: pendientes.map((b) => ({ id: b.id, nombre: b.name, estado: b.state })) };
  }
  if (p.state === 'cancel') throw new Error(`El documento ${p.name} está cancelado en Odoo: no se valida (lo revisa administración en Odoo)`);
  if (p.state !== 'assigned') {
    throw new Error(`El documento ${p.name} no está "Listo" en Odoo (estado: ${ESTADOS[p.state] || p.state}): no se puede validar hasta que Odoo reserve la mercancía`);
  }

  const [tipo] = await odoo.leer('stock.picking.type', 'search_read', [[['id', '=', m2oId(p.picking_type_id)]]], { fields: ['create_backorder'] }, cid);
  const [compania] = await odoo.leer('res.company', 'search_read', [[['id', '=', cid]]], {
    fields: ['stock_move_sms_validation', 'has_received_warning_stock_sms'] }, cid);
  documento.pendiente_tipo_operacion = tipo?.create_backorder ?? null;

  const advertencias = [];
  // SMS de confirmación (stock_sms): solo órdenes de entrega cuyo contacto tiene teléfono. Si la compañía nunca vio el aviso
  // de SMS, button_validate devolvería ese asistente en vez de validar: se detiene antes de escribir nada.
  if (p.picking_type_code === 'outgoing' && compania?.stock_move_sms_validation && m2oId(p.partner_id)) {
    const [contacto] = await odoo.leer('res.partner', 'search_read', [[['id', '=', m2oId(p.partner_id)]]], { fields: ['phone', 'mobile'] }, cid);
    if (contacto?.phone || contacto?.mobile) {
      if (!compania.has_received_warning_stock_sms) {
        throw new Error('Odoo mostraría el aviso de SMS (primera validación de la compañía) en vez de validar: validar este documento a mano en Odoo');
      }
      advertencias.push('Al validar, Odoo envía al cliente el SMS de confirmación de entrega, igual que cuando se valida a mano');
    }
  }
  const porMove = new Map((d.lineas || []).filter((l) => l.move_odoo_id).map((l) => [Number(l.move_odoo_id), l]));
  const vistos = new Set();
  const lineas = [];
  for (const m of doc.moves) {
    if (m.state === 'cancel') continue;
    vistos.add(m.id);
    const producto = m2oNombre(m.product_id);
    const reservada = r4(m.quantity);
    const demandada = r4(m.product_uom_qty);
    const l = porMove.get(m.id);
    if (!l && reservada > EPS) throw new Error(`El documento cambió en Odoo después del cierre: ${producto} no estaba en la entrega de GUDS`);
    const esperada = r4(l?.esperada ?? 0);
    let entregada = d.resultado === 'completa' ? reservada : r4(l?.entregada ?? 0);
    let yaEscrita = false;
    if (Math.abs(esperada - reservada) > EPS) {
      // Reintento después de un intento que ya escribió la cantidad (y marcó el movimiento como preparado)
      if (d.resultado === 'incompleta' && m.picked && Math.abs(reservada - entregada) <= EPS) {
        yaEscrita = true;
        advertencias.push(`${producto}: la cantidad entregada ya estaba escrita en Odoo (intento anterior)`);
      } else {
        throw new Error(`Las cantidades reservadas cambiaron en Odoo desde el cierre (${producto}: GUDS ${esperada} / Odoo ${reservada}); revisar antes de validar`);
      }
    }
    if (entregada < -EPS || entregada - reservada > EPS) throw new Error(`${producto}: la cantidad entregada (${entregada}) no está entre 0 y lo reservado (${reservada})`);
    if (d.resultado === 'completa') entregada = reservada;
    const mls = doc.lineas.filter((x) => m2oId(x.move_id) === m.id);
    // Lotes: Odoo exige el lote en cada línea de un producto con seguimiento, y avisa si alguno está vencido
    if (['lot', 'serial'].includes(m.has_tracking) && entregada > EPS) {
      const sinLote = mls.filter((x) => x.quantity > EPS && !m2oId(x.lot_id) && !x.lot_name);
      if (sinLote.length) throw new Error(`${producto}: hay cantidades sin lote en Odoo (Odoo exige el lote para validar)`);
      const conLote = r4(mls.reduce((s, x) => s + (m2oId(x.lot_id) || x.lot_name ? Number(x.quantity) : 0), 0));
      if (Math.abs(conLote - reservada) > EPS) throw new Error(`${producto}: las líneas de lote (${conLote}) no cuadran con lo reservado (${reservada})`);
    }
    // Reparto de lo entregado entre las líneas de lote, en el orden de Odoo: si se entrega menos, regresan las últimas
    let resto = entregada;
    const lotes = mls.map((x) => {
      const cant = r4(x.quantity);
      const nueva = yaEscrita ? cant : r4(Math.min(cant, Math.max(0, resto)));
      resto = r4(resto - nueva);
      const lote = doc.lote.get(m2oId(x.lot_id));
      return { ml_id: x.id, lote: m2oNombre(x.lot_id) || x.lot_name || null, vence: lote?.expiration_date || null, vencido: !!lote?.product_expiry_alert,
        cantidad: cant, nueva, picked: x.picked };
    });
    const vencidos = lotes.filter((x) => x.vencido && x.nueva > EPS);
    if (vencidos.length) {
      throw new Error(`${producto}: el lote ${vencidos.map((x) => x.lote).join(', ')} está vencido en Odoo; Odoo pediría confirmación al validar: validar a mano en Odoo`);
    }
    lineas.push({ move_id: m.id, producto, unidad: m2oNombre(m.product_uom), demandada, reservada, entregada, motivo: l?.motivo || null,
      picked: m.picked, ya_escrita: yaEscrita, lotes });
  }
  for (const [mid, l] of porMove) {
    if (!vistos.has(mid) && Number(l.esperada) > EPS) throw new Error(`${l.producto || `El movimiento ${mid}`} ya no está en el documento de Odoo (o se canceló)`);
  }
  const entregadaTotal = r4(lineas.reduce((s, l) => s + l.entregada, 0));
  if (entregadaTotal <= EPS) throw new Error('No hay nada entregado que validar en Odoo');

  // ── 2. Pendiente (backorder) ───────────────────────────────────────
  const faltoCamion = lineas.filter((l) => l.motivo === 'falto_camion' && l.entregada < l.reservada - EPS);
  const sinReserva = lineas.filter((l) => l.reservada < l.demandada - EPS);
  const otrosMotivos = lineas.filter((l) => l.motivo && l.motivo !== 'falto_camion' && l.entregada < l.reservada - EPS);
  const crearPendiente = faltoCamion.length > 0 || sinReserva.length > 0;
  const quedaAlgo = lineas.some((l) => l.entregada < l.demandada - EPS);
  const motivoPendiente = !quedaAlgo ? 'Se entrega todo lo pedido: no queda pendiente'
    : crearPendiente ? [faltoCamion.length && `faltó en el camión: ${faltoCamion.map((l) => l.producto).join(', ')}`,
      sinReserva.length && `Odoo no tenía todo reservado: ${sinReserva.map((l) => `${l.producto} (${l.reservada} de ${l.demandada})`).join(', ')}`].filter(Boolean).join(' · ')
      : `Sin pendiente: ${otrosMotivos.map((l) => `${l.producto} (${l.motivo})`).join(', ')}`;
  if (quedaAlgo && typeof d.crear_pendiente === 'boolean' && d.crear_pendiente !== crearPendiente) {
    advertencias.push(`Con los datos actuales de Odoo el pendiente queda en "${crearPendiente ? 'sí' : 'no'}" (GUDS calculó "${d.crear_pendiente ? 'sí' : 'no'}")`);
  }
  if (crearPendiente && otrosMotivos.length) {
    advertencias.push(`El pendiente incluirá también lo no entregado por otros motivos (${otrosMotivos.map((l) => `${l.producto}: ${l.motivo}`).join(', ')}); administración puede ajustarlo en Odoo`);
  }
  if (quedaAlgo && tipo?.create_backorder === 'never' && crearPendiente) advertencias.push('El tipo de operación de Odoo está en "nunca crear pendiente": Odoo no lo creará');
  if (quedaAlgo && tipo?.create_backorder === 'always' && !crearPendiente) advertencias.push('El tipo de operación de Odoo está en "crear pendiente siempre": Odoo lo creará igual');
  if (lineas.some((l) => l.entregada < l.reservada - EPS && l.lotes.filter((x) => x.lote).length > 1)) {
    advertencias.push(`Lote que regresa asumido (los últimos de la lista de Odoo): ${lineas.flatMap((l) => l.lotes.filter((x) => x.nueva < x.cantidad - EPS)
      .map((x) => `${l.producto.slice(0, 40)} lote ${x.lote || '—'}: ${x.cantidad} → ${x.nueva}`)).join('; ')}; confirmar con el almacén`);
  }

  // ── 3. Plan de escrituras ──────────────────────────────────────────
  const escrituras = [];
  for (const l of lineas) {
    if (d.resultado !== 'incompleta' || l.ya_escrita || Math.abs(l.entregada - l.reservada) <= EPS) continue;
    for (const x of l.lotes) {
      if (Math.abs(x.nueva - x.cantidad) <= EPS) continue;
      escrituras.push({ modelo: 'stock.move.line', ids: [x.ml_id], valores: { quantity: x.nueva },
        detalle: `${l.producto} · lote ${x.lote || '—'}: ${x.cantidad} → ${x.nueva}` });
    }
  }
  // Movimientos que se entregan (aunque sea en parte) → preparados. Si ninguno lo está y es completa, Odoo los marca solo al validar.
  const entregados = lineas.filter((l) => l.entregada > EPS);
  const hayPreparados = lineas.some((l) => l.picked);
  const marcar = d.resultado === 'incompleta' || hayPreparados ? entregados.filter((l) => !l.picked).map((l) => l.move_id) : [];
  for (const ids of lotesDe(marcar, 100)) {
    escrituras.push({ modelo: 'stock.move', ids, valores: { picked: true },
      detalle: `Preparado: ${entregados.filter((l) => ids.includes(l.move_id)).map((l) => `${l.producto.slice(0, 40)} ${l.entregada}`).join(', ')}` });
  }
  // Lo que no se entrega nada no se marca como preparado (queda para el pendiente o se cancela al validar)
  const desmarcar = lineas.filter((l) => l.entregada <= EPS && l.picked).map((l) => l.move_id);
  for (const ids of lotesDe(desmarcar, 100)) {
    escrituras.push({ modelo: 'stock.move', ids, valores: { picked: false }, detalle: 'No entregado: no se marca como preparado' });
  }
  // Mismo efecto que el asistente de pendiente de Odoo: "Crear pendiente" (process) o "Sin pendiente" (process_cancel_backorder)
  const contexto = crearPendiente ? { skip_backorder: true } : { skip_backorder: true, picking_ids_not_to_backorder: [pid] };
  const validacion = { modelo: 'stock.picking', metodo: 'button_validate', ids: [pid], contexto };
  const plan = {
    modo: aplicar ? 'activo' : 'simulacion', resultado: d.resultado, documento, crear_pendiente: crearPendiente, motivo_pendiente: motivoPendiente,
    lineas: lineas.map(({ picked, ...l }) => ({ ...l, lotes: l.lotes.map(({ picked: _p, ...x }) => x) })),
    escrituras, validacion, advertencias,
  };
  if (!aplicar) {
    log(`${p.name}: simulación → ${escrituras.length} escrituras + button_validate (${crearPendiente ? 'con' : 'sin'} pendiente)`);
    return plan;
  }

  // ── 4. Aplicar: releer justo antes, escribir, validar y confirmar ────
  const antes = await leerDocumento(odoo, pid, cid);
  if (!antes || antes.p.state !== 'assigned' || firma(antes) !== firma(doc)) {
    throw new Error(`El documento ${p.name} cambió en Odoo mientras se procesaba (estado ${antes?.p.state ?? 'no existe'}): no se escribió nada; reintentar`);
  }
  const hechas = [];
  for (const e of escrituras) {
    await odoo.escribir(e.modelo, e.ids, e.valores, cid);
    hechas.push(e.detalle);
  }
  let respuesta;
  try {
    respuesta = await odoo.accion('stock.picking', 'button_validate', [pid], cid, contexto);
  } catch (e) {
    throw new Error(`Odoo rechazó la validación de ${p.name}: ${e.message}${hechas.length ? ` (ya se escribieron ${hechas.length} cambios de cantidad; el documento sigue "Listo")` : ''}`);
  }
  const [despues] = await odoo.leer('stock.picking', 'search_read', [[['id', '=', pid]]], { fields: ['name', 'state', 'date_done'] }, cid);
  const esAsistente = respuesta && typeof respuesta === 'object' && respuesta.res_model;
  if (despues?.state !== 'done') {
    throw new Error(`${p.name} NO quedó validado en Odoo (estado ${despues?.state ?? '?'})${esAsistente ? `: Odoo pidió confirmación (${respuesta.res_model})` : ''}`
      + `${hechas.length ? `; ya se escribieron ${hechas.length} cambios de cantidad` : ''}. Revisar y validar a mano en Odoo`);
  }
  const pendientes = await odoo.leer('stock.picking', 'search_read', [[['backorder_id', '=', pid]]], { fields: ['name', 'state'] }, cid);
  log(`${p.name} validado en Odoo${pendientes.length ? ` · pendiente ${pendientes.map((b) => b.name).join(', ')}` : ''}`);
  return {
    ...plan, resultado_odoo: 'validado', escrituras_hechas: hechas,
    respuesta: esAsistente ? { asistente: respuesta.res_model } : respuesta === true ? true : typeof respuesta === 'object' ? { tipo: respuesta?.type ?? null } : respuesta ?? null,
    documento_final: { estado: despues.state, fecha_validado: despues.date_done },
    pendientes: pendientes.map((b) => ({ id: b.id, nombre: b.name, estado: b.state })),
  };
}
