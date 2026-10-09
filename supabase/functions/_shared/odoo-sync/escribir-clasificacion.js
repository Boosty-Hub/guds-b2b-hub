// Clasificación de clientes de finanzas → Odoo (22d; docs/PLAN-REPORTES-FINANZAS.md D5, decisión del 8-oct: opción A).
// La taxonomía de finanzas se guarda en Odoo reutilizando campos vacíos de res.partner:
//   · Industria (industry_id → res.partner.industry)              = tipo de cliente
//   · Canal de contacto (eu_partner_channel_id → eu.res.channel)    = canal (solo si el tipo tiene canal: GUDS)
//   · Segmento de contacto (eu_partner_segment_id → eu.res.segment) = categoría de cobranza
// Los tres catálogos de Odoo son COMPARTIDOS por las dos compañías: un mismo nombre ("Particular", "Resto") es un solo valor.
//
// Filas de la cola (odoo_escrituras.tipo = 'clasificacion'), según datos.accion:
//   · 'catalogo' (referencia = empresa): asegura que existan en Odoo los valores del catálogo de la empresa.
//   · 'clientes' (referencia = lote; hasta 25 clientes por fila): asegura los valores que usan y escribe los tres campos en el
//     partner de cada cliente, con el contexto de su compañía. Envía la asignación ACTUAL de GUDS (clasificacion_clientes):
//     si el cliente se volvió a enviar después (otra fila), esta lo deja para la más reciente. Al terminar dispara la parte
//     siguiente del mismo lote.
// Valores de catálogo: se busca en Odoo por nombre sin distinguir mayúsculas ni tildes. Si existe se reutiliza; si solo
// difiere en mayúsculas/tildes (los tipos viejos de Profit: "DISTRIBUIDOR", "PARTICULAR", "CORPORATIVO") se ajusta el nombre al
// de finanzas; si no existe se crea con SOLO el nombre. Nunca se archiva ni se borra nada (los 21 sectores en inglés quedan).
// aplicar = false (modo prueba, configuracion.odoo_escritura_clasificacion = 'simular'): lee Odoo y devuelve el plan (qué
// crearía, qué payload mandaría a cada partner, la nota); no escribe en Odoo ni cambia clientes en GUDS.
// Con aplicar: relee cada partner, deja clientes.tipo_cliente/canal/segmento con lo que quedó en Odoo (igual que importar.js)
// y una nota interna "(GUDS)" en el cliente (decisión D, 29-sep). Solo usa crear/escribir de odoo.js (sin unlink).
import { m2oId, m2oNombre } from './odoo.js';
import { txt, fechaCaracas } from './util.js';
import { dejarNota, cambiosTexto } from './notas.js';

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const jsonLit = (v) => `${lit(JSON.stringify(v))}::jsonb`;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Las tres dimensiones: modelo de Odoo, campo del partner, columna del catálogo de GUDS y de dónde sale el nombre
export const DIMENSIONES = [
  { clave: 'tipo', modelo: 'res.partner.industry', campo: 'industry_id', columna: 'odoo_industry_id', fuente: 'tipo', etiqueta: 'Tipo de cliente (Industria)', traducible: true },
  { clave: 'canal', modelo: 'eu.res.channel', campo: 'eu_partner_channel_id', columna: 'odoo_channel_id', fuente: 'canal', etiqueta: 'Canal' },
  { clave: 'categoria', modelo: 'eu.res.segment', campo: 'eu_partner_segment_id', columna: 'odoo_segment_id', fuente: 'categoria_cobranza', etiqueta: 'Categoría de cobranza (Segmento)' },
];
const CAMPOS_PARTNER = ['name', 'parent_id', 'type', 'company_id', 'active', 'industry_id', 'eu_partner_channel_id', 'eu_partner_segment_id', 'channel', 'segmentation'];
const nuevo = (nombre) => `(nuevo) ${nombre}`;

