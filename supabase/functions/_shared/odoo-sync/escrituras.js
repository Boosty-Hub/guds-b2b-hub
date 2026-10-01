// Procesa una fila de odoo_escrituras (migración 19u): decide si se aplica o se simula según configuracion y la delega al
// escritor de su tipo. Deja el resultado (o el error) en la fila. Lo usa la función edge sync-odoo (?escritura=<id> y los
// reintentos de cada sincronización) y se puede correr desde scripts/.
// A cada escritor le pasa `quien`: el nombre de quien pidió el cambio en GUDS (para las notas "(GUDS)" en Odoo).
import { escribirEntrega } from './escribir-entrega.js';
import { escribirCliente } from './escribir-cliente.js';
import { escribirProducto } from './escribir-producto.js';
import { escribirClienteNuevo } from './escribir-cliente-nuevo.js';
import { escribirPersonaContacto } from './escribir-persona-contacto.js';
import { escribirLimite } from './escribir-limite.js';

const ESCRITORES = {
  entrega_estado: { fn: escribirEntrega, modo: 'odoo_escritura_entregas' },
  cliente_contacto: { fn: escribirCliente, modo: 'odoo_escritura_clientes' },     // teléfonos y dirección del cliente (19w)
  cliente_direccion: { fn: escribirCliente, modo: 'odoo_escritura_clientes' },
  producto: { fn: escribirProducto, modo: 'odoo_escritura_productos' },            // foto y descripción (20r)
  cliente_nuevo: { fn: escribirClienteNuevo, modo: 'odoo_escritura_clientes_nuevos' },        // crear o enlazar (20s)
  persona_contacto: { fn: escribirPersonaContacto, modo: 'odoo_escritura_clientes_nuevos' },  // contactos hijos de clientes y proveedores (20s, 20v)
  cliente_limite: { fn: escribirLimite, modo: 'odoo_escritura_clientes' },                    // límite de crédito (20s)
};

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

// `storage` (storage.js): lo necesita el escritor de productos para leer la foto del bucket de GUDS.
export async function procesarEscritura({ odoo, sql, id, log = () => {}, forzarSimulacion = false, storage = null }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('escritura: id inválido');
  // Se toma la fila (evita que dos procesos la escriban a la vez)
  const [fila] = await sql(`update odoo_escrituras set estado = 'procesando', intentos = intentos + 1
    where id = ${lit(id)} and estado in ('pendiente', 'error') returning id, empresa_id, tipo, referencia_id, datos, intentos, solicitado_por`);
  if (!fila) return { omitida: true };
  const escritor = ESCRITORES[fila.tipo];
  try {
    if (!escritor) throw new Error(`Tipo de escritura desconocido: ${fila.tipo}`);
    const [cfg] = await sql(`select valor from configuracion where clave = ${lit(escritor.modo)}`);
    const aplicar = !forzarSimulacion && (cfg?.valor ?? 'simular') === 'activo';
    const [sol] = fila.solicitado_por
      ? await sql(`select nullif(btrim(concat_ws(' ', nombre, apellido)), '') n from usuarios where id = ${lit(fila.solicitado_por)}`)
      : [];
    const quien = sol?.n || 'GUDS (automático)';
    const resultado = await escritor.fn({ odoo, sql, fila, aplicar, log, storage, quien });
    await sql(`update odoo_escrituras set estado = ${lit(aplicar ? 'hecha' : 'simulada')}, error = null, procesado_at = now(),
      resultado = ${lit(JSON.stringify(resultado ?? {}))}::jsonb where id = ${lit(id)}`);
    return { aplicar, resultado };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 800);
    await sql(`update odoo_escrituras set estado = 'error', error = ${lit(msg)}, procesado_at = now() where id = ${lit(id)}`).catch(() => {});
    log(`escritura ${id} ERROR: ${msg}`);
    return { error: msg };
  }
}
