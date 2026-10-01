import { Link } from "react-router-dom";
import { ArrowUpRight, ClipboardCheck, LifeBuoy } from "lucide-react";
import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Guía de verificación cruzada GUDS ↔ Odoo (0.6 del plan de revisión del 30-sep): una página, para que el equipo compare
// las mismas cifras en los dos sistemas y reporte diferencias con el botón Ticket.

interface Control {
  titulo: string;
  guds: { texto: string; ruta: string };
  odoo: string;
  ojo: string;
}

const CONTROLES: Control[] = [
  {
    titulo: "Venta del mes de un cliente",
    guds: { texto: "Reportes → Ventas, fuente Odoo, mes, agrupado por cliente", ruta: "/admin/reportes" },
    odoo: "Facturación → Clientes → Facturas: filtro por cliente y fecha de factura del mes; sumar la base imponible (sin IVA), facturas menos notas de crédito.",
    ojo: "GUDS muestra la venta neta de IVA y no cuenta saldos iniciales ni notas de débito cambiarias.",
  },
  {
    titulo: "Pagos a un proveedor",
    guds: { texto: "Compras → Proveedores → estado de cuenta del proveedor", ruta: "/admin/proveedores" },
    odoo: "Contabilidad → Proveedores → Pagos: filtro por proveedor y rango de fechas; comparar cantidad de pagos y total.",
    ojo: "Compara en la misma moneda (USD o Bs) y con la misma empresa elegida en los dos sistemas.",
  },
  {
    titulo: "Cartera de un vendedor",
    guds: { texto: "Vendedores → vendedor → saldo total (o Cuentas con el filtro de vendedor)", ruta: "/admin/vendedores" },
    odoo: "Facturación → Clientes → Facturas: filtros «Publicado» y «Sin pagar», agrupar por vendedor; sumar el importe adeudado.",
    ojo: "Los empleados (compras de personal) no cuentan como cartera de vendedor en GUDS; las notas de crédito sin cruzar restan.",
  },
  {
    titulo: "Existencia de un almacén",
    guds: { texto: "Inventario → Almacenes → almacén (por producto y lote)", ruta: "/admin/almacenes" },
    odoo: "Inventario → Informes → Existencias: filtro por almacén o ubicación; comparar cantidad a mano por producto.",
    ojo: "GUDS cuenta solo productos almacenables; lo reservado para entregas aparece aparte como comprometido.",
  },
];

const ConfigVerificacionOdoo = () => (
  <ConfiguracionLayout title="Verificación con Odoo" description="Qué comparar entre GUDS y Odoo y cómo reportar una diferencia">
    <div className="max-w-4xl space-y-4">
      <Card>
        <CardContent className="space-y-1.5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium"><ClipboardCheck className="h-4 w-4 text-primary" /> Antes de comparar</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Elige la <span className="font-medium text-foreground">misma empresa</span> en los dos sistemas (menú superior de GUDS y selector de compañía de Odoo).</li>
            <li>GUDS copia Odoo cada 15 minutos (lunes a sábado de 7:00 a 19:45 y una vez de noche). Mira «Odoo hace …» en la barra superior: lo cargado en Odoo después de esa hora todavía no está en GUDS.</li>
            <li>Usa el mismo rango de fechas y la misma moneda.</li>
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {CONTROLES.map((c, i) => (
          <Card key={c.titulo} data-testid="control-verificacion">
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">{i + 1}. {c.titulo}</CardTitle></CardHeader>
            <CardContent className="space-y-2 p-4 pt-0 text-sm">
              <p><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">En GUDS</span><br />
                <Link to={c.guds.ruta} className="inline-flex items-center gap-1 text-primary hover:underline">{c.guds.texto}<ArrowUpRight className="h-3 w-3 shrink-0" /></Link></p>
              <p><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">En Odoo</span><br />{c.odoo}</p>
              <p className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">{c.ojo}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-1.5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium"><LifeBuoy className="h-4 w-4 text-primary" /> Si encuentras una diferencia</p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Espera a la próxima sincronización y vuelve a comparar (descarta que sea un cambio reciente en Odoo).</li>
            <li>Abre un <span className="font-medium text-foreground">Ticket</span> con el botón de soporte de la barra superior, desde la pantalla de GUDS donde ves la cifra.</li>
            <li>Indica: empresa, qué comparaste, cifra en GUDS, cifra en Odoo, fechas y los números de documento (factura, pago, transferencia) que no cuadran. Adjunta una captura de cada sistema.</li>
          </ol>
          <p className="pt-1 text-xs text-muted-foreground">Lo que nace en Odoo se corrige en Odoo: GUDS lo refleja en la siguiente sincronización.</p>
        </CardContent>
      </Card>
    </div>
  </ConfiguracionLayout>
);

export default ConfigVerificacionOdoo;
