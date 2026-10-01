import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  ArrowLeft, Loader2, Building2, User, Phone, MapPin,
  CreditCard, FileText, Calendar, Edit, Users, IdCard, ShoppingCart, Boxes, Pencil, Plus, History,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { supabase, Cliente, ListaPrecios } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { OdooBadge } from "@/components/OdooBadge";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { FichaCampos, Panel } from "@/components/datos/FichaCampos";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { EditarContactoClienteDialog } from "@/components/clientes/EditarContactoClienteDialog";
import { DireccionClienteDialog, type DireccionEntrega } from "@/components/clientes/DireccionClienteDialog";
import { HistorialOdooCliente } from "@/components/clientes/HistorialOdooCliente";
import { EstadoOdooCliente, EstadoOdooContacto, type EstadoOdoo } from "@/components/clientes/EstadoOdooCliente";
import { BotonUbicacionesCliente } from "@/components/delivery/UbicacionesClienteDialog";
import { ContactosEntidad } from "@/components/contactos/ContactosEntidad";
import { EmpresasPortalCliente } from "@/components/contactos/EmpresasPortalCliente";
import { UsuariosPortalSinContacto } from "@/components/contactos/UsuariosPortalSinContacto";

interface ClienteFull extends Cliente {
  lista_precios?: ListaPrecios | null;
  limite_credito_pendiente?: boolean;
}
interface ContactoResumen { id: string; nombre: string; cargo: string | null; email: string | null; es_principal: boolean }

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

const consultaCliente = (id?: string) => supabase.from("clientes").select("*, lista_precios:listas_precios(*)").eq("id", id).maybeSingle();
// Contactos del cliente (20v): la lista y su gestión viven en ContactosEntidad; aquí solo los conteos de la cabecera
const consultaContactos = (id?: string) => supabase.from("cliente_contactos").select("id, nombre, cargo, email, es_principal").eq("cliente_id", id)
  .order("es_principal", { ascending: false }).order("nombre");
const consultaAccesos = (id?: string) => supabase.from("usuarios").select("contacto_id, activo").eq("cliente_id", id).eq("role", "cliente");
const consultaDirecciones = (id?: string) => supabase.from("cliente_direcciones")
  .select("id, odoo_id, nombre, direccion, calle, complemento, ciudad, estado, telefono, activo")
  .eq("cliente_id", id)
  .order("nombre");

