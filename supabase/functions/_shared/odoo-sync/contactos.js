// Personas de contacto Odoo → GUDS (módulo Contactos, migración 20v).
//
// Qué se trae de res.partner (solo lectura):
//   · hijos de tipo 'contact' (personas, no compañías) de los clientes y proveedores que trae la sincronización;
//   · personas sueltas (sin empresa padre, sin rango de cliente ni de proveedor) que no son usuarios ni empleados de Odoo,
//     mientras configuracion.odoo_contactos_sueltos = 'importar'. El 30-sep Odoo tenía 0 hijos de tipo contacto y 135 personas
//     sueltas (carga de 2025 etiquetada "Cliente"/"Proveedor").
// Los hijos que creó GUDS (marca "(GUDS)" en las notas) no se importan: su fila de GUDS manda (origen 'guds').
// Escritura en public.cliente_contactos con origen 'odoo', upsert idempotente por odoo_id que NUNCA toca filas de origen
// 'guds'. En los hijos, el cliente o proveedor es el de Odoo; en los sueltos, el vínculo lo decide GUDS (se conserva).
// Las filas de Odoo que ya no vienen se borran solo si GUDS no les agregó nada (acceso al portal, vínculo, notas, principal).
// Al final, public.sincronizar_accesos_contactos() desactiva el acceso al portal de los contactos que cambiaron de cliente o
// quedaron inactivos (la escritura en modo réplica no dispara los triggers que lo hacen al editar en GUDS).
import { m2oId } from './odoo.js';
import { txt, jsonbLit } from './util.js';

const CAMPOS_CONTACTO = ['name', 'function', 'email', 'phone', 'mobile', 'parent_id', 'type', 'is_company', 'company_id', 'active', 'comment'];
const RE_MARCA_GUDS = /^(<p>)?\(GUDS\)/;

// Lee de Odoo los contactos a importar. `idsClientes` / `idsProveedores`: res.partner que la sincronización trae como tales.
export async function leerContactosOdoo({ odoo, sql, idsClientes, idsProveedores }) {
  const clientes = new Set(idsClientes);
  const proveedores = new Set(idsProveedores);
  const padres = [...new Set([...clientes, ...proveedores])];
  const hijos = padres.length
    ? await odoo.leerTodo('res.partner', [['type', '=', 'contact'], ['is_company', '=', false], ['parent_id', 'in', padres]], CAMPOS_CONTACTO)
    : [];
  const [cfg] = await sql(`select valor from configuracion where clave = 'odoo_contactos_sueltos'`);
  const conSueltos = (cfg?.valor ?? 'importar') === 'importar';
  let sueltos = [];
  if (conSueltos) {
    const personas = await odoo.leerTodo('res.partner',
      [['parent_id', '=', false], ['is_company', '=', false], ['customer_rank', '=', 0], ['supplier_rank', '=', 0]], CAMPOS_CONTACTO);
    const usuarios = await odoo.leerTodo('res.users', [], ['partner_id']);
    let empleados = [];
    try { empleados = await odoo.leerTodo('hr.employee', [], ['work_contact_id']); } catch { /* sin módulo o sin permiso de empleados */ }
    const excluir = new Set([...clientes, ...proveedores, ...usuarios.map((u) => m2oId(u.partner_id)), ...empleados.map((e) => m2oId(e.work_contact_id))]);
    sueltos = personas.filter((p) => !excluir.has(p.id));
  }
  return { hijos, sueltos, conSueltos, clientes, proveedores };
}

// Filas para cliente_contactos (una por persona de Odoo; los hijos creados por GUDS quedan fuera)
export function filasContactos({ hijos, sueltos, clientes }) {
  const fila = (p, padre, tipo) => ({
    odoo_id: p.id, padre_odoo_id: padre, padre_tipo: tipo, empresa_odoo: m2oId(p.company_id),
    nombre: txt(p.name, 200) || `ODOO-${p.id}`, cargo: txt(p.function, 200), email: txt(p.email, 255),
    telefono: txt(p.phone, 60), celular: txt(p.mobile, 60), activo: !!p.active,
  });
  const vistos = new Set();
  const out = [];
  for (const p of hijos) {
    if (RE_MARCA_GUDS.test(String(p.comment || '').trim()) || vistos.has(p.id)) continue;
    const padre = m2oId(p.parent_id);
    vistos.add(p.id);
    out.push(fila(p, padre, clientes.has(padre) ? 'cliente' : 'proveedor'));
  }
  for (const p of sueltos) {
    if (vistos.has(p.id)) continue;
    vistos.add(p.id);
    out.push(fila(p, null, null));
  }
  return out;
}

