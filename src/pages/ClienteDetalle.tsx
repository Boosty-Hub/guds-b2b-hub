import { useEffect, useState, type ReactNode } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  ArrowLeft, Loader2, Building2, User, Phone, MapPin,
  CreditCard, FileText, Calendar, Edit, Users, IdCard, ShoppingCart, Boxes,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { supabase, Cliente, ListaPrecios } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";

interface ClienteFull extends Cliente {
  lista_precios?: ListaPrecios | null;
}

interface OrdenResumen {
  id: string;
  numero: string;
  estado: string;
  total: number;
  created_at: string;
  fecha_pedido: string | null;
  items?: { count: number }[];
}

interface ConsigRow {
  almacen: string;
  producto: string;
  sku: string;
  cantidad: number;
}

const ESTADO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  confirmado: { label: "Confirmado", variant: "default" },
  procesando: { label: "Procesando", variant: "default" },
  enviado: { label: "Enviado", variant: "outline" },
  completado: { label: "Completado", variant: "default" },
  cancelado: { label: "Cancelado", variant: "destructive" },
};

/** Un campo etiqueta/valor. Muestra "—" si no hay dato. */
function Campo({ label, children, mono }: { label: string; children?: ReactNode; mono?: boolean }) {
  const vacio = children === null || children === undefined || children === "" || children === false;
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 break-words font-medium ${mono ? "font-mono text-sm" : ""}`}>
        {vacio ? <span className="font-normal text-muted-foreground">—</span> : children}
      </p>
    </div>
  );
}

function Seccion({ icon: Icon, titulo, children }: { icon: typeof User; titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="rounded-lg bg-primary/10 p-1.5">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h2 className="font-semibold">{titulo}</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

const ClienteDetalle = () => {
  const { clienteId } = useParams();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [cliente, setCliente] = useState<ClienteFull | null>(null);
  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [consignacion, setConsignacion] = useState<ConsigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const ordenesPag = usePagination(ordenes, 10);
  const consigPag = usePagination(consignacion, 10);

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      const [{ data }, { data: ords }, { data: alms }] = await Promise.all([
        supabase.from("clientes").select("*, lista_precios:listas_precios(*)").eq("id", clienteId).maybeSingle(),
        supabase.from("ordenes")
          .select("id, numero, estado, total, created_at, fecha_pedido, items:orden_items(count)")
          .eq("cliente_id", clienteId)
          .order("created_at", { ascending: false }),
        supabase.from("almacenes")
          .select("nombre, inventario_almacen(cantidad, producto:productos(nombre, sku))")
          .eq("cliente_id", clienteId)
          .eq("tipo", "consignacion"),
      ]);
      if (activo) {
        setCliente((data as ClienteFull) ?? null);
        setOrdenes((ords as OrdenResumen[]) ?? []);
        const rows: ConsigRow[] = ((alms as { nombre: string; inventario_almacen?: { cantidad: number; producto?: { nombre: string; sku: string } | null }[] }[]) ?? [])
          .flatMap((a) => (a.inventario_almacen ?? []).map((r) => ({
            almacen: a.nombre,
            producto: r.producto?.nombre ?? "Producto",
            sku: r.producto?.sku ?? "",
            cantidad: Number(r.cantidad || 0),
          })))
          .sort((x, y) => y.cantidad - x.cantidad);
        setConsignacion(rows);
        setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [clienteId]);

  const totalConsignado = consignacion.reduce((s, r) => s + r.cantidad, 0);

  const totalFacturado = ordenes.reduce((s, o) => s + Number(o.total || 0), 0);

  const fmtFecha = (d?: string | null) =>
    d ? new Date(d).toLocaleDateString("es-VE", { day: "2-digit", month: "long", year: "numeric" }) : null;

  const volver = (
    <Button variant="ghost" className="mb-4 gap-2" onClick={() => navigate("/admin/clientes")}>
      <ArrowLeft className="h-4 w-4" /> Volver a clientes
    </Button>
  );

  if (loading) {
    return (
      <MainLayout title="Cliente">
        {volver}
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  if (!cliente) {
    return (
      <MainLayout title="Cliente">
        {volver}
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Building2 className="mb-4 h-12 w-12 opacity-50" />
          <p>Cliente no encontrado</p>
        </div>
      </MainLayout>
    );
  }

  const iniciales = cliente.nombre_negocio.split(" ").map((w) => w[0]).join("").slice(0, 2);

  return (
    <MainLayout title={cliente.nombre_negocio}>
      {volver}

      {/* Encabezado */}
      <div className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="bg-primary/10 text-lg text-primary">{iniciales}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{cliente.nombre_negocio}</h1>
            <p className="font-mono text-sm text-muted-foreground">{cliente.codigo}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant={cliente.activo ? "default" : "secondary"}>{cliente.activo ? "Activo" : "Inactivo"}</Badge>
              {cliente.tipo_negocio && <Badge variant="outline">{cliente.tipo_negocio}</Badge>}
              {cliente.es_empresa != null && (
                <Badge variant="outline">{cliente.es_empresa ? "Empresa" : "Persona natural"}</Badge>
              )}
              {cliente.contribuyente_especial && <Badge variant="outline">Contribuyente especial</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/admin/clientes/${cliente.id}/usuarios`}>
            <Button variant="outline" className="gap-2"><Users className="h-4 w-4" /> Usuarios del portal</Button>
          </Link>
          <Link to="/admin/clientes">
            <Button variant="outline" className="gap-2"><Edit className="h-4 w-4" /> Editar</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Seccion icon={IdCard} titulo="Identificación">
          <Campo label="Código" mono>{cliente.codigo}</Campo>
          <Campo label="RIF" mono>{cliente.rif}</Campo>
          <Campo label="Cédula" mono>{cliente.cedula}</Campo>
          <Campo label="Tipo de negocio">{cliente.tipo_negocio}</Campo>
          <Campo label="Tipo de residencia">{cliente.tipo_residencia}</Campo>
          <Campo label="Persona / Empresa">{cliente.es_empresa == null ? null : cliente.es_empresa ? "Empresa" : "Persona natural"}</Campo>
        </Seccion>

        <Seccion icon={Phone} titulo="Contacto">
          <Campo label="Email">{cliente.email}</Campo>
          <Campo label="Teléfono">{cliente.telefono}</Campo>
          <Campo label="Celular">{cliente.celular}</Campo>
          <Campo label="Sitio web">
            {cliente.sitio_web ? (
              <a href={cliente.sitio_web} target="_blank" rel="noreferrer" className="text-primary underline">{cliente.sitio_web}</a>
            ) : null}
          </Campo>
        </Seccion>

        <Seccion icon={MapPin} titulo="Ubicación">
          <Campo label="Dirección">{cliente.direccion}</Campo>
          <Campo label="Dirección de entrega">{cliente.direccion_entrega}</Campo>
          <Campo label="Ciudad">{cliente.ciudad}</Campo>
          <Campo label="Estado">{cliente.estado}</Campo>
          {(cliente.latitud != null || cliente.longitud != null) && (
            <Campo label="Coordenadas" mono>{cliente.latitud}, {cliente.longitud}</Campo>
          )}
        </Seccion>

        <Seccion icon={CreditCard} titulo="Comercial">
          <Campo label="Lista de precios">{cliente.lista_precios?.nombre}</Campo>
          <Campo label="Vendedor asignado">{cliente.vendedor_odoo}</Campo>
          <Campo label="Límite de crédito">{cliente.limite_credito ? formatPrice(cliente.limite_credito) : null}</Campo>
          <Campo label="Crédito utilizado">{cliente.credito_utilizado ? formatPrice(cliente.credito_utilizado) : null}</Campo>
          <Campo label="Días de crédito">{cliente.dias_credito != null ? `${cliente.dias_credito} días` : null}</Campo>
          <Campo label="Condición de pago">{cliente.condicion_pago}</Campo>
        </Seccion>

        <Seccion icon={FileText} titulo="Fiscal y notas">
          <Campo label="Licencia de actividad">{cliente.licencia_actividad}</Campo>
          <Campo label="Contribuyente especial">{cliente.contribuyente_especial ? "Sí" : "No"}</Campo>
          <div className="sm:col-span-2">
            <Campo label="Notas">{cliente.notas}</Campo>
          </div>
        </Seccion>

        <Seccion icon={Calendar} titulo="Trazabilidad">
          <Campo label="ID Odoo" mono>{cliente.odoo_id}</Campo>
          <Campo label="Registrado en Odoo">{fmtFecha(cliente.fecha_registro_odoo)}</Campo>
          <Campo label="Creado en el sistema">{fmtFecha(cliente.created_at)}</Campo>
        </Seccion>
      </div>

      {/* Órdenes del cliente */}
      <div className="mt-6 rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary/10 p-1.5">
              <ShoppingCart className="h-4 w-4 text-primary" />
            </div>
            <h2 className="font-semibold">Órdenes ({ordenes.length})</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Total facturado: <span className="font-semibold text-foreground">{formatPrice(totalFacturado)}</span>
          </p>
        </div>
        {ordenes.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">Este cliente no tiene órdenes.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Orden</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-center">Ítems</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordenesPag.pageItems.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium text-primary">{o.numero}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtFecha(o.fecha_pedido || o.created_at)}</TableCell>
                    <TableCell className="text-center">{o.items?.[0]?.count ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={ESTADO[o.estado]?.variant ?? "secondary"}>
                        {ESTADO[o.estado]?.label ?? o.estado}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{formatPrice(o.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={ordenesPag} />
          </>
        )}
      </div>

      {/* Consignación del cliente */}
      {consignacion.length > 0 && (
        <div className="mt-6 rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-primary/10 p-1.5">
                <Boxes className="h-4 w-4 text-primary" />
              </div>
              <h2 className="font-semibold">Consignación ({consignacion.length} productos)</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Total consignado: <span className="font-semibold text-foreground">{totalConsignado.toLocaleString("es-VE")} uds</span>
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Almacén</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {consigPag.pageItems.map((r, i) => (
                <TableRow key={r.sku + i}>
                  <TableCell className="font-mono text-sm text-primary">{r.sku || "—"}</TableCell>
                  <TableCell className="font-medium">{r.producto}</TableCell>
                  <TableCell className="text-muted-foreground">{r.almacen}</TableCell>
                  <TableCell className="text-right font-semibold">{r.cantidad.toLocaleString("es-VE")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DataTablePagination pagination={consigPag} />
        </div>
      )}
    </MainLayout>
  );
};

export default ClienteDetalle;