const ClienteDetalle = () => {
  const { clienteId } = useParams();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [cliente, setCliente] = useState<ClienteFull | null>(null);
  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [consignacion, setConsignacion] = useState<ConsigRow[]>([]);
  const [direcciones, setDirecciones] = useState<(DireccionEntrega & { activo: boolean })[]>([]);
  const [contactos, setContactos] = useState<ContactoResumen[]>([]);
  const [accesos, setAccesos] = useState<{ contacto_id: string | null; activo: boolean }[]>([]);
  const [credito, setCredito] = useState<{ modo: string; disponible: number; en_pedidos: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const ordenesPag = usePagination(ordenes, 10);
  const consigPag = usePagination(consignacion, 10);
  // Teléfonos y direcciones se editan aquí y se escriben en Odoo (19w): solo personal de administración
  const { user } = useAuth();
  const { can } = usePermissions();
  const puedeEditarOdoo = user?.role === "admin" && can("clientes", "editar");
  // Estado del cliente en Odoo (alta, contactos y límite, 20s): personal de administración; crear/enlazar exige clientes:crear
  const puedeVerOdoo = user?.role === "admin" && can("clientes", "ver");
  const puedeCrearOdoo = user?.role === "admin" && can("clientes", "crear");
  const [estadoOdoo, setEstadoOdoo] = useState<EstadoOdoo | null>(null);
  const [contactoAbierto, setContactoAbierto] = useState(false);
  const [dirDialogo, setDirDialogo] = useState<{ abierto: boolean; direccion: DireccionEntrega | null }>({ abierto: false, direccion: null });
  const [versionOdoo, setVersionOdoo] = useState(0);
  // Pestaña en la URL (?tab=contactos: la usa el enlace viejo de "Contactos y portal")
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "ordenes";
  const setTab = (v: string) => setParams((p) => { const n = new URLSearchParams(p); if (v === "ordenes") n.delete("tab"); else n.set("tab", v); return n; }, { replace: true });
  const recargarContactos = useCallback(async () => {
    const [{ data: kts }, { data: accs }] = await Promise.all([consultaContactos(clienteId), consultaAccesos(clienteId)]);
    setContactos((kts as ContactoResumen[]) ?? []);
    setAccesos((accs as { contacto_id: string | null; activo: boolean }[]) ?? []);
    setVersionOdoo((v) => v + 1);
  }, [clienteId]);

  // Después de un envío a Odoo: la ficha y las direcciones ya quedaron con lo que aceptó Odoo
  const recargarOdoo = async () => {
    const [{ data }, { data: dirs }] = await Promise.all([consultaCliente(clienteId), consultaDirecciones(clienteId)]);
    if (data) setCliente(data as ClienteFull);
    setDirecciones(dirs ?? []);
    setVersionOdoo((v) => v + 1);
  };

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      const [{ data }, { data: ords }, { data: alms }, { data: dirs }, { data: kts }, { data: accs }, { data: cred }] = await Promise.all([
        consultaCliente(clienteId),
        supabase.from("ordenes")
          .select("id, numero, estado, total, created_at, fecha_pedido, items:orden_items(count)")
          .eq("cliente_id", clienteId)
          .order("created_at", { ascending: false }),
        supabase.from("almacenes")
          .select("nombre, inventario_almacen(cantidad, producto:productos(nombre, sku))")
          .eq("cliente_id", clienteId)
          .eq("tipo", "consignacion"),
        consultaDirecciones(clienteId),
        consultaContactos(clienteId),
        consultaAccesos(clienteId),
        supabase.rpc("credito_disponible", { p_cliente_id: clienteId }),
      ]);
      if (activo) {
        setCliente((data as ClienteFull) ?? null);
        setOrdenes((ords as OrdenResumen[]) ?? []);
        const rows: ConsigRow[] = ((alms as unknown as { nombre: string; inventario_almacen?: { cantidad: number; producto?: { nombre: string; sku: string } | null }[] }[]) ?? [])
          .flatMap((a) => (a.inventario_almacen ?? []).map((r) => ({
            almacen: a.nombre,
            producto: r.producto?.nombre ?? "Producto",
            sku: r.producto?.sku ?? "",
            cantidad: Number(r.cantidad || 0),
          })))
          .sort((x, y) => y.cantidad - x.cantidad);
        setConsignacion(rows);
        setDirecciones(dirs ?? []);
        setContactos((kts as ContactoResumen[]) ?? []);
        setAccesos((accs as { contacto_id: string | null; activo: boolean }[]) ?? []);
        setCredito((cred as { modo: string; disponible: number; en_pedidos: number }[] | null)?.[0] ?? null);
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
    <Button variant="ghost" size="sm" className="mb-2 h-7 gap-1.5 px-2 text-xs" onClick={() => navigate("/admin/clientes")}>
      <ArrowLeft className="h-3.5 w-3.5" /> Clientes
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

  const odoo = !!cliente.odoo_id;
  const fechaCorta = (d?: string | null) => (d ? new Date(d).toLocaleDateString("es-VE") : "—");

  return (
    <MainLayout title={cliente.nombre_negocio}>
      {volver}

      {/* Cabecera compacta del documento */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Building2 className="h-4 w-4 shrink-0 text-primary" />
          <h1 className="truncate text-base font-semibold" title={cliente.nombre_negocio}>{cliente.nombre_negocio}</h1>
          {odoo && <OdooBadge />}
          <span className="font-mono text-xs text-muted-foreground">{cliente.codigo}{cliente.rif ? ` · ${cliente.rif}` : ""}</span>
          <Badge variant={cliente.activo ? "default" : "secondary"}>{cliente.activo ? "Activo" : "Inactivo"}</Badge>
          {/* Tipo de persona una sola vez: tipo_negocio de Odoo repite "Empresa"/"Persona Natural" de es_empresa */}
          {(() => {
            const tipoPersona = cliente.es_empresa != null ? (cliente.es_empresa ? "Empresa" : "Persona natural") : null;
            const otro = cliente.tipo_negocio && cliente.tipo_negocio.trim().toLowerCase() !== tipoPersona?.toLowerCase() ? cliente.tipo_negocio : null;
            return <>
              {tipoPersona && <Badge variant="outline">{tipoPersona}</Badge>}
              {otro && <Badge variant="outline">{otro}</Badge>}
            </>;
          })()}
          {(cliente as { es_empleado?: boolean }).es_empleado && (
            <Badge variant="outline" title="Compras de personal: no cuenta como cartera de vendedor ni como cliente sin vendedor">Empleado</Badge>
          )}
          {cliente.contribuyente_especial && <Badge variant="outline">Contribuyente especial</Badge>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link to={`/admin/cuentas/${cliente.id}`}><Button size="sm" variant="outline" className="h-8 gap-1.5"><CreditCard className="h-3.5 w-3.5" /> Estado de cuenta</Button></Link>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setTab("contactos")}><Users className="h-3.5 w-3.5" /> Contactos y portal</Button>
          <Link to="/admin/clientes"><Button size="sm" variant="outline" className="h-8 gap-1.5"><Edit className="h-3.5 w-3.5" /> Editar</Button></Link>
        </div>
      </div>

      <KpiStrip items={[
        { label: "Órdenes", valor: ordenes.length.toLocaleString("es-VE") },
        { label: "Total órdenes", valor: formatPrice(totalFacturado) },
        { label: "Por cobrar", valor: formatPrice(Number(cliente.credito_utilizado || 0)), tono: Number(cliente.credito_utilizado) > 0 ? "negativo" : "normal" },
        { label: "Límite de crédito", valor: cliente.limite_credito ? formatPrice(cliente.limite_credito) : "—", detalle: cliente.limite_credito_pendiente ? "Pendiente de enviar a Odoo" : undefined, tono: cliente.limite_credito_pendiente ? "alerta" : "normal" },
        { label: "Crédito disponible", valor: credito ? (credito.modo === "abierto" ? "Abierto" : formatPrice(Number(credito.disponible))) : "—", tono: credito?.modo === "abierto" ? "positivo" : "normal",
          detalle: credito && Number(credito.en_pedidos) > 0 ? `${formatPrice(Number(credito.en_pedidos))} en pedidos` : undefined },
        { label: "Consignado", valor: `${totalConsignado.toLocaleString("es-VE")} u`, detalle: consignacion.length ? `${consignacion.length} productos` : undefined },
        { label: "Contactos", valor: contactos.length, detalle: `${accesos.filter((a) => a.activo).length} con acceso` },
      ]} />

      <Panel titulo="Datos del cliente" acciones={puedeEditarOdoo && odoo ? (
        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setContactoAbierto(true)}>
          <Pencil className="h-3.5 w-3.5" /> Teléfonos y dirección
        </Button>
      ) : undefined}>
        <FichaCampos campos={[
          { label: "RIF", valor: cliente.rif, odoo, mono: true },
          { label: "Cédula", valor: cliente.cedula, odoo, mono: true },
          { label: "Tipo de residencia", valor: cliente.tipo_residencia, odoo },
          { label: "Email", valor: cliente.email, odoo },
          { label: "Teléfono", valor: cliente.telefono, odoo },
          { label: "Celular", valor: cliente.celular, odoo },
          { label: "Dirección", valor: cliente.direccion, odoo, ancho: 2 },
          { label: "Dirección de entrega", valor: cliente.direccion_entrega, ancho: 2 },
          { label: "Ciudad", valor: cliente.ciudad, odoo },
          { label: "Estado", valor: cliente.estado, odoo },
          { label: "Vendedor", valor: cliente.vendedor_odoo, odoo },
          { label: "Lista de precios", valor: cliente.lista_precios?.nombre },
          { label: "Condición de pago", valor: cliente.condicion_pago, odoo },
          { label: "Días de crédito", valor: cliente.dias_credito != null ? `${cliente.dias_credito} días` : null, odoo },
          { label: "Retiene IVA", valor: cliente.retiene_iva ? "Sí" : "No" },
          { label: "Retiene ISLR", valor: cliente.retiene_islr ? "Sí" : "No" },
          { label: "Licencia de actividad", valor: cliente.licencia_actividad, odoo },
          { label: "Sitio web", valor: cliente.sitio_web ? <a href={cliente.sitio_web} target="_blank" rel="noreferrer" className="text-primary underline">{cliente.sitio_web}</a> : null, odoo },
          { label: "Registrado en Odoo", valor: fechaCorta(cliente.fecha_registro_odoo) },
          { label: "Creado en GUDS", valor: fechaCorta(cliente.created_at) },
          ...(cliente.latitud != null || cliente.longitud != null ? [{ label: "Coordenadas", valor: `${cliente.latitud}, ${cliente.longitud}`, mono: true }] : []),
          ...(cliente.notas ? [{ label: "Notas", valor: cliente.notas, odoo, ancho: 3 as const }] : []),
        ]} />
      </Panel>

      {puedeVerOdoo && (
        <EstadoOdooCliente clienteId={cliente.id} version={versionOdoo} puedeCrear={puedeCrearOdoo} onCambio={recargarOdoo} onEstado={setEstadoOdoo} />
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="ordenes"><ShoppingCart className="mr-1.5 h-3.5 w-3.5" />Órdenes ({ordenes.length})</TabsTrigger>
          <TabsTrigger value="contactos"><Users className="mr-1.5 h-3.5 w-3.5" />Contactos ({contactos.length})</TabsTrigger>
          <TabsTrigger value="direcciones"><MapPin className="mr-1.5 h-3.5 w-3.5" />Direcciones ({direcciones.length})</TabsTrigger>
          <TabsTrigger value="consignacion"><Boxes className="mr-1.5 h-3.5 w-3.5" />Consignación ({consignacion.length})</TabsTrigger>
          {puedeEditarOdoo && <TabsTrigger value="odoo"><History className="mr-1.5 h-3.5 w-3.5" />Cambios a Odoo</TabsTrigger>}
        </TabsList>

        <TabsContent value="ordenes">
          <div className="rounded-lg border border-border bg-card">
            {ordenes.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Este cliente no tiene órdenes.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Orden</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Ítems</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Total</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {ordenesPag.pageItems.map((o) => (
                      <TableRow key={o.id} className="cursor-pointer" onClick={() => navigate(`/admin/ordenes?orden=${o.id}`)}>
                        <TableCell className="whitespace-nowrap font-mono text-xs font-medium text-primary">{o.numero}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{fechaCorta(o.fecha_pedido || o.created_at)}</TableCell>
                        <TableCell className="text-right">{o.items?.[0]?.count ?? 0}</TableCell>
                        <TableCell><Badge variant={ESTADO[o.estado]?.variant ?? "secondary"}>{ESTADO[o.estado]?.label ?? o.estado}</Badge></TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(o.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <DataTablePagination pagination={ordenesPag} pageSizeOptions={[10, 25, 50]} />
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="contactos">
          <EmpresasPortalCliente clienteId={cliente.id} />
          <ContactosEntidad tipo="cliente" entidadId={cliente.id} entidadNombre={cliente.nombre_negocio} onCambio={recargarContactos}
            extraColumna={puedeVerOdoo && odoo ? { titulo: "Odoo", celda: (k) => (k.origen === "odoo"
              ? <OdooBadge /> : <EstadoOdooContacto contacto={estadoOdoo?.contactos.find((x) => x.id === k.id)} />) } : undefined} />
          <UsuariosPortalSinContacto clienteId={cliente.id} />
        </TabsContent>

        <TabsContent value="direcciones">
          <div className="mb-2 flex justify-end"><BotonUbicacionesCliente clienteId={cliente.id} clienteNombre={cliente.nombre_negocio} /></div>
          <div className="rounded-lg border border-border bg-card">
            {puedeEditarOdoo && odoo && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5">
                <p className="text-xs text-muted-foreground">Las direcciones de entrega se guardan en Odoo.</p>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setDirDialogo({ abierto: true, direccion: null })}>
                  <Plus className="h-3.5 w-3.5" /> Nueva dirección
                </Button>
              </div>
            )}
            {direcciones.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Sin direcciones de entrega adicionales.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Dirección</TableHead><TableHead>Ciudad</TableHead><TableHead>Teléfono</TableHead><TableHead>Estado</TableHead>{puedeEditarOdoo && <TableHead className="w-10"><span className="sr-only">Editar</span></TableHead>}</TableRow></TableHeader>
                <TableBody>
                  {direcciones.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="whitespace-nowrap font-medium">{d.nombre || "Dirección"} {d.odoo_id && <OdooBadge />}</TableCell>
                      <TableCell className="max-w-[360px] truncate text-muted-foreground" title={d.direccion ?? ""}>{d.direccion || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{[d.ciudad, d.estado].filter(Boolean).join(", ") || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{d.telefono || "—"}</TableCell>
                      <TableCell>{d.activo ? <Badge variant="outline">Activa</Badge> : <Badge variant="secondary">Archivada</Badge>}</TableCell>
                      {puedeEditarOdoo && (
                        <TableCell className="py-1 text-right">
                          {d.odoo_id && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Editar la dirección ${d.nombre ?? ""}`} title="Editar (se guarda en Odoo)"
                              onClick={() => setDirDialogo({ abierto: true, direccion: d })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="consignacion">
          <div className="rounded-lg border border-border bg-card">
            {consignacion.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Sin mercancía en consignación.</p>
            ) : (
              <>
                <Table>
                  <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Producto</TableHead><TableHead>Almacén</TableHead><TableHead className="text-right">Cantidad</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {consigPag.pageItems.map((r, i) => (
                      <TableRow key={r.sku + i}>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{r.sku || "—"}</TableCell>
                        <TableCell className="max-w-[360px] truncate font-medium" title={r.producto}>{r.producto}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{r.almacen}</TableCell>
                        <TableCell className="text-right font-semibold">{r.cantidad.toLocaleString("es-VE")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <DataTablePagination pagination={consigPag} pageSizeOptions={[10, 25, 50]} />
              </>
            )}
          </div>
        </TabsContent>

        {puedeEditarOdoo && (
          <TabsContent value="odoo">
            <div className="rounded-lg border border-border bg-card">
              <HistorialOdooCliente clienteId={cliente.id} version={versionOdoo} />
            </div>
          </TabsContent>
        )}
      </Tabs>

      {puedeEditarOdoo && odoo && (
        <>
          <EditarContactoClienteDialog open={contactoAbierto} onOpenChange={setContactoAbierto} cliente={cliente} onGuardado={recargarOdoo} />
          <DireccionClienteDialog open={dirDialogo.abierto} onOpenChange={(v) => setDirDialogo((d) => ({ ...d, abierto: v }))}
            clienteId={cliente.id} clienteNombre={cliente.nombre_negocio} direccion={dirDialogo.direccion}
            porDefecto={{ ciudad: cliente.ciudad, estado: cliente.estado ?? null }}
            nombresUsados={direcciones.map((d) => d.nombre ?? "").filter(Boolean)} onGuardado={recargarOdoo} />
        </>
      )}
    </MainLayout>
  );
};

export default ClienteDetalle;
