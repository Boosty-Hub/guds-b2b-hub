// Utilidades del importador (sin dependencias de Node ni Deno).

export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

export const stripHtml = (s) => {
  if (s == null || s === false) return null;
  const t = String(s)
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  return t || null;
};

// Texto de Odoo: false → null, recorta espacios
export const txt = (v, max = null) => {
  if (v == null || v === false) return null;
  const t = String(v).trim();
  if (!t) return null;
  return max ? t.slice(0, max) : t;
};

export const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

// Array JS como literal jsonb seguro dentro de SQL
export const jsonbLit = (arr) => `'${JSON.stringify(arr).replace(/'/g, "''")}'::jsonb`;

export const lotes = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// USD de un documento de venta: si la moneda es USD, el valor; si es VED y la moneda de referencia es USD,
// el valor de referencia (campos *_ref de la localización venezolana).
export const USD = 1;
export const aUsd = (valor, valorRef, monedaId, monedaRefId) =>
  monedaId === USD ? Number(valor || 0) : monedaRefId === USD ? Number(valorRef || 0) : Number(valor || 0);

// Fecha/hora de Odoo ("2026-09-27 12:00:00", UTC) → ISO
export const fechaOdoo = (v) => (v ? `${String(v).replace(' ', 'T')}Z` : null);

// Bytes ↔ base64 sin Buffer (Node y Deno): Odoo recibe y entrega las imágenes en base64
export const aBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const deBase64 = (b64) => {
  const s = atob(String(b64).replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

// ── RIF y nombres de clientes (decisión 3: sin duplicados por RIF ni por nombre) ─────────────────────────────
// RIF normalizado: mayúsculas sin signos ("J-12345678-9" → "J123456789"); igual que public.normalizar_rif()
export const rifNormalizado = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;

// Clave para comparar RIF escritos distinto: letra + 8 dígitos, sin el dígito verificador ("J-12345678-9", "J123456789" y
// "J-12345678" dan "J12345678"; una cédula de 7 dígitos se completa con un 0). Igual que public.clave_rif().
export function claveRif(s) {
  const n = rifNormalizado(s);
  if (!n || ['ND', 'NA', 'SINRIF'].includes(n)) return null;
  const m = n.match(/^([VEJPGC])(\d{7,9})$/);
  if (!m) return n;
  return m[1] + (m[2].length === 9 ? m[2].slice(0, 8) : m[2].padStart(8, '0'));
}

// Dígito verificador del RIF (algoritmo del SENIAT; coincide con el 98 % de los RIF de Odoo; los que no, son de relleno)
const VALOR_LETRA_RIF = { V: 1, E: 2, J: 3, P: 4, G: 5 };
const PESOS_RIF = [4, 3, 2, 7, 6, 5, 4, 3, 2];
export function digitoRif(letra, ochoDigitos) {
  if (!(letra in VALOR_LETRA_RIF) || !/^\d{8}$/.test(ochoDigitos)) return null;
  const suma = [VALOR_LETRA_RIF[letra], ...ochoDigitos.split('').map(Number)].reduce((a, x, i) => a + x * PESOS_RIF[i], 0);
  const r = 11 - (suma % 11);
  return r >= 10 ? 0 : r;
}

// RIF en el formato que usa Odoo: vat/rif "J-123456789" y cedula "J-12345678" (sin dígito verificador). Si el RIF viene sin
// dígito verificador se calcula. null si no es un RIF venezolano.
export function formatoRifOdoo(s) {
  const n = rifNormalizado(s);
  const m = n?.match(/^([VEJPGC])(\d{7,9})$/);
  if (!m) return null;
  const letra = m[1];
  const d = m[2].length === 7 ? `0${m[2]}` : m[2];
  const ocho = d.slice(0, 8);
  let dv = d.length === 9 ? Number(d[8]) : digitoRif(letra, ocho);
  if (dv === null) return null;
  const esperado = digitoRif(letra, ocho);
  return { vat: `${letra}-${ocho}${dv}`, cedula: `${letra}-${ocho}`, letra, digito_calculado: d.length !== 9,
    digito_dudoso: esperado !== null && esperado !== dv };
}

// Nombre de empresa comparable: mayúsculas, sin acentos ni signos ni sufijos societarios al final (C.A., S.A., S.R.L.…).
// Igual que public.normalizar_nombre_empresa().
const SUFIJOS_EMPRESA = new Set(['C', 'A', 'CA', 'S', 'SA', 'SRL', 'RL', 'R', 'L', 'COMPANIA', 'ANONIMA', 'CIA']);
export function normNombreEmpresa(t) {
  const tokens = String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (tokens.length > 1 && SUFIJOS_EMPRESA.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join('') || null;
}

// Fecha y hora de Caracas para las notas "(GUDS)" ("29/09/2026, 14:05")
export const fechaCaracas = (d = new Date()) => new Intl.DateTimeFormat('es-VE', {
  timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(d));
