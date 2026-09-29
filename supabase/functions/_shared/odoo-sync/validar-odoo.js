// Validación de un registro nuevo contra la definición de Odoo ANTES de crearlo (fase 20s), para que la creación real no falle:
//   · cada campo existe (fields_get), no es de solo lectura y su valor tiene el tipo correcto (texto, número, sí/no, opción);
//   · los many2one apuntan a registros que existen (se leen);
//   · los campos obligatorios vienen en el payload o Odoo les pone un valor por defecto (default_get, que no escribe nada).
// Solo usa métodos de lectura de odoo.js. Devuelve { ok, errores, por_defecto } y lanza si no es válido y `lanzar` es true.

const ATRIBUTOS = ['type', 'string', 'required', 'readonly', 'selection', 'relation'];
const vacio = (v) => v === undefined || v === null || v === false || v === '';

export async function validarAlta(odoo, modelo, vals, cid, { lanzar = true } = {}) {
  const campos = await odoo.leer(modelo, 'fields_get', [], { attributes: ATRIBUTOS }, cid);
  const errores = [];
  for (const [k, v] of Object.entries(vals)) {
    const f = campos[k];
    if (!f) { errores.push(`${k}: no existe en Odoo`); continue; }
    if (f.readonly) errores.push(`${k}: es de solo lectura en Odoo`);
    if (v === false) continue;
    const t = f.type;
    if (t === 'selection' && !(f.selection || []).some(([s]) => s === v)) errores.push(`${k}: "${v}" no es una opción de Odoo`);
    else if (t === 'many2one' && !Number.isInteger(v)) errores.push(`${k}: se espera un id`);
    else if (t === 'boolean' && typeof v !== 'boolean') errores.push(`${k}: se espera verdadero o falso`);
    else if (['char', 'text', 'html'].includes(t) && typeof v !== 'string') errores.push(`${k}: se espera texto`);
    else if (t === 'integer' && !Number.isInteger(v)) errores.push(`${k}: se espera un entero`);
    else if (['float', 'monetary'].includes(t) && typeof v !== 'number') errores.push(`${k}: se espera un número`);
    else if (['one2many', 'many2many', 'binary'].includes(t)) errores.push(`${k}: tipo ${t} no admitido al crear desde GUDS`);
  }
  // Los many2one deben existir
  for (const [k, v] of Object.entries(vals)) {
    const f = campos[k];
    if (f?.type !== 'many2one' || !Number.isInteger(v)) continue;
    const r = await odoo.leer(f.relation, 'search_read', [[['id', '=', v]]], { fields: ['display_name'], limit: 1 }, cid);
    if (!r.length) errores.push(`${k}: no existe el registro ${v} de ${f.relation}`);
  }
  // Obligatorios: en el payload o con valor por defecto en Odoo
  const faltan = Object.entries(campos).filter(([k, f]) => f.required && vacio(vals[k])).map(([k]) => k);
  const porDefecto = faltan.length ? await odoo.leer(modelo, 'default_get', [faltan], {}, cid) : {};
  const sinValor = faltan.filter((k) => vacio(porDefecto[k]));
  if (sinValor.length) errores.push(`faltan campos obligatorios de Odoo: ${sinValor.map((k) => `${k} (${campos[k].string})`).join(', ')}`);
  const r = { ok: !errores.length, errores, por_defecto: Object.fromEntries(faltan.map((k) => [k, porDefecto[k] ?? null])) };
  if (!r.ok && lanzar) throw new Error(`Odoo no aceptaría el registro: ${errores.join(' · ')}`);
  return r;
}