// Elige el valor existente de Odoo para un nombre: el id que ya tenía GUDS, si sigue llamándose igual; si no, el de nombre
// idéntico, el activo y el más antiguo.
function elegir(existentes, nombre, idGuardado) {
  const iguales = existentes.filter((r) => norm(r.name) === norm(nombre));
  if (!iguales.length) return null;
  return iguales.find((r) => r.id === idGuardado)
    ?? [...iguales].sort((a, b) => (b.name === nombre) - (a.name === nombre) || (b.active !== false) - (a.active !== false) || a.id - b.id)[0];
}

// Resuelve (y con aplicar, crea o ajusta) los valores de catálogo que necesitan `tipos` (filas de clasificacion_tipos).
// Devuelve { plan, ids } con ids[clave] = Map(nombre normalizado → id de Odoo | null si se crearía).
export async function resolverCatalogo({ odoo, sql, tipos, cid, aplicar, log = () => {} }) {
  const plan = [];
  const ids = {};
  const avisos = [];
  for (const d of DIMENSIONES) {
    ids[d.clave] = new Map();
    const nombres = new Map();
    for (const t of tipos) {
      const n = txt(t[d.fuente]);
      if (n && !nombres.has(norm(n))) nombres.set(norm(n), { nombre: n, guardado: t[d.columna] ?? null });
    }
    if (!nombres.size) continue;
    const existentes = await odoo.leer(d.modelo, 'search_read', [[]], { fields: ['name', 'active'], order: 'id' });
    // Nombre visible en el idioma del usuario de Odoo (es_VE): si difiere del base también se ajusta en ese idioma
    const idioma = d.traducible ? (odoo.idioma || 'es_VE') : null;
    const enIdioma = idioma ? new Map((await odoo.leer(d.modelo, 'search_read', [[]], { fields: ['name'], context: { lang: idioma } })).map((r) => [r.id, r.name])) : null;
    for (const [k, { nombre, guardado }] of nombres) {
      const r = elegir(existentes, nombre, guardado);
      const visible = r && enIdioma ? enIdioma.get(r.id) : r?.name;
      const accion = !r ? 'crear' : (r.name === nombre && visible === nombre) ? 'reusar' : 'renombrar';
      const p = { dimension: d.clave, modelo: d.modelo, nombre, accion, odoo_id: r?.id ?? null, ...(r && r.name !== nombre ? { antes: r.name } : {}),
        ...(r && visible !== r.name ? { antes_idioma: visible } : {}), ...(r && r.active === false ? { archivado: true } : {}) };
      if (r?.active === false) avisos.push(`En Odoo, "${r.name}" (${d.modelo} ${r.id}) está archivado: se usa igual, sin desarchivarlo`);
      if (aplicar) {
        if (accion === 'crear') {
          p.odoo_id = await odoo.crear(d.modelo, { name: nombre }, cid);
          if (!Number.isInteger(p.odoo_id)) throw new Error(`Odoo no devolvió el id de ${d.modelo} "${nombre}"`);
          log(`clasificación: creado ${d.modelo} ${p.odoo_id} "${nombre}"`);
        } else if (accion === 'renombrar') {
          if (r.name !== nombre) await odoo.escribir(d.modelo, [r.id], { name: nombre }, cid);
          if (idioma) {
            const [x] = await odoo.leer(d.modelo, 'read', [[r.id]], { fields: ['name'], context: { lang: idioma } });
            if (x && x.name !== nombre) await odoo.escribir(d.modelo, [r.id], { name: nombre }, cid, { lang: idioma });
          }
          log(`clasificación: ${d.modelo} ${r.id} "${r.name}" → "${nombre}"`);
        }
        // Todos los tipos de GUDS (de las dos empresas) con ese nombre quedan con el id de Odoo
        await sql(`update clasificacion_tipos set ${d.columna} = ${p.odoo_id}, odoo_verificado_at = now()
          where public.clasif_norm(${d.fuente}) = public.clasif_norm(${lit(nombre)}) and ${d.columna} is distinct from ${p.odoo_id}`);
      }
      ids[d.clave].set(k, p.odoo_id);
      plan.push(p);
    }
  }
  return { plan, ids, avisos };
}

