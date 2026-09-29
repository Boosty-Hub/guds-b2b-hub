// Almacenamiento de Supabase para las fotos de producto que vienen de Odoo o van a Odoo (migración 20r).
// Sin dependencias: corre en Node (scripts) y en Deno (función edge sync-odoo). Solo el bucket público `imagenes` y solo rutas
// bajo productos/. `clave` es la secret key del proyecto (sb_secret_…): vive en el servidor, nunca en el navegador.
const BUCKET = 'imagenes';
const RE_RUTA = /^productos\/[A-Za-z0-9._\/-]+$/;
export const TIPOS_IMAGEN = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export function crearStorage({ url, clave, timeoutMs = 60000 }) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base) || !clave) throw new Error('Almacenamiento: faltan la URL o la clave del proyecto');
  const publica = `${base}/storage/v1/object/public/${BUCKET}/`;
  const validar = (ruta) => {
    if (!RE_RUTA.test(ruta) || ruta.includes('..')) throw new Error(`Almacenamiento: ruta no permitida (${ruta})`);
    return ruta;
  };
  // Ruta dentro del bucket de una URL pública de GUDS (null si la URL no es del bucket)
  const rutaDe = (u) => {
    if (typeof u !== 'string' || !u.startsWith(publica)) return null;
    const ruta = decodeURI(u.slice(publica.length).split(/[?#]/)[0]);
    return RE_RUTA.test(ruta) && !ruta.includes('..') ? ruta : null;
  };

  async function subir(ruta, bytes, tipo) {
    validar(ruta);
    if (!TIPOS_IMAGEN[tipo]) throw new Error(`Almacenamiento: tipo de imagen no permitido (${tipo})`);
    const r = await fetch(`${base}/storage/v1/object/${BUCKET}/${ruta}`, {
      method: 'POST',
      // Ruta versionada por checksum: el contenido de una ruta no cambia, se puede guardar en caché un año
      headers: { apikey: clave, 'content-type': tipo, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
      body: bytes,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`Almacenamiento: no se pudo subir ${ruta} (${r.status}: ${(await r.text()).slice(0, 200)})`);
    return publica + ruta;
  }

  async function borrar(rutas) {
    const validas = rutas.filter((x) => RE_RUTA.test(x) && !x.includes('..'));
    if (!validas.length) return 0;
    const r = await fetch(`${base}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { apikey: clave, 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: validas }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`Almacenamiento: no se pudo borrar (${r.status})`);
    return validas.length;
  }

  // Descarga una foto del bucket de GUDS (solo URLs propias: la función no pide URLs arbitrarias)
  async function descargar(u, maxBytes = 5 * 1024 * 1024) {
    const ruta = rutaDe(u);
    if (!ruta) throw new Error('La foto no está en el almacenamiento de GUDS');
    const r = await fetch(publica + ruta, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`No se pudo descargar la foto de GUDS (${r.status})`);
    const tipo = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!TIPOS_IMAGEN[tipo]) throw new Error(`La foto de GUDS no es JPG, PNG, WebP ni GIF (${tipo || 'sin tipo'})`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.length) throw new Error('La foto de GUDS está vacía');
    if (bytes.length > maxBytes) throw new Error(`La foto pesa ${(bytes.length / 1048576).toFixed(1)} MB (máximo ${maxBytes / 1048576} MB)`);
    return { bytes, tipo, ruta };
  }

  return { urlPublica: (ruta) => publica + validar(ruta), rutaDe, subir, borrar, descargar };
}
