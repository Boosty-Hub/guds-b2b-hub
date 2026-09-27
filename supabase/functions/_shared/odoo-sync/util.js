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