const resumenPlan = (plan) => ({
  crear: plan.filter((p) => p.accion === 'crear').length,
  renombrar: plan.filter((p) => p.accion === 'renombrar').length,
  reusar: plan.filter((p) => p.accion === 'reusar').length,
});

// ── Catálogo de una empresa ────────────────────────────────────────────────
async function prepararCatalogo({ odoo, sql, fila, aplicar, log }) {
  const empresa = fila.datos?.empresa_id || fila.empresa_id || fila.referencia_id;
  const [e] = await sql(`select id, nombre_corto, odoo_company_id from empresas where id = ${lit(empresa)}`);
  if (!e?.odoo_company_id) throw new Error('La empresa no está ligada a Odoo');
  const tipos = await sql(`select * from clasificacion_tipos where empresa_id = ${lit(e.id)} and activo and not por_confirmar order by orden, tipo`);
  const pendientes = await sql(`select tipo from clasificacion_tipos where empresa_id = ${lit(e.id)} and activo and por_confirmar order by orden`);
  if (!odoo.empresas) await odoo.autenticar();
  const { plan, avisos } = await resolverCatalogo({ odoo, sql, tipos, cid: e.odoo_company_id, aplicar, log });
  return {
    modo: aplicar ? 'aplicada' : 'simulacion', accion: 'catalogo', empresa: e.nombre_corto, compania: e.odoo_company_id,
    tipos: tipos.length, resumen: resumenPlan(plan), plan,
    avisos: [...avisos, ...(pendientes.length ? [`Sin enviar hasta que finanzas los confirme: ${pendientes.map((p) => p.tipo).join(', ')}`] : [])],
  };
}

// ── Clientes ───────────────────────────────────────────────────────────────
// Lo que GUDS guardaría en clientes (mismo mapeo que importar.js)
const clasifDe = (p) => ({
  tipo_cliente: txt(m2oNombre(p.industry_id), 100),
  canal: txt(m2oNombre(p.eu_partner_channel_id), 100) || txt(p.channel, 100),
  segmento: txt(m2oNombre(p.eu_partner_segment_id), 100) || txt(p.segmentation, 100),
});

