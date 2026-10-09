import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, ClipboardList, FileDown, FileText, HandCoins, Loader2, Percent, Trash2 } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FichaCampos, Panel } from "@/components/datos/FichaCampos";
import { supabase } from "@/lib/supabase";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useToast } from "@/hooks/use-toast";
import { fmtUsd } from "@/components/estado-cuenta/formato";
import type { EmpresaEstadoCuenta } from "@/components/estado-cuenta/tipos";
import { fechaDMA } from "@/lib/fechas";
import { AbonarNotaDialog, AjusteNotaDialog, ConvertirNotaDialog, PapeleraNotaDialog } from "@/components/notas-entrega/AccionesNotaEntrega";
import { descargarPdfNotaEntrega, precargarPdfNotaEntrega } from "@/components/notas-entrega/pdf";
import {
  ESTADO_NOTA, MOVIMIENTO_NOTA, SERIE_NOTA, vigente, type FacturaParaNota, type ItemNota, type MovimientoNota, type NotaEntrega,
} from "@/components/notas-entrega/tipos";

// Detalle de una nota de entrega no fiscal (22g · NE1, 22j · NE2–NE3): sus líneas (del pedido de Odoo), lo abonado (enlazado
// a cobros de Odoo), lo que pasó a factura, devoluciones, descuentos y ajustes; las acciones y el PDF "documento no fiscal".

type Dialogo = "abonar" | "convertir" | "ajuste" | "anular" | null;