// Upsert de un lote de filas (idempotente: una segunda pasada no cambia nada). No toca filas de origen 'guds'.
export function sqlUpsertContactos(filas, ts) {
  return `
    insert into cliente_contactos (odoo_id, origen, odoo_padre_id, cliente_id, proveedor_id, empresa_id, nombre, cargo, email, telefono, celular, activo, odoo_sync_at)
    select x.odoo_id, 'odoo', x.padre_odoo_id, c.id, case when c.id is null then p.id end, coalesce(c.empresa_id, p.empresa_id, e.id),
      x.nombre, x.cargo, x.email, x.telefono, x.celular, x.activo, '${ts}'
    from jsonb_to_recordset(${jsonbLit(filas)}) as x(odoo_id int, padre_odoo_id int, padre_tipo text, empresa_odoo int, nombre text, cargo text,
      email text, telefono text, celular text, activo boolean)
    left join clientes c on x.padre_tipo = 'cliente' and c.odoo_id = x.padre_odoo_id
    left join proveedores p on x.padre_tipo = 'proveedor' and p.odoo_id = x.padre_odoo_id
    left join empresas e on e.odoo_company_id = x.empresa_odoo
    where x.padre_odoo_id is null or c.id is not null or p.id is not null
    on conflict (odoo_id) do update set
      odoo_padre_id = excluded.odoo_padre_id,
      cliente_id = case when excluded.odoo_padre_id is not null then excluded.cliente_id else cliente_contactos.cliente_id end,
      proveedor_id = case when excluded.odoo_padre_id is not null then excluded.proveedor_id else cliente_contactos.proveedor_id end,
      empresa_id = case when excluded.odoo_padre_id is not null or (cliente_contactos.cliente_id is null and cliente_contactos.proveedor_id is null)
        then excluded.empresa_id else cliente_contactos.empresa_id end,
      nombre = excluded.nombre, cargo = excluded.cargo, email = excluded.email, telefono = excluded.telefono, celular = excluded.celular,
      activo = excluded.activo, odoo_sync_at = excluded.odoo_sync_at, updated_at = now()
    where cliente_contactos.origen = 'odoo' and (
      (cliente_contactos.odoo_padre_id, cliente_contactos.nombre, cliente_contactos.cargo, cliente_contactos.email, cliente_contactos.telefono,
        cliente_contactos.celular, cliente_contactos.activo)
      is distinct from (excluded.odoo_padre_id, excluded.nombre, excluded.cargo, excluded.email, excluded.telefono, excluded.celular, excluded.activo)
      or (excluded.odoo_padre_id is not null and (cliente_contactos.cliente_id, cliente_contactos.proveedor_id, cliente_contactos.empresa_id)
        is distinct from (excluded.cliente_id, excluded.proveedor_id, excluded.empresa_id))
      or (excluded.odoo_padre_id is null and cliente_contactos.cliente_id is null and cliente_contactos.proveedor_id is null
        and cliente_contactos.empresa_id is distinct from excluded.empresa_id))`;
}

// Filas de Odoo que ya no vienen y que GUDS no enriqueció (sin acceso al portal, sin vínculo propio, sin notas ni principal)
export const sqlBorrarContactosViejos = (ids) => `
  with b as (delete from cliente_contactos k where k.origen = 'odoo' and not (k.odoo_id = any (array[${ids.join(',') || 0}]::int[]))
    and not exists (select 1 from usuarios u where u.contacto_id = k.id) and k.notas is null and not k.es_principal
    and (k.odoo_padre_id is not null or (k.cliente_id is null and k.proveedor_id is null))
    returning 1) select count(*)::int n from b`;

// Escribe (o simula) los contactos. `escribir` corre en modo réplica (sin triggers), como el resto del importador.
export async function escribirContactos({ sql, escribir, leidos, ts, aplicar, log = () => {}, aviso = () => {} }) {
  const filas = filasContactos(leidos);
  const r = { hijos: leidos.hijos.length, sueltos: leidos.sueltos.length, filas: filas.length, borrados: 0, accesos_desactivados: 0 };
  const [antes] = await sql(`select count(*)::int n from cliente_contactos where origen = 'odoo'`);
  if (!aplicar) { log(`    contactos: ${r.hijos} hijos de clientes/proveedores · ${r.sueltos} sueltos · ${antes.n} de Odoo ya en GUDS`); return r; }
  for (let i = 0; i < filas.length; i += 500) await escribir(sqlUpsertContactos(filas.slice(i, i + 500), ts));
  // Guardia de lectura: si Odoo devolviera muchos menos contactos que los que ya hay, no se borra nada
  if (antes.n >= 20 && filas.length < antes.n * 0.5 && leidos.conSueltos) {
    aviso(`Contactos: Odoo devolvió ${filas.length} y GUDS tiene ${antes.n} de Odoo; no se borra ninguno`);
  } else {
    r.borrados = (await sql(sqlBorrarContactosViejos(filas.map((f) => f.odoo_id))))[0]?.n ?? 0;
  }
  const [{ n: sin }] = await sql(`select count(*)::int n from cliente_contactos k where k.origen = 'odoo'
    and not (k.odoo_id = any (array[${filas.map((f) => f.odoo_id).join(',') || 0}]::int[]))`);
  if (sin) aviso(`Contactos: ${sin} de Odoo ya no vienen de Odoo pero se conservan porque GUDS les agregó datos (acceso, vínculo o notas)`);
  r.accesos_desactivados = (await sql(`select public.sincronizar_accesos_contactos() n`))[0]?.n ?? 0;
  log(`    contactos: ${r.filas} de Odoo (${r.hijos} hijos · ${r.sueltos} sueltos) · ${r.borrados} borrados · ${r.accesos_desactivados} accesos desactivados`);
  return r;
}
