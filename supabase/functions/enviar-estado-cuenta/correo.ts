// Correo del estado de cuenta (fase 20w): HTML de marca compatible con clientes de correo (tablas, estilos en línea, botón
// a prueba de Outlook) y su versión en texto plano. Todo lo variable se escapa.
// 21b: la franja aprobada (por cobrar, vencido con su antigüedad, por vencer, a favor, neto y notas de débito) y los
// documentos con saldo con lo abonado, el saldo, "qué falta" y el comentario visible para el cliente (hasta 15; el resto
// en el PDF y en el enlace).
// 22c: los documentos con el formato de finanzas (Tipo y Nº, Nº de control, vencimiento y días, total, deuda y estatus),
// las notas de crédito a favor en negativo y la fila de total; el detalle completo va en el PDF adjunto y en el enlace.

export interface DatosCorreo {
  hoy: string;
  cliente: { nombre: string; rif?: string | null; codigo?: string | null };
  empresa: {
    nombre: string; nombre_corto?: string | null; rif?: string | null; direccion?: string | null; ciudad?: string | null;
    telefono?: string | null; email?: string | null; sitio_web?: string | null; color?: string | null; logo_url?: string | null;
  };
  resumen: {
    saldo: number; vencido: number; por_vencer: number; a_favor: number; neto: number; facturas_vencidas: number; facturas_abiertas: number;
    d1_30?: number; d31_60?: number; d61_90?: number; mas_90?: number; notas_debito_saldo?: number; notas_debito_abiertas?: number;
  };
  documentos?: DocumentoCorreo[];
  url: string;
  mensaje?: string | null;
  remitente?: string | null;
  responder?: boolean;
}

export interface DocumentoCorreo {
  numero: string; tipo: string; vence: string | null; dias: number; total: number; abonado: number; saldo: number;
  que_falta?: string | null; comentario?: string | null;
  nro_control?: string | null; emision?: string | null; tasa?: number | null; base?: number | null; iva?: number | null; estatus?: string | null;
}

const TIPO_CORTO: Record<string, string> = { factura: "FACT", nota_credito: "NC", nota_debito: "ND" };
const ESTATUS: Record<string, string> = {
  pendiente: "Pendiente por cobrar", retencion: "Pendiente comprobante de retención", nc_favor: "NC a favor", a_favor: "Saldo a favor",
};
const estatusDe = (x: DocumentoCorreo) => ESTATUS[x.estatus ?? ""] ?? (x.saldo < 0 ? "NC a favor" : "Pendiente por cobrar");
const fechaDMA = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");

const MAX_DOCS = 15;

