import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardList, Loader2 } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FichaCampos, Panel } from "@/components/datos/FichaCampos";
import { supabase } from "@/lib/supabase";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { fmtUsd } from "@/components/estado-cuenta/formato";
import { fechaDMA } from "@/lib/fechas";
import { ESTADO_NOTA, MOVIMIENTO_NOTA, SERIE_NOTA, type ItemNota, type MovimientoNota, type NotaEntrega } from "@/components/notas-entrega/tipos";

// Detalle de una nota de entrega no fiscal (22g · NE1): solo consulta.

const NotaEntregaDetalle = () => {
  const { notaId } = useParams();
  const navigate = useNavigate();
  const { empresas } = useEmpresa();
  const [nota, setNota] = useState<NotaEntrega | null>(null);
  const [movs, setMovs] = useState<MovimientoNota[]>([]);
  const [items, setItems] = useState<ItemNota[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!notaId) return;
    (async () => {
      setCargando(true);
      const [n, m, i] = await Promise.all([
        supabase.from("v_notas_entrega").select("*").eq("id", notaId).maybeSingle(),
        supabase.from("nota_entrega_movimientos").select("id, tipo, fecha, monto_usd, referencia, nota, origen, pago_id, factura_id, created_at").eq("nota_id", notaId)
          .order("fecha", { ascending: true, nullsFirst: true }).order("created_at"),
        supabase.from("nota_entrega_items").select("id, descripcion, cantidad, precio_usd, subtotal_usd, orden").eq("nota_id", notaId).order("orden"),
      ]);
      setError(n.error?.message ?? m.error?.message ?? i.error?.message ?? null);
      setNota((n.data as NotaEntrega) ?? null);
      setMovs((m.data as MovimientoNota[]) ?? []);
      setItems((i.data as ItemNota[]) ?? []);
      setCargando(false);
    })();
  }, [notaId]);

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
  return (
    <MainLayout title={`Nota de entrega ${nota.documento}`}>
      {volver}
      <div className="mb-3 flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="ne-detalle">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            Nota de entrega {nota.documento}
            <Badge variant="secondary">No fiscal</Badge>
            <Badge variant={ESTADO_NOTA[nota.estado].variant}>{ESTADO_NOTA[nota.estado].texto}</Badge>
            {nota.clasificacion === "incobrable" && <Badge variant="destructive">Incobrable</Badge>}
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            {nota.cliente_id ? <Link to={`/admin/cuentas/${nota.cliente_id}`} className="font-medium text-foreground hover:underline">{nota.cliente}</Link> : <span className="font-medium text-foreground">{nota.cliente}</span>}
            {nota.rif ? ` · ${nota.rif}` : ""}{!nota.cliente_id ? " · sin ficha en GUDS" : ""}
          </p>
        </div>
        <div className="sm:text-right">
          <p className={`text-lg font-semibold tabular-nums ${nota.saldo_usd > 0.009 ? "text-destructive" : ""}`} data-testid="ne-saldo">{fmtUsd(nota.saldo_usd)}</p>
          <p className="text-sm text-muted-foreground">Saldo</p>
        </div>
      </div>

      <Panel titulo="Datos">
        <FichaCampos campos={[
          { label: "Empresa", valor: empresa },
          { label: "Serie", valor: `${nota.serie} · ${SERIE_NOTA[nota.serie]}` },
          { label: "Número", valor: nota.numero, mono: true },
          { label: "Emisión", valor: fechaDMA(nota.fecha_emision) },
          { label: "Vencimiento", valor: fechaDMA(nota.fecha_vencimiento) },
          { label: "Vendedor", valor: nota.vendedor },
          { label: "Total (sin IVA)", valor: fmtUsd(nota.total_usd) },
          { label: "Abonado", valor: fmtUsd(nota.abonado) },
          { label: "Saldo", valor: fmtUsd(nota.saldo_usd) },
          { label: "Clasificación", valor: `${nota.clasificacion === "incobrable" ? "Incobrable" : "Deuda activa"}${nota.clasificacion_origen === "cliente" ? " (la del cliente)" : ""}` },
          { label: "Pedido de Odoo", valor: nota.pedido_odoo },
          { label: "Origen", valor: nota.origen === "excel" ? `Excel de finanzas${nota.archivo ? ` (${nota.archivo})` : ""}` : "GUDS" },
          { label: "Observación", valor: nota.observacion, ancho: 3 },
        ]} />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel sinPadding titulo={`Abonos y movimientos (${movs.length})`}>
          {movs.length === 0 ? <p className="p-3 text-sm text-muted-foreground">Sin abonos.</p> : (
            <Table data-testid="ne-movimientos">
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Monto</TableHead></TableRow></TableHeader>
              <TableBody>
                {movs.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap py-1.5">{m.fecha ? fechaDMA(m.fecha) : <span className="text-muted-foreground">Sin fecha</span>}</TableCell>
                    <TableCell className="py-1.5">{MOVIMIENTO_NOTA[m.tipo]}{m.nota && <span className="block text-[11px] text-muted-foreground">{m.nota}</span>}</TableCell>
                    <TableCell className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtUsd(m.monto_usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
        <Panel sinPadding titulo={`Líneas (${items.length})`}>
          {items.length === 0 ? <p className="p-3 text-sm text-muted-foreground">{nota.serie === "HIST" ? "Las notas históricas del Excel de finanzas no traen líneas." : "Sin líneas."}</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Descripción</TableHead><TableHead className="text-right">Cant.</TableHead><TableHead className="text-right">Subtotal</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="py-1.5">{l.descripcion}</TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums">{Number(l.cantidad).toLocaleString("es-VE")}</TableCell>
                    <TableCell className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtUsd(l.subtotal_usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>
      <p className="text-xs text-muted-foreground">Documento no fiscal: no está en Odoo ni en el estado de cuenta del cliente; cuenta como deuda interna en la antigüedad y en el detalle de la cuenta.</p>
    </MainLayout>
  );
};

export default NotaEntregaDetalle;
