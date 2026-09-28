import { useEffect, useState } from "react";
import { Eye, Receipt } from "lucide-react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { EstadoVacio, Panel, PillTono, SkeletonFilas, fechaCorta, type Tono } from "@/components/portal/sistema";
import { NavFinanzas } from "@/components/portal/finanzas";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { DeclararRetencionForm } from "@/components/retenciones/DeclararRetencionForm";
import type { FacturaSaldo } from "@/components/cuentas/SelectorFacturas";

// Retenciones del cliente (F6): el historial completo (las registradas en Odoo y las declaradas en el portal, con su
// origen) y el formulario para declarar una nueva. Se puede declarar si la ficha lo marca como agente de retención o si ya
// tiene retenciones registradas (hay clientes que retienen sin la bandera en la ficha).

interface ClienteFlags { retiene_iva: boolean; retiene_islr: boolean; }
interface Retencion {
  id: string; numero: string; numero_comprobante: string | null; tipo: string; estado: string; fecha: string; total: number;
  comprobante_url: string | null; odoo_id: number | null; notas: string | null;
}

const TIPO: Record<string, string> = { iva: "IVA", islr: "ISLR", municipal: "Municipal" };
const POR_PAGINA = 25;

const estadoDe = (r: Retencion): { label: string; tono: Tono } => {
  if (r.estado === "aprobado") return { label: r.odoo_id ? "Registrada" : "Aprobada", tono: "ok" };
  if (r.estado === "rechazado") return r.odoo_id ? { label: "Anulada", tono: "neutro" } : { label: "Rechazada", tono: "riesgo" };
  return { label: r.odoo_id ? "En proceso" : "Por revisar", tono: "pendiente" };
};