const esc = (s: unknown) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const fmtUsd = (n: unknown) => {
  const v = Number(n);
  const x = Number.isFinite(v) ? v : 0;
  const signo = x < 0 && Math.abs(x) >= 0.005 ? "-" : "";
  return `${signo}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const fechaLarga = (s: string) => {
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("es-VE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

const colorDe = (c?: string | null) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : "#8f1a1a");

export const asuntoPorDefecto = (d: Pick<DatosCorreo, "empresa" | "hoy">) =>
  `Tu estado de cuenta con ${d.empresa.nombre_corto || d.empresa.nombre} al ${fechaLarga(d.hoy)}`;

export function armarCorreo(d: DatosCorreo) {
  const color = colorDe(d.empresa.color);
  const marca = d.empresa.nombre_corto || d.empresa.nombre;
  const fecha = fechaLarga(d.hoy);
  const r = d.resumen;
  const vencido = Number(r.vencido) > 0.004;
  const pie = [d.empresa.nombre, d.empresa.rif && `RIF ${d.empresa.rif}`, [d.empresa.direccion, d.empresa.ciudad].filter(Boolean).join(", "),
    d.empresa.telefono, d.empresa.email, d.empresa.sitio_web].filter(Boolean) as string[];
  const mensaje = (d.mensaje ?? "").trim();
  const FUENTE = "'Plus Jakarta Sans', 'Segoe UI', Helvetica, Arial, sans-serif";
  const pre = `Saldo por pagar ${fmtUsd(r.saldo)}${vencido ? `, vencido ${fmtUsd(r.vencido)}` : ""}. Consulta tu estado de cuenta actualizado en línea.`;

  // Antigüedad del vencido (en la misma franja, como en el PDF)
  const tramos = ([["1–30 días", r.d1_30], ["31–60 días", r.d31_60], ["61–90 días", r.d61_90], ["Más de 90 días", r.mas_90]] as [string, number | undefined][])
    .filter(([, v]) => Number(v) > 0.004);
  type Fila = [string, string, string | undefined, boolean?];
  const filas: Fila[] = [
    ["Saldo por pagar", fmtUsd(r.saldo), undefined],
    ["Vencido", fmtUsd(r.vencido), vencido ? "#b91c1c" : undefined],
    ...tramos.map(([k, v]): Fila => [`· ${k}`, fmtUsd(v), "#6b7280", true]),
    ["Por vencer", fmtUsd(r.por_vencer), undefined],
    ["A favor (notas de crédito y anticipos)", fmtUsd(-Number(r.a_favor || 0)), Number(r.a_favor) > 0.004 ? "#047857" : undefined],
    ...(Number(r.notas_debito_saldo) > 0.004 ? [["Notas de débito (incluidas en el saldo)", fmtUsd(r.notas_debito_saldo), "#6b7280", true] as Fila] : []),
  ];
  const docs = d.documentos ?? [];
  const docsVisibles = docs.slice(0, MAX_DOCS);
  const totalDeuda = docs.reduce((s, x) => s + Number(x.saldo || 0), 0);
  const vence = (x: DocumentoCorreo) => (x.saldo < 0 ? `${x.dias} días` : x.dias > 0 ? `vencida hace ${x.dias} ${x.dias === 1 ? "día" : "días"}` : x.dias === 0 ? "vence hoy" : `vence en ${-x.dias} ${x.dias === -1 ? "día" : "días"}`);
  const tipoNum = (x: DocumentoCorreo) => `${TIPO_CORTO[x.tipo] ?? ""} ${x.numero}`.trim();
  const celda = "padding:9px 12px; font-size:13px; line-height:18px; border-top:1px solid #f0f1f3;";
  const cab = "padding:8px 12px; font-size:11px; line-height:16px; color:#6b7280; font-weight:600;";
  const tablaDocs = docsVisibles.length ? `<p style="margin:26px 0 8px 0; font-size:14px; line-height:20px; font-weight:700;">Documentos con saldo</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb; border-radius:8px; border-collapse:separate;">
              <tr><td style="${cab}">Tipo y Nº</td><td style="${cab}">Vencimiento</td><td align="right" style="${cab}">Total US$</td><td align="right" style="${cab}">Deuda US$</td></tr>
              ${docsVisibles.map((x) => `<tr>
                <td style="${celda}">
                  <strong>${esc(tipoNum(x))}</strong>
                  ${x.nro_control ? `<div style="font-size:11px; line-height:16px; color:#6b7280;">Control ${esc(x.nro_control)} · emitida ${esc(fechaDMA(x.emision))}</div>` : ""}
                  <div style="font-size:11px; line-height:16px; color:${x.estatus === "retencion" ? "#92400e" : x.saldo < 0 ? "#047857" : "#374151"};">${esc(estatusDe(x))}</div>
                  ${x.que_falta ? `<div style="font-size:11px; line-height:16px; color:#92400e;">${esc(x.que_falta)}</div>` : ""}
                  ${x.comentario ? `<div style="font-size:11px; line-height:16px; color:#374151; font-style:italic;">${esc(x.comentario)}</div>` : ""}
                </td>
                <td valign="top" style="${celda} white-space:nowrap;">${esc(fechaDMA(x.vence ?? x.emision))}
                  <div style="font-size:11px; line-height:16px; color:${x.saldo > 0 && x.dias > 0 ? "#b91c1c" : "#6b7280"};">${esc(vence(x))}</div></td>
                <td align="right" valign="top" style="${celda} white-space:nowrap;">${esc(fmtUsd(x.total))}</td>
                <td align="right" valign="top" style="${celda} white-space:nowrap; font-weight:700;${x.saldo < 0 ? " color:#047857;" : ""}">${esc(fmtUsd(x.saldo))}</td>
              </tr>`).join("")}
              <tr><td colspan="3" style="${celda} font-weight:700; background-color:#f7f8fa;">Total deuda${docs.length > docsVisibles.length ? ` (${docs.length} documentos)` : ""}</td>
                <td align="right" style="${celda} font-weight:700; white-space:nowrap; background-color:#f7f8fa;">${esc(fmtUsd(totalDeuda))}</td></tr>
            </table>
            ${docs.length > docsVisibles.length ? `<p style="margin:8px 0 0 0; font-size:12px; line-height:18px; color:#6b7280;">Y ${docs.length - docsVisibles.length} documentos más: están en el PDF adjunto y en el enlace.</p>` : ""}` : "";

  const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(asuntoPorDefecto(d))}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  @media only screen and (max-width: 620px) {
    .contenedor { width: 100% !important; }
    .relleno { padding-left: 20px !important; padding-right: 20px !important; }
    .boton a { display: block !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#f3f4f6;">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6" style="background-color:#f3f4f6;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" class="contenedor" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
        <tr>
          <td bgcolor="${color}" style="background-color:${color}; border-radius:10px 10px 0 0; padding:22px 32px;" class="relleno">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                ${d.empresa.logo_url ? `<td width="44" valign="middle" style="padding-right:12px;"><img src="${esc(d.empresa.logo_url)}" width="40" height="40" alt="${esc(marca)}" style="display:block; border:0; border-radius:6px; background:#ffffff;"></td>` : ""}
                <td valign="middle" style="font-family:${FUENTE}; color:#ffffff;">
                  <div style="font-size:20px; line-height:26px; font-weight:700; letter-spacing:0.2px;">${esc(marca)}</div>
                  <div style="font-size:13px; line-height:18px; opacity:0.9;">Estado de cuenta</div>
                </td>
                <td align="right" valign="middle" style="font-family:${FUENTE}; color:#ffffff; font-size:12px; line-height:18px;">Corte al<br><strong style="font-size:13px;">${esc(fecha)}</strong></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff; padding:28px 32px 8px 32px; font-family:${FUENTE}; color:#111827;" class="relleno">
            <p style="margin:0 0 6px 0; font-size:15px; line-height:22px;">Hola,</p>
            <p style="margin:0 0 16px 0; font-size:18px; line-height:25px; font-weight:700;">${esc(d.cliente.nombre)}</p>
            <p style="margin:0 0 18px 0; font-size:14px; line-height:22px; color:#374151;">Te compartimos tu estado de cuenta con <strong>${esc(d.empresa.nombre)}</strong> al ${esc(fecha)}. Puedes consultarlo en línea, siempre actualizado, y también lo adjuntamos en PDF.</p>
            ${mensaje ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
              <tr><td style="border-left:3px solid ${color}; background-color:#f7f8fa; padding:12px 16px; font-size:14px; line-height:22px; color:#111827;">${esc(mensaje).replace(/\r?\n/g, "<br>")}${d.remitente ? `<div style="margin-top:8px; font-size:13px; color:#6b7280;">${esc(d.remitente)}</div>` : ""}</td></tr>
            </table>` : ""}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb; border-radius:8px; border-collapse:separate;">
              ${filas.map(([k, v, c, sub], i) => sub ? `<tr>
                <td style="padding:0 16px 7px 30px; font-size:12px; line-height:16px; color:#6b7280;">${esc(k)}</td>
                <td align="right" style="padding:0 16px 7px 16px; font-size:12px; line-height:16px; color:${c ?? "#6b7280"}; white-space:nowrap;">${esc(v)}</td>
              </tr>` : `<tr>
                <td style="padding:11px 16px; font-size:14px; line-height:20px; color:#4b5563;${i ? " border-top:1px solid #f0f1f3;" : ""}">${esc(k)}</td>
                <td align="right" style="padding:11px 16px; font-size:14px; line-height:20px; font-weight:600; color:${c ?? "#111827"}; white-space:nowrap;${i ? " border-top:1px solid #f0f1f3;" : ""}">${esc(v)}</td>
              </tr>`).join("")}
              <tr>
                <td bgcolor="#f7f8fa" style="background-color:#f7f8fa; padding:13px 16px; font-size:15px; line-height:20px; font-weight:700; border-top:1px solid #e5e7eb; border-radius:0 0 0 8px;">Saldo neto</td>
                <td bgcolor="#f7f8fa" align="right" style="background-color:#f7f8fa; padding:13px 16px; font-size:17px; line-height:20px; font-weight:700; white-space:nowrap; border-top:1px solid #e5e7eb; border-radius:0 0 8px 0;">${esc(fmtUsd(r.neto))}</td>
              </tr>
            </table>
            ${tablaDocs}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px 0;">
              <tr>
                <td align="center" class="boton">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(d.url)}" style="height:48px; v-text-anchor:middle; width:280px;" arcsize="14%" stroke="f" fillcolor="${color}">
                    <w:anchorlock/>
                    <center style="color:#ffffff; font-family:Arial, sans-serif; font-size:15px; font-weight:bold;">Ver estado de cuenta</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-- -->
                  <a href="${esc(d.url)}" target="_blank" rel="noopener" style="display:inline-block; background-color:${color}; color:#ffffff; font-family:${FUENTE}; font-size:15px; line-height:20px; font-weight:700; text-decoration:none; padding:14px 34px; border-radius:7px; mso-hide:all;">Ver estado de cuenta</a>
                  <!--<![endif]-->
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 0 0; font-size:12px; line-height:18px; color:#6b7280; text-align:center;">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${esc(d.url)}" target="_blank" rel="noopener" style="color:${color}; word-break:break-all;">${esc(d.url)}</a></p>
            <p style="margin:18px 0 24px 0; font-size:12px; line-height:18px; color:#6b7280; text-align:center;">El enlace es personal: compártelo solo con quien gestione los pagos de tu empresa.</p>
          </td>
        </tr>
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff; border-top:1px solid #eef0f2; border-radius:0 0 10px 10px; padding:18px 32px 22px 32px; font-family:${FUENTE}; font-size:11px; line-height:17px; color:#9ca3af;" class="relleno">
            ${pie.map(esc).join(" &middot; ")}<br>
            ${d.remitente ? `Enviado por ${esc(d.remitente)} desde el portal de ${esc(marca)}. ` : ""}${d.responder ? "Puedes responder a este correo." : "Este buzón no recibe respuestas."}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const texto = [
    `Estado de cuenta · ${d.empresa.nombre}`,
    `Corte al ${fecha}`,
    "",
    `Hola, ${d.cliente.nombre}:`,
    "",
    `Te compartimos tu estado de cuenta con ${d.empresa.nombre} al ${fecha}. Puedes consultarlo en línea, siempre actualizado, y también lo adjuntamos en PDF.`,
    ...(mensaje ? ["", mensaje, ...(d.remitente ? [`— ${d.remitente}`] : [])] : []),
    "",
    ...filas.map(([k, v, , sub]) => `${sub ? "  " : ""}${k}: ${v}`),
    `Saldo neto: ${fmtUsd(r.neto)}`,
    ...(docsVisibles.length ? ["", "Documentos con saldo:", ...docsVisibles.map((x) =>
      `- ${tipoNum(x)}${x.nro_control ? ` (control ${x.nro_control})` : ""}: vence ${fechaDMA(x.vence ?? x.emision)} (${vence(x)}), total ${fmtUsd(x.total)}, deuda ${fmtUsd(x.saldo)} · ${estatusDe(x)}${x.que_falta ? ` · ${x.que_falta}` : ""}${x.comentario ? ` · ${x.comentario}` : ""}`),
      ...(docs.length > docsVisibles.length ? [`Y ${docs.length - docsVisibles.length} documentos más en el PDF y en el enlace.`] : []),
      `Total deuda: ${fmtUsd(totalDeuda)}`] : []),
    "",
    "Ver estado de cuenta:",
    d.url,
    "",
    "El enlace es personal: compártelo solo con quien gestione los pagos de tu empresa.",
    "",
    "--",
    pie.join(" · "),
    d.responder ? "Puedes responder a este correo." : "Este buzón no recibe respuestas.",
  ].join("\n");

  return { html, texto };
}