const NotaEntregaDetalle = () => {
  const { notaId } = useParams();
  const navigate = useNavigate();
  const { empresas, soloLectura } = useEmpresa();
  const { can } = usePermissions();
  const { toast } = useToast();
  const [nota, setNota] = useState<NotaEntrega | null>(null);
  const [movs, setMovs] = useState<(MovimientoNota & { pago?: { numero: string | null } | null; factura?: { numero: string } | null })[]>([]);
  const [items, setItems] = useState<ItemNota[]>([]);
  const [sugerencias, setSugerencias] = useState<FacturaParaNota[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [quitar, setQuitar] = useState<MovimientoNota | null>(null);
  const [pdf, setPdf] = useState(false);

  const cargar = useCallback(async () => {
    if (!notaId) return;
    const [n, m, i] = await Promise.all([
      supabase.from("v_notas_entrega").select("*").eq("id", notaId).maybeSingle(),
      supabase.from("nota_entrega_movimientos")
        .select("id, tipo, fecha, monto_usd, referencia, nota, origen, pago_id, factura_id, created_at, trasladado, pago:pagos(numero), factura:facturas(numero)")
        .eq("nota_id", notaId).order("fecha", { ascending: true, nullsFirst: true }).order("created_at"),
      supabase.from("nota_entrega_items").select("id, descripcion, cantidad, precio_usd, subtotal_usd, orden, orden_item_id").eq("nota_id", notaId).order("orden"),
    ]);
    setError(n.error?.message ?? m.error?.message ?? i.error?.message ?? null);
    const x = (n.data as NotaEntrega) ?? null;
    setNota(x);
    setMovs((m.data as unknown as typeof movs) ?? []);
    setItems((i.data as ItemNota[]) ?? []);
    if (x && vigente(x) && Number(x.sin_facturar) > 0.009 && x.cliente_id) {
      const { data } = await supabase.rpc("conversion_nota_entrega", { p_nota: x.id });
      setSugerencias(((data as FacturaParaNota[]) ?? []).filter((s) => s.del_pedido && Number(s.sugerido) > 0.009));
    } else setSugerencias([]);
    setCargando(false);
  }, [notaId]);

  useEffect(() => { setCargando(true); cargar(); }, [cargar]);

  const volver = (
    <Button variant="ghost" size="sm" className="mb-2 h-7 gap-1.5 px-2 text-xs" onClick={() => navigate("/admin/notas-entrega")}>
      <ArrowLeft className="h-3.5 w-3.5" /> Volver a notas de entrega
    </Button>
  );

  if (cargando) {
    return <MainLayout title="Nota de entrega">{volver}<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></MainLayout>;
  }
  if (!nota) {
    return (
      <MainLayout title="Nota de entrega">
        {volver}
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <ClipboardList className="mb-4 h-12 w-12 opacity-50" />
          <p>{error ? `No se pudo cargar la nota: ${error}` : "Nota de entrega no encontrada"}</p>
        </div>
      </MainLayout>
    );
  }

  const empresa = empresas.find((e) => e.id === nota.empresa_id)?.nombre_corto;
  const activa = vigente(nota);
  const puedeEditar = can("notas_entrega", "editar") && activa && !soloLectura;
  const puedeEliminar = can("notas_entrega", "eliminar") && !soloLectura;
  const saldo = Number(nota.saldo_usd);
  const sinFacturar = Number(nota.sin_facturar);

  const bajarPdf = async () => {
    setPdf(true);
    try {
      const [{ data: emp }, { data: cli }] = await Promise.all([
        supabase.from("empresas").select("id, nombre, nombre_corto, prefijo, rif, direccion, ciudad, estado, telefono, email, sitio_web, logo_url, color").eq("id", nota.empresa_id).maybeSingle(),
        nota.cliente_id ? supabase.from("clientes").select("direccion, ciudad, estado, telefono").eq("id", nota.cliente_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      await descargarPdfNotaEntrega({ nota, items, movimientos: movs, empresa: (emp as EmpresaEstadoCuenta) ?? null, cliente: cli as never });
    } catch (e) {
      toast({ title: "No se pudo generar el PDF", description: (e as Error).message, variant: "destructive" });
    } finally { setPdf(false); }
  };

  const recargar = () => { cargar(); };
  return (
    <MainLayout title={`Nota de entrega ${nota.documento}`}>
      {volver}
      <div className="mb-3 flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="ne-detalle" data-estado={nota.estado}>
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            Nota de entrega {nota.documento}
            <Badge variant="secondary">No fiscal</Badge>
            <Badge variant={ESTADO_NOTA[nota.estado].variant} data-testid="ne-estado">{ESTADO_NOTA[nota.estado].texto}</Badge>
            {nota.clasificacion === "incobrable" && <Badge variant="destructive">Incobrable</Badge>}
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            {nota.cliente_id ? <Link to={`/admin/cuentas/${nota.cliente_id}`} className="font-medium text-foreground hover:underline">{nota.cliente}</Link> : <span className="font-medium text-foreground">{nota.cliente}</span>}
            {nota.rif ? ` · ${nota.rif}` : ""}{!nota.cliente_id ? " · sin ficha en GUDS" : ""}
          </p>
        </div>
        <div className="sm:text-right">
          <p className={`text-lg font-semibold tabular-nums ${saldo > 0.009 ? "text-destructive" : ""}`} data-testid="ne-saldo">{fmtUsd(saldo)}</p>
          <p className="text-sm text-muted-foreground">Saldo{sinFacturar > 0.009 && sinFacturar < Number(nota.total_usd) - 0.009 ? ` · sin facturar ${fmtUsd(sinFacturar)}` : ""}</p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2" data-testid="ne-acciones">
        {puedeEditar && saldo > 0.009 && (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setDialogo("abonar")} data-testid="ne-btn-abonar"><HandCoins className="h-4 w-4" /> Registrar abono</Button>
        )}
        {puedeEditar && sinFacturar > 0.009 && nota.cliente_id && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setDialogo("convertir")} data-testid="ne-btn-convertir"><FileText className="h-4 w-4" /> Pasar a factura</Button>
        )}
        {puedeEditar && (saldo > 0.009 || sinFacturar > 0.009) && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setDialogo("ajuste")} data-testid="ne-btn-ajuste"><Percent className="h-4 w-4" /> Descuento o devolución</Button>
        )}
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={bajarPdf} onPointerEnter={precargarPdfNotaEntrega} disabled={pdf} data-testid="ne-pdf">
          {pdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} PDF
        </Button>
        {puedeEliminar && activa && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDialogo("anular")} data-testid="ne-btn-anular"><Ban className="h-4 w-4" /> Anular</Button>
        )}
      </div>
      {soloLectura && can("notas_entrega", "editar") && activa && (
        <p className="mb-3 text-xs text-muted-foreground">Estás viendo «Ambas empresas» (solo consulta): elige la empresa de la nota en el menú superior para registrar movimientos.</p>
      )}
      {sugerencias.length > 0 && (
        <div className="mb-3 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200" data-testid="ne-sugerencia">
          Odoo ya facturó lo de esta nota: la factura {sugerencias.map((s) => s.numero).join(", ")} del pedido {nota.pedido_odoo} incluye {fmtUsd(sugerencias[0].sugerido)} de sus líneas.
          {puedeEditar && <button type="button" className="ml-1 font-medium underline" onClick={() => setDialogo("convertir")}>Pasar a factura</button>}
        </div>
      )}
      {nota.estado === "anulada" && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Anulada {nota.anulada_at ? `el ${fechaDMA(nota.anulada_at.slice(0, 10))}` : ""}{nota.motivo_anulacion ? `: ${nota.motivo_anulacion}` : ""}. Se restaura desde la Papelera.
        </p>
      )}

      <Panel titulo="Datos">
        <FichaCampos campos={[
          { label: "Empresa", valor: empresa },
          { label: "Serie", valor: `${nota.serie} · ${SERIE_NOTA[nota.serie]}` },
          { label: "Número", valor: nota.numero, mono: true },
          { label: "Emisión", valor: fechaDMA(nota.fecha_emision) },
          { label: "Vencimiento", valor: fechaDMA(nota.fecha_vencimiento) },
          { label: "Vendedor", valor: nota.vendedor },
          { label: "Total (sin IVA)", valor: fmtUsd(nota.total_usd) },
          { label: "Abonado", valor: fmtUsd(nota.abonos) },
          { label: "Pasó a factura", valor: Number(nota.facturado) > 0.009 ? fmtUsd(nota.facturado) : "—" },
          { label: "Devuelto / descontado", valor: Number(nota.devuelto) + Number(nota.descontado) > 0.009 ? fmtUsd(Number(nota.devuelto) + Number(nota.descontado)) : "—" },
          { label: "Saldo", valor: fmtUsd(saldo) },
          { label: "Clasificación", valor: `${nota.clasificacion === "incobrable" ? "Incobrable" : "Deuda activa"}${nota.clasificacion_origen === "cliente" ? " (la del cliente)" : ""}` },
          { label: "Pedido de Odoo", valor: nota.pedido_odoo },
          { label: "Origen", valor: nota.origen === "excel" ? `Excel de finanzas${nota.archivo ? ` (${nota.archivo})` : ""}` : "GUDS (desde el pedido de Odoo)" },
          { label: "Observación", valor: nota.observacion, ancho: 3 },
        ]} />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel sinPadding titulo={`Abonos y movimientos (${movs.length})`}>
          {movs.length === 0 ? <p className="p-3 text-sm text-muted-foreground">Sin abonos.</p> : (
            <Table data-testid="ne-movimientos">
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Movimiento</TableHead><TableHead className="text-right">Monto</TableHead>{puedeEliminar && <TableHead className="w-8" />}</TableRow></TableHeader>
              <TableBody>
                {movs.map((m) => (
                  <TableRow key={m.id} className={m.trasladado ? "opacity-60" : ""} data-testid="ne-movimiento" data-tipo={m.tipo}>
                    <TableCell className="whitespace-nowrap py-1.5 align-top">{m.fecha ? fechaDMA(m.fecha) : <span className="text-muted-foreground">Sin fecha</span>}</TableCell>
                    <TableCell className="py-1.5">
                      {MOVIMIENTO_NOTA[m.tipo]}
                      {m.tipo === "abono" && (m.pago?.numero ? <span className="ml-1 font-mono text-[11px] text-muted-foreground">cobro {m.pago.numero}</span> : m.referencia ? <span className="ml-1 text-[11px] text-muted-foreground">ref. {m.referencia}</span> : null)}
                      {m.tipo === "facturada" && m.factura?.numero && <span className="ml-1 font-mono text-[11px] text-muted-foreground">FACT {m.factura.numero}</span>}
                      {m.trasladado && <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px]" title="Ya no cuenta en la nota: el cobro volvió a ser anticipo para aplicarlo en Odoo a la factura">Trasladado a la factura</Badge>}
                      {m.nota && <span className="block text-[11px] text-muted-foreground">{m.nota}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-1.5 text-right align-top tabular-nums">{fmtUsd(m.monto_usd)}</TableCell>
                    {puedeEliminar && (
                      <TableCell className="py-1.5 align-top">
                        {m.origen === "guds" && nota.estado !== "anulada" && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" aria-label={`Quitar ${MOVIMIENTO_NOTA[m.tipo].toLowerCase()}`}
                            onClick={() => setQuitar(m)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
        <Panel sinPadding titulo={`Líneas (${items.length})`}>
          {items.length === 0 ? <p className="p-3 text-sm text-muted-foreground">{nota.serie === "HIST" ? "Las notas históricas del Excel de finanzas no traen líneas." : "Sin líneas."}</p> : (
            <Table data-testid="ne-lineas">
              <TableHeader><TableRow><TableHead>Descripción</TableHead><TableHead className="text-right">Cant.</TableHead><TableHead className="hidden text-right sm:table-cell">Precio</TableHead><TableHead className="text-right">Subtotal</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="py-1.5">{l.descripcion}</TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums">{Number(l.cantidad).toLocaleString("es-VE")}</TableCell>
                    <TableCell className="hidden whitespace-nowrap py-1.5 text-right tabular-nums sm:table-cell">{fmtUsd(l.precio_usd)}</TableCell>
                    <TableCell className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtUsd(l.subtotal_usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>
      <p className="text-xs text-muted-foreground">
        Documento no fiscal (sin IVA): no está en Odoo. Cuenta como deuda interna en la antigüedad, en el detalle de la cuenta y, si se marca, en el estado de cuenta;
        y como venta por lo que no pasó a factura. La mercancía sale de Odoo con el pedido y su albarán.
      </p>

      <AbonarNotaDialog nota={nota} open={dialogo === "abonar"} onOpenChange={(o) => setDialogo(o ? "abonar" : null)} onHecho={recargar} soloLectura={soloLectura} />
      <ConvertirNotaDialog nota={nota} open={dialogo === "convertir"} onOpenChange={(o) => setDialogo(o ? "convertir" : null)} onHecho={recargar} soloLectura={soloLectura} />
      <AjusteNotaDialog nota={nota} open={dialogo === "ajuste"} onOpenChange={(o) => setDialogo(o ? "ajuste" : null)} onHecho={recargar} soloLectura={soloLectura} />
      <PapeleraNotaDialog nota={nota} open={dialogo === "anular"} onOpenChange={(o) => setDialogo(o ? "anular" : null)} onHecho={recargar} soloLectura={soloLectura} />
      <PapeleraNotaDialog nota={nota} movimiento={quitar} open={!!quitar} onOpenChange={(o) => { if (!o) setQuitar(null); }} onHecho={recargar} soloLectura={soloLectura} />
    </MainLayout>
  );
};

export default NotaEntregaDetalle;