const PortalRetenciones = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [flags, setFlags] = useState<ClienteFlags | null>(null);
  const [facturas, setFacturas] = useState<FacturaSaldo[]>([]);
  const [retenciones, setRetenciones] = useState<Retencion[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibles, setVisibles] = useState(POR_PAGINA);

  const cargar = async () => {
    const cid = user?.cliente_id;
    if (!cid) return;
    const [{ data: cli }, { data: facs }, { data: rets }] = await Promise.all([
      supabase.from("clientes").select("retiene_iva, retiene_islr").eq("id", cid).maybeSingle(),
      supabase.from("facturas").select("id, numero, fecha_emision, saldo_usd")
        .eq("cliente_id", cid).eq("tipo", "factura").eq("estado", "posted").gt("saldo_usd", 0.009)
        .order("fecha_emision", { ascending: true }),
      // Historial completo: Odoo y portal
      supabase.from("retenciones").select("id, numero, numero_comprobante, tipo, estado, fecha, total, comprobante_url, odoo_id, notas")
        .eq("cliente_id", cid).order("fecha", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    setFlags((cli as ClienteFlags) ?? null);
    setFacturas(((facs as { id: string; numero: string; fecha_emision: string | null; saldo_usd: number }[]) ?? [])
      .map((f) => ({ id: f.id, numero: f.numero, fecha_emision: f.fecha_emision, saldo_usd: Number(f.saldo_usd) })));
    setRetenciones(((rets as Retencion[]) ?? []).map((r) => ({ ...r, total: Number(r.total) })));
    setLoading(false);
  };

  useEffect(() => { cargar(); }, [user?.cliente_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const verComprobante = async (path: string) => {
    const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 120);
    if (error || !data?.signedUrl) { toast({ title: "No se pudo abrir el comprobante", variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const conHistorial = retenciones.some((r) => r.estado === "aprobado");
  const puedeDeclarar = !!(flags?.retiene_iva || flags?.retiene_islr || conHistorial);
  const enPantalla = retenciones.slice(0, visibles);

  const historial = (
    <Panel titulo="Mis retenciones" descripcion={retenciones.length ? `${retenciones.length} ${retenciones.length === 1 ? "comprobante" : "comprobantes"} · registradas en Odoo y declaradas en el portal` : undefined}
      cuerpoClassName="p-0 sm:p-0">
      {retenciones.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Todavía no hay retenciones registradas.</p>
      ) : (
        <>
          {/* Escritorio y tableta */}
          <table className="hidden w-full text-sm md:table" data-testid="retenciones-tabla">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Comprobante</th>
                <th className="px-3 py-2.5 font-medium">Tipo</th>
                <th className="px-3 py-2.5 font-medium">Fecha</th>
                <th className="px-3 py-2.5 text-right font-medium">Monto</th>
                <th className="px-3 py-2.5 font-medium">Estado</th>
                <th className="w-px px-4 py-2.5"><span className="sr-only">Comprobante</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {enPantalla.map((r) => {
                const e = estadoDe(r);
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5">
                      <span className="block font-medium tabular-nums">{r.numero_comprobante || r.numero}</span>
                      <span className="block text-xs text-muted-foreground">{r.odoo_id ? "Registrada en Odoo" : "Declarada en el portal"}</span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{TIPO[r.tipo] ?? r.tipo}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">{fechaCorta(r.fecha)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">{formatPrice(r.total)}</td>
                    <td className="px-3 py-2.5"><PillTono tono={e.tono}>{e.label}</PillTono></td>
                    <td className="px-4 py-2.5 text-right">
                      {r.comprobante_url && (
                        <Button variant="ghost" size="icon" onClick={() => verComprobante(r.comprobante_url!)} aria-label={`Ver comprobante de ${r.numero}`}><Eye className="h-4 w-4" /></Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Móvil */}
          <ul className="divide-y divide-border md:hidden" data-testid="retenciones-lista">
            {enPantalla.map((r) => {
              const e = estadoDe(r);
              return (
                <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium tabular-nums">{TIPO[r.tipo] ?? r.tipo} · {r.numero_comprobante || r.numero}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{fechaCorta(r.fecha)} · {r.odoo_id ? "Odoo" : "Portal"}</p>
                    {r.estado === "rechazado" && !r.odoo_id && r.notas && <p className="mt-1 text-xs text-destructive">Motivo: {r.notas}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="text-sm font-semibold tabular-nums">{formatPrice(r.total)}</span>
                    <PillTono tono={e.tono}>{e.label}</PillTono>
                    {r.comprobante_url && (
                      <button type="button" onClick={() => verComprobante(r.comprobante_url!)} className="text-xs font-medium text-primary hover:underline">Ver comprobante</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {retenciones.length > visibles && (
            <div className="border-t border-border px-4 py-3 text-center">
              <Button variant="outline" onClick={() => setVisibles((v) => v + POR_PAGINA)}>Ver más ({retenciones.length - visibles})</Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );

  return (
    <PortalPagina titulo="Retenciones" descripcion="Tus comprobantes de retención de IVA e ISLR y la declaración de nuevos.">
      <NavFinanzas />
      {loading ? (
        <SkeletonFilas n={2} alto="h-48" />
      ) : !puedeDeclarar ? (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card">
            <EstadoVacio icono={Receipt} titulo="Tu ficha no está marcada como agente de retención"
              descripcion="Si tu empresa es agente de retención, pide a tu ejecutivo de cuenta que lo actualice en tu ficha para declarar desde aquí." />
          </div>
          {retenciones.length > 0 && historial}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
          <Panel titulo="Declarar retención" descripcion="Adjunta el comprobante y elige las facturas afectadas.">
            {facturas.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No tienes facturas con saldo pendiente sobre las cuales declarar una retención.</p>
            ) : (
              <DeclararRetencionForm clienteId={user!.cliente_id!} facturas={facturas} onDeclarado={cargar} />
            )}
          </Panel>
          {historial}
        </div>
      )}
    </PortalPagina>
  );
};

export default PortalRetenciones;
