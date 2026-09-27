import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { Panel } from "@/components/datos/FichaCampos";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import { TopClients } from "@/components/dashboard/TopClients";
import { Badge } from "@/components/ui/badge";
import { Loader2, ListTodo } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePendingActions } from "@/hooks/use-pending-actions";

interface DashboardStats {
  ordenesHoy: number;
  ordenesAyer: number;
  clientesActivos: number;
  clientesNuevosSemana: number;
  totalProductos: number;
  productosBajoStock: number;
  ventasMes: number;
  ventasMesAnterior: number;
  deudaTotal: number;
  clientesConDeuda: number;
  carteraVendedores: number;
  anticiposSinAplicar: number;
}

const Index = () => {
  const [stats, setStats] = useState<DashboardStats>({
    ordenesHoy: 0,
    ordenesAyer: 0,
    clientesActivos: 0,
    clientesNuevosSemana: 0,
    totalProductos: 0,
    productosBajoStock: 0,
    ventasMes: 0,
    ventasMesAnterior: 0,
    deudaTotal: 0,
    clientesConDeuda: 0,
    carteraVendedores: 0,
    anticiposSinAplicar: 0,
  });
  const [loading, setLoading] = useState(true);
  // Operación: compras, tesorería, despachos y vencimientos
  const [op, setOp] = useState<{ porPagar: number; bancosUsd: number; bancosBs: number; entregasListas: number; lotesVencidos: number; sinDisponible: number } | null>(null);
  useEffect(() => {
    (async () => {
      const hoy = new Date().toISOString().slice(0, 10);
      const [fp, bancos, ent, lot, sd] = await Promise.all([
        supabase.from("facturas_proveedor").select("saldo_usd").eq("estado", "posted"),
        supabase.from("bancos").select("moneda, saldo_odoo, saldo_extracto, cuenta_compartida").eq("activo", true).not("odoo_id", "is", null),
        supabase.from("transferencias").select("id", { count: "exact", head: true }).eq("tipo", "entrega").eq("estado", "lista"),
        supabase.from("lotes").select("id", { count: "exact", head: true }).gt("cantidad", 0).lt("vencimiento", hoy),
        supabase.from("productos").select("id", { count: "exact", head: true }).eq("activo", true).eq("controla_stock", true).eq("stock_disponible", 0).gt("comprometido_odoo", 0),
      ]);
      const saldo = (b: { saldo_odoo: number | null; saldo_extracto: number | null; cuenta_compartida: boolean }) => Number((b.cuenta_compartida ? b.saldo_extracto : b.saldo_odoo) ?? 0);
      const bs = (bancos.data as { moneda: string; saldo_odoo: number | null; saldo_extracto: number | null; cuenta_compartida: boolean }[] | null) ?? [];
      setOp({
        porPagar: ((fp.data as { saldo_usd: number }[] | null) ?? []).reduce((a, f) => a + Number(f.saldo_usd || 0), 0),
        bancosUsd: bs.filter((b) => b.moneda === "USD").reduce((a, b) => a + saldo(b), 0),
        bancosBs: bs.filter((b) => b.moneda !== "USD").reduce((a, b) => a + saldo(b), 0),
        entregasListas: ent.count ?? 0, lotesVencidos: lot.count ?? 0, sinDisponible: sd.count ?? 0,
      });
    })();
  }, []);
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const { items: pendientes, total: totalPendientes, loading: loadingPendientes } = usePendingActions();

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const startOfYesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString();
    const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7).toISOString();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
    const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString();
    const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0).toISOString();

    const [
      ordenesHoyRes,
      ordenesAyerRes,
      clientesRes,
      clientesNuevosRes,
      productosRes,
      bajoStockRes,
      ventasMesRes,
      ventasMesAnteriorRes,
      facturasRes,
      clientesVendedorRes,
      anticiposRes,
    ] = await Promise.all([
      // Órdenes de hoy
      supabase.from('ordenes').select('id', { count: 'exact' }).gte('created_at', startOfToday),
      // Órdenes de ayer
      supabase.from('ordenes').select('id', { count: 'exact' }).gte('created_at', startOfYesterday).lt('created_at', startOfToday),
      // Clientes activos
      supabase.from('clientes').select('id', { count: 'exact' }).eq('activo', true),
      // Clientes nuevos esta semana
      supabase.from('clientes').select('id', { count: 'exact' }).gte('created_at', startOfWeek),
      // Total productos
      supabase.from('productos').select('id', { count: 'exact' }).eq('activo', true),
      // Productos bajo stock
      supabase.from('productos').select('id', { count: 'exact', head: true }).lt('stock_actual', 10).eq('activo', true).eq('controla_stock', true),
      // Ventas del mes
      supabase.from('ordenes').select('total').gte('created_at', startOfMonth),
      // Ventas mes anterior
      supabase.from('ordenes').select('total').gte('created_at', startOfLastMonth).lt('created_at', startOfMonth),
      // Deuda real (Fase 11): suma de facturas.saldo_usd, igual que Cuentas.tsx
      supabase.from('facturas').select('cliente_id, saldo_usd').eq('estado', 'posted'),
      // Cartera gestionada por vendedores (Fase 14): clientes con vendedor asignado
      supabase.from('clientes').select('id').eq('activo', true).not('vendedor_asignado_id', 'is', null),
      // Anticipos sin aplicar (Fase 11), igual que CuentasPorCobrar.tsx
      supabase.from('v_anticipos').select('disponible'),
    ]);

    const ventasMes = ventasMesRes.data?.reduce((sum, o) => sum + (o.total || 0), 0) || 0;
    const ventasMesAnterior = ventasMesAnteriorRes.data?.reduce((sum, o) => sum + (o.total || 0), 0) || 0;

    const saldoPorCliente = new Map<string, number>();
    for (const f of (facturasRes.data as { cliente_id: string; saldo_usd: number }[]) ?? []) {
      saldoPorCliente.set(f.cliente_id, (saldoPorCliente.get(f.cliente_id) || 0) + Number(f.saldo_usd));
    }
    const deudaTotal = [...saldoPorCliente.values()].reduce((s, v) => s + v, 0);
    const clientesConDeuda = [...saldoPorCliente.values()].filter((v) => v > 0.009).length;

    const idsConVendedor = new Set((clientesVendedorRes.data as { id: string }[] ?? []).map((c) => c.id));
    const carteraVendedores = [...saldoPorCliente.entries()].filter(([id]) => idsConVendedor.has(id)).reduce((s, [, v]) => s + v, 0);

    const anticiposSinAplicar = ((anticiposRes.data as { disponible: number }[] ?? [])).reduce((s, a) => s + Number(a.disponible), 0);

    setStats({
      ordenesHoy: ordenesHoyRes.count || 0,
      ordenesAyer: ordenesAyerRes.count || 0,
      clientesActivos: clientesRes.count || 0,
      clientesNuevosSemana: clientesNuevosRes.count || 0,
      totalProductos: productosRes.count || 0,
      productosBajoStock: bajoStockRes.count || 0,
      ventasMes,
      ventasMesAnterior,
      deudaTotal,
      clientesConDeuda,
      carteraVendedores,
      anticiposSinAplicar,
    });
    setLoading(false);
  };

  const getOrdenesChange = () => {
    if (stats.ordenesAyer === 0) return { text: "Sin datos de ayer", type: "neutral" as const };
    const change = ((stats.ordenesHoy - stats.ordenesAyer) / stats.ordenesAyer * 100).toFixed(0);
    return {
      text: `${Number(change) >= 0 ? '+' : ''}${change}% vs ayer`,
      type: Number(change) >= 0 ? "positive" as const : "negative" as const,
    };
  };

  const getVentasChange = () => {
    if (stats.ventasMesAnterior === 0) return { text: "Sin datos previos", type: "neutral" as const };
    const change = ((stats.ventasMes - stats.ventasMesAnterior) / stats.ventasMesAnterior * 100).toFixed(1);
    return {
      text: `${Number(change) >= 0 ? '+' : ''}${change}% vs mes anterior`,
      type: Number(change) >= 0 ? "positive" as const : "negative" as const,
    };
  };

  if (loading) {
    return (
      <MainLayout title="Dashboard">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Dashboard">
      <KpiStrip items={[
        { label: "Órdenes hoy", valor: stats.ordenesHoy, detalle: getOrdenesChange().text, tono: getOrdenesChange().type === "negative" ? "negativo" : "normal", onClick: () => navigate("/admin/ordenes") },
        { label: "Pedidos del mes", valor: formatPrice(stats.ventasMes), detalle: getVentasChange().text, tono: getVentasChange().type === "negative" ? "negativo" : "positivo", onClick: () => navigate("/admin/reportes"), titulo: "Total de pedidos (órdenes) del mes. La venta facturada neta de IVA está en Reportes" },
        { label: "Por cobrar", valor: formatPrice(stats.deudaTotal), detalle: `${stats.clientesConDeuda} clientes con deuda`, tono: "negativo", onClick: () => navigate("/admin/cuentas-por-cobrar") },
        { label: "Cartera de vendedores", valor: formatPrice(stats.carteraVendedores), onClick: () => navigate("/admin/vendedores") },
        { label: "Anticipos sin aplicar", valor: formatPrice(stats.anticiposSinAplicar), onClick: () => navigate("/admin/cuentas-por-cobrar") },
        { label: "Clientes activos", valor: stats.clientesActivos, detalle: `+${stats.clientesNuevosSemana} esta semana`, onClick: () => navigate("/admin/clientes") },
        { label: "Productos", valor: stats.totalProductos, detalle: `${stats.productosBajoStock} con poco stock`, tono: stats.productosBajoStock > 0 ? "alerta" : "normal", onClick: () => navigate("/admin/inventario") },
      ]} />
      {op && (
        <KpiStrip items={[
          { label: "Por pagar a proveedores", valor: formatPrice(op.porPagar), tono: "negativo", onClick: () => navigate("/admin/cuentas-por-pagar") },
          { label: "Bancos en dólares", valor: formatPrice(op.bancosUsd), tono: "positivo", onClick: () => navigate("/admin/bancos") },
          { label: "Bancos en bolívares", valor: `Bs. ${op.bancosBs.toLocaleString("es-VE", { maximumFractionDigits: 0 })}`, onClick: () => navigate("/admin/bancos") },
          { label: "Entregas listas", valor: op.entregasListas, detalle: "para despachar en Odoo", tono: op.entregasListas > 0 ? "primario" : "normal", onClick: () => navigate("/admin/transferencias?tipo=entrega&estado=lista") },
          { label: "Sin disponible", valor: op.sinDisponible, detalle: "productos comprometidos", tono: op.sinDisponible > 0 ? "alerta" : "normal", onClick: () => navigate("/admin/inventario") },
          { label: "Lotes vencidos", valor: op.lotesVencidos, detalle: "con existencia", tono: op.lotesVencidos > 0 ? "negativo" : "normal", onClick: () => navigate("/admin/inventario?tab=lotes&lotes=vencidos") },
        ]} />
      )}

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2"><RecentOrders /></div>
        <div className="min-w-0">
        <TopClients />
        <Panel titulo={<><ListTodo className="h-4 w-4 text-primary" /> Acciones pendientes {totalPendientes > 0 && <Badge variant="destructive">{totalPendientes}</Badge>}</>} sinPadding>
          {loadingPendientes ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : totalPendientes === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Todo al día — nada pendiente por revisar.</p>
          ) : (
            <div className="divide-y divide-border">
              {pendientes.filter((p) => p.count > 0).map((p) => (
                <button key={p.clave} onClick={() => navigate(p.link)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-muted/50">
                  <p.icono className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{p.label}</span>
                  <Badge variant="secondary">{p.count}</Badge>
                </button>
              ))}
            </div>
          )}
        </Panel>
        </div>
      </div>
    </MainLayout>
  );
};

export default Index;
