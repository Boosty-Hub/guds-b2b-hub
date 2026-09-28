import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Link, useNavigate } from "react-router-dom";
import { ShoppingCart, DollarSign, ArrowRight, Loader2 } from "lucide-react";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useResumenVendedor, mesDe } from "@/components/vendedor/resumen";
import { AvisoEmpresaCartera } from "@/components/vendedor/AvisoEmpresaCartera";

const VendedorDashboard = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  // Todas las cifras salen de resumen_vendedor() (misma fuente que Clientes, Pedidos, Pagos y Metas)
  const { resumen: r, cargando, error } = useResumenVendedor();

  return (
    <VendedorLayout title="Dashboard">
      {cargando ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /></div>
      ) : (
        <div>
          <p className="mb-2 text-[13px] text-muted-foreground">Hola, <span className="font-medium text-foreground">{user?.nombre}</span> — resumen de tu cartera y ventas.</p>
          {error && <p className="mb-2 text-[13px] text-destructive">No se pudo cargar el resumen: {error}</p>}
          {r && <AvisoEmpresaCartera clientes={r.clientes} porEmpresa={r.clientes_por_empresa} />}
          {r && (
            <KpiStrip items={[
              { label: "Mis clientes", valor: r.clientes, detalle: `${r.cartera.clientes_con_saldo} con saldo`, tono: "primario", onClick: () => navigate("/vendedor/clientes") },
              { label: "Pedidos activos", valor: r.pedidos.abiertos, detalle: r.pedidos.por_aprobar ? `${r.pedidos.por_aprobar} por aprobar` : undefined,
                tono: r.pedidos.abiertos ? "alerta" : "normal", onClick: () => navigate("/vendedor/pedidos") },
              { label: `Ventas de ${mesDe(r)}`, valor: formatPrice(r.ventas_mes.neto), detalle: `${r.ventas_mes.facturas} facturas · neto de IVA`,
                tono: "positivo", onClick: () => navigate("/vendedor/metas"), titulo: "Facturado a tus clientes en el mes (neto de IVA y de notas de crédito)" },
              { label: "Por cobrar", valor: formatPrice(r.cartera.por_cobrar), detalle: r.cartera.vencido > 0.009 ? `${formatPrice(r.cartera.vencido)} vencido` : "nada vencido",
                tono: r.cartera.por_cobrar > 0.009 ? "negativo" : "normal", onClick: () => navigate("/vendedor/clientes"),
                titulo: r.cartera.a_favor < -0.009 ? `Neto ${formatPrice(r.cartera.neto)} (saldo a favor de clientes: ${formatPrice(Math.abs(r.cartera.a_favor))})` : undefined },
              { label: "Cobros por verificar", valor: r.cobros.pendientes_n, detalle: formatPrice(r.cobros.pendientes_monto),
                tono: r.cobros.pendientes_n ? "alerta" : "normal", onClick: () => navigate("/vendedor/pagos") },
            ]} />
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Link to="/vendedor/pedidos" className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50">
              <span className="flex items-center gap-2.5"><ShoppingCart className="h-4 w-4 text-emerald-500" /><span><span className="block text-[13px] font-medium">Tomar pedido</span><span className="block text-[11px] text-muted-foreground">Crear un pedido para un cliente</span></span></span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link to="/vendedor/pagos" className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50">
              <span className="flex items-center gap-2.5"><DollarSign className="h-4 w-4 text-emerald-500" /><span><span className="block text-[13px] font-medium">Registrar cobro</span><span className="block text-[11px] text-muted-foreground">Reportar un pago recibido</span></span></span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </div>
        </div>
      )}
    </VendedorLayout>
  );
};

export default VendedorDashboard;