async function escribirClientes({ odoo, sql, fila, aplicar, log, quien }) {
  const ids = (Array.isArray(fila.datos?.clientes) ? fila.datos.clientes : []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
  if (!ids.length) throw new Error('La fila no trae clientes');
  if (ids.length > 100) throw new Error('Demasiados clientes en una fila (máximo 100)');
  const filas = await sql(`
    select c.id, c.nombre_negocio, c.odoo_id, c.empresa_id, e.odoo_company_id cid, cc.tipo_id, cc.estado, cc.escritura_id,
      t.tipo, t.canal, t.categoria_cobranza, t.activo, t.por_confirmar
    from clientes c join empresas e on e.id = c.empresa_id
    left join clasificacion_clientes cc on cc.cliente_id = c.id
    left join clasificacion_tipos t on t.id = cc.tipo_id
    where c.id = any (array[${ids.map(lit).join(',')}]::uuid[])`);
  // Clientes que se volvieron a enviar después (otra fila): los atiende la más reciente. fila.id ausente = prueba local.
  const mios = filas.filter((c) => !fila.id || c.escritura_id === fila.id);
  const resultados = new Map();
  const error = (c, msg) => resultados.set(c.id, { cliente: c.nombre_negocio, estado: 'error', error: msg });
  const validos = [];
  for (const c of mios) {
    if (!c.odoo_id) error(c, 'El cliente no está vinculado a Odoo');
    else if (!c.tipo_id) error(c, 'El cliente ya no tiene tipo asignado en GUDS');
    else if (c.estado !== 'asignada') error(c, 'La clasificación es una propuesta sin confirmar');
    else if (!c.activo || c.por_confirmar) error(c, `El tipo "${c.tipo}" está por confirmar o inactivo`);
    else if (!c.categoria_cobranza) error(c, `El tipo "${c.tipo}" no tiene categoría de cobranza`);
    else validos.push(c);
  }

  let catalogo = { plan: [], ids: { tipo: new Map(), canal: new Map(), categoria: new Map() }, avisos: [] };
  const partners = new Map();
  const companias = [...new Set(validos.map((c) => c.cid))];
  if (validos.length) {
    if (!odoo.empresas) await odoo.autenticar();
    const tipos = await sql(`select * from clasificacion_tipos where id = any (array[${[...new Set(validos.map((c) => c.tipo_id))].map(lit).join(',')}]::uuid[])`);
    catalogo = await resolverCatalogo({ odoo, sql, tipos, cid: companias[0], aplicar, log });
    for (const p of await odoo.leer('res.partner', 'read', [validos.map((c) => c.odoo_id)], { fields: CAMPOS_PARTNER })) partners.set(p.id, p);
  }

  // Plan por cliente: valores destino, diferencias con Odoo y nota
  const grupos = new Map();
  const planes = new Map();
  for (const c of validos) {
    const p = partners.get(c.odoo_id);
    if (!p) { error(c, `El contacto ${c.odoo_id} ya no existe en Odoo`); continue; }
    if (Array.isArray(p.parent_id)) { error(c, `En Odoo, ${c.odoo_id} no es el contacto principal del cliente`); continue; }
    const destino = { tipo: c.tipo, canal: c.canal, categoria: c.categoria_cobranza };
    const vals = {}; const payload = {}; const cambios = [];
    for (const d of DIMENSIONES) {
      const nombre = txt(destino[d.clave]);
      if (!nombre) continue;   // sin canal (Quirutec): el campo no se toca
      const id = catalogo.ids[d.clave].get(norm(nombre)) ?? null;
      const actual = Array.isArray(p[d.campo]) ? p[d.campo] : null;
      if (id && actual?.[0] === id) continue;
      if (id) vals[d.campo] = id;
      payload[d.campo] = id ?? nuevo(nombre);
      cambios.push({ campo: d.campo, etiqueta: d.etiqueta, antes: actual?.[1] ?? null, despues: nombre });
    }
    const nota = { modelo: 'res.partner', id: c.odoo_id,
      texto: `(GUDS) Clasificación de finanzas actualizada desde GUDS por ${quien} el ${fechaCaracas()}: ${cambiosTexto(cambios)}.` };
    const plan = { cliente: c.nombre_negocio, partner: c.odoo_id, compania: c.cid, payload, cambios, antes: clasifDe(p) };
    planes.set(c.id, plan);
    if (!cambios.length) {
      resultados.set(c.id, { ...plan, estado: aplicar ? 'hecha' : 'simulada', sin_cambios: true });
      continue;
    }
    if (!aplicar) { resultados.set(c.id, { ...plan, estado: 'simulada', nota: { ...nota, simulada: true } }); continue; }
    const k = `${c.cid}|${JSON.stringify(vals)}`;
    if (!grupos.has(k)) grupos.set(k, { cid: c.cid, vals, clientes: [] });
    grupos.get(k).clientes.push({ ...c, nota });
  }

  // Escritura: un write por grupo de clientes con los mismos valores y la misma compañía. Si el grupo falla, se reintenta
  // cliente por cliente para que uno rechazado no deje sin escribir a los demás (22i)
  if (aplicar) {
    const pendientes = [...grupos.values()];
    while (pendientes.length) {
      const g = pendientes.shift();
      try {
        await odoo.escribir('res.partner', g.clientes.map((c) => c.odoo_id), g.vals, g.cid);
      } catch (e) {
        if (g.clientes.length > 1) {
          pendientes.unshift(...g.clientes.map((c) => ({ ...g, clientes: [c] })));
          continue;
        }
        for (const c of g.clientes) error(c, String(e?.message || e).slice(0, 300));
        continue;
      }
      const despues = new Map((await odoo.leer('res.partner', 'read', [g.clientes.map((c) => c.odoo_id)], { fields: CAMPOS_PARTNER }, g.cid)).map((p) => [p.id, p]));
      for (const c of g.clientes) {
        const p = despues.get(c.odoo_id);
        const noAplicados = Object.entries(g.vals).filter(([k, v]) => m2oId(p?.[k]) !== v).map(([k]) => k);
        const q = p ? clasifDe(p) : null;
        if (q) {
          await sql(`update clientes set tipo_cliente = ${lit(q.tipo_cliente)}, canal = ${lit(q.canal)}, segmento = ${lit(q.segmento)}
            where id = ${lit(c.id)} and (tipo_cliente, canal, segmento) is distinct from (${lit(q.tipo_cliente)}, ${lit(q.canal)}, ${lit(q.segmento)})`);
        }
        if (noAplicados.length) { error(c, `Odoo no dejó ${noAplicados.join(', ')} como se pidió`); continue; }
        const notaHecha = await dejarNota(odoo, c.nota, g.cid, true);
        resultados.set(c.id, { ...planes.get(c.id), estado: 'hecha', despues: q, nota: notaHecha });
      }
    }
  }

  // Resultado por cliente en GUDS (solo los de esta fila)
  const porCliente = mios.map((c) => {
    const r = resultados.get(c.id) ?? { cliente: c.nombre_negocio, estado: 'error', error: 'Sin resultado' };
    return { cliente_id: c.id, envio_estado: r.estado, envio_error: r.error ?? null, envio_detalle: r };
  });
  if (fila.id && porCliente.length) {
    await sql(`update clasificacion_clientes cc set envio_estado = x.envio_estado, envio_error = x.envio_error, envio_detalle = x.envio_detalle,
        envio_procesado_at = now()
      from jsonb_to_recordset(${jsonLit(porCliente)}) x(cliente_id uuid, envio_estado text, envio_error text, envio_detalle jsonb)
      where cc.cliente_id = x.cliente_id and cc.escritura_id = ${lit(fila.id)}`);
  }
  const cuenta = (e) => porCliente.filter((x) => x.envio_estado === e).length;
  log(`clasificación: ${porCliente.length} clientes (${aplicar ? `${cuenta('hecha')} escritos` : `${cuenta('simulada')} simulados`}, ${cuenta('error')} con error)`);

  // Parte siguiente del mismo lote
  let siguiente = null;
  if (fila.id && fila.datos?.lote) {
    const [s] = await sql(`select id from odoo_escrituras where tipo = 'clasificacion' and estado = 'pendiente' and id <> ${lit(fila.id)}
      and datos ->> 'lote' = ${lit(fila.datos.lote)} order by (datos ->> 'parte')::int, created_at limit 1`);
    if (s) { await sql(`select public.disparar_escritura_odoo(${lit(s.id)})`); siguiente = s.id; }
  }

  return {
    modo: aplicar ? 'aplicada' : 'simulacion', accion: 'clientes', lote: fila.datos?.lote ?? null, parte: fila.datos?.parte ?? null,
    partes: fila.datos?.partes ?? null, companias, catalogo: { resumen: resumenPlan(catalogo.plan), plan: catalogo.plan },
    resumen: { clientes: porCliente.length, hechos: cuenta('hecha'), simulados: cuenta('simulada'), errores: cuenta('error'),
      sin_cambios: porCliente.filter((x) => x.envio_detalle?.sin_cambios).length, otra_fila: filas.length - mios.length },
    avisos: catalogo.avisos, clientes: porCliente.map((x) => x.envio_detalle), siguiente,
  };
}

export async function escribirClasificacion({ odoo, sql, fila, aplicar, log = () => {}, quien = 'GUDS' }) {
  const accion = fila.datos?.accion;
  if (accion === 'catalogo') return prepararCatalogo({ odoo, sql, fila, aplicar, log });
  if (accion === 'clientes') return escribirClientes({ odoo, sql, fila, aplicar, log, quien });
  throw new Error(`Clasificación: acción desconocida (${accion ?? '—'})`);
}
