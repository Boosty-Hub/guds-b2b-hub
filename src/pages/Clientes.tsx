import { useState, useEffect, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Building2, Eye, Edit, Loader2, Trash2, Save, UserPlus, Tags } from "lucide-react";
import { usePermissions } from "@/contexts/PermissionsContext";
import { Link, useNavigate } from "react-router-dom";
import { supabase, Cliente, ListaPrecios } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { OdooBadge } from "@/components/OdooBadge";
import { ESTADOS_VE, estadoVe } from "@/components/clientes/odooCliente";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { useColumnas } from "@/components/datos/columnas";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesTexto, opcionesPrueba, pasaPrueba, coincide, coincideTexto,
  contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";

interface ClienteConLista extends Cliente {
  lista_precios?: ListaPrecios | null;
  vendedor?: { nombre: string; apellido: string | null } | null;
  condicion_pago?: string | null;
  empresa_id?: string | null;
  es_empresa?: boolean | null;
  /** Empleado (compras de personal, fase 21a): no cuenta como cartera de vendedor ni como "sin vendedor". */
  es_empleado?: boolean | null;
  /** Clasificación de finanzas que trae la sincronización desde Odoo (22d): Industria, Canal y Segmento de contacto */
  tipo_cliente?: string | null;
  canal?: string | null;
  segmento?: string | null;
}

/** Deuda del cliente según sus facturas publicadas (misma regla que Cuentas por Cobrar): saldo, vencido y a favor. */
interface Deuda { saldo: number; vencido: number; aFavor: number; neto: number }
const SIN_DEUDA: Deuda = { saldo: 0, vencido: 0, aFavor: 0, neto: 0 };

/** "15 Days" / "Immediate Payment" (como vienen de Odoo) → "15 días" / "Pago inmediato". */
const textoCondicion = (c: string) => c.replace(/^Immediate Payment$/i, "Pago inmediato").replace(/^(\d+)\s*Days?$/i, "$1 días").replace(/^contado$/i, "Contado");

const tiposNegocio = [
  "Bodega",
  "Supermercado",
  "Minimarket",
  "Restaurante",
  "Hotel",
  "Panadería",
  "Licorería",
  "Distribuidora",
  "Otro"
];

const Clientes = () => {
  const [clientes, setClientes] = useState<ClienteConLista[]>([]);
  const [listasPrecios, setListasPrecios] = useState<ListaPrecios[]>([]);
  const [deudas, setDeudas] = useState<Record<string, Deuda>>({});
  const [conPortal, setConPortal] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const { can } = usePermissions();
  const navigate = useNavigate();

  // Sheet states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedCliente, setSelectedCliente] = useState<ClienteConLista | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    nombre_negocio: "",
    tipo_negocio: "",
    rif: "",
    email: "",
    telefono: "",
    direccion: "",
    ciudad: "",
    estado: "",
    limite_credito: 0,
    dias_credito: 30,
    lista_precios_id: "",
    activo: true,
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [clientesRes, listasRes, facturasRes, portalRes] = await Promise.all([
      supabase.from('clientes').select('*, lista_precios:listas_precios(*), vendedor:usuarios!clientes_vendedor_asignado_id_fkey(nombre, apellido)').order('nombre_negocio'),
      supabase.from('listas_precios').select('*').eq('activo', true).order('nombre'),
      // Solo facturas con saldo (para los filtros de deuda): cliente, saldo y vencimiento
      supabase.from('facturas').select('cliente_id, saldo_usd, fecha_vencimiento, fecha_emision').eq('estado', 'posted').or('saldo_usd.gt.0.009,saldo_usd.lt.-0.009'),
      // Clientes con al menos un acceso activo al portal
      supabase.from('usuarios').select('cliente_id').eq('role', 'cliente').eq('activo', true).not('cliente_id', 'is', null),
    ]);

    if (clientesRes.data) setClientes(clientesRes.data as ClienteConLista[]);
    if (listasRes.data) setListasPrecios(listasRes.data);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const d: Record<string, Deuda> = {};
    for (const f of (facturasRes.data as { cliente_id: string; saldo_usd: number; fecha_vencimiento: string | null; fecha_emision: string | null }[] | null) ?? []) {
      const x = d[f.cliente_id] ?? (d[f.cliente_id] = { ...SIN_DEUDA });
      const saldo = Number(f.saldo_usd);
      if (saldo < 0) x.aFavor += saldo;
      else {
        x.saldo += saldo;
        const vence = f.fecha_vencimiento || f.fecha_emision;
        if (vence && new Date(`${vence}T00:00:00`).getTime() < hoy.getTime()) x.vencido += saldo;
      }
      x.neto = x.saldo + x.aFavor;
    }
    setDeudas(d);
    setConPortal(new Set(((portalRes.data as { cliente_id: string }[] | null) ?? []).map((u) => u.cliente_id)));
    setLoading(false);
  };

  const generateCodigo = () => {
    const prefix = "CLI";
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${prefix}-${random}`;
  };

  const resetForm = () => {
    setFormData({
      nombre_negocio: "",
      tipo_negocio: "",
      rif: "",
      email: "",
      telefono: "",
      direccion: "",
      ciudad: "",
      estado: "",
      limite_credito: 0,
      dias_credito: 30,
      lista_precios_id: "",
      activo: true,
    });
  };

  const handleCreate = async () => {
    if (!formData.nombre_negocio || !formData.rif || !formData.email || !formData.direccion || !formData.ciudad || !formData.tipo_negocio) {
      toast({ title: "Error", description: "Completa todos los campos requeridos", variant: "destructive" });
      return;
    }

    const { data: codigo } = await supabase.rpc('generar_codigo_cliente');
    const { error } = await supabase.from('clientes').insert({
      codigo: (codigo as string | null) || generateCodigo(),
      nombre_negocio: formData.nombre_negocio,
      tipo_negocio: formData.tipo_negocio,
      rif: formData.rif,
      email: formData.email,
      telefono: formData.telefono || null,
      direccion: formData.direccion,
      calle: formData.direccion,
      ciudad: formData.ciudad,
      estado: formData.estado || null,   // Odoo lo exige para crear el cliente (Fase 9b)
      limite_credito: formData.limite_credito,
      dias_credito: formData.dias_credito,
      lista_precios_id: formData.lista_precios_id || null,
      activo: formData.activo,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Cliente Creado", description: `${formData.nombre_negocio}: creado en GUDS; su alta en Odoo está en curso (ver su ficha)` });
    resetForm();
    setIsCreateOpen(false);
    fetchData();
  };

  const handleEdit = async () => {
    if (!selectedCliente) return;

    // Cliente de Odoo: sus datos se editan en Odoo; en GUDS solo la lista de precios
    const { error } = await supabase
      .from('clientes')
      .update(selectedCliente.odoo_id ? { lista_precios_id: formData.lista_precios_id || null, limite_credito: formData.limite_credito } : {
        nombre_negocio: formData.nombre_negocio,
        tipo_negocio: formData.tipo_negocio,
        rif: formData.rif,
        email: formData.email,
        telefono: formData.telefono || null,
        direccion: formData.direccion,
        calle: formData.direccion,
        ciudad: formData.ciudad,
        estado: formData.estado || null,
        limite_credito: formData.limite_credito,
        dias_credito: formData.dias_credito,
        lista_precios_id: formData.lista_precios_id || null,
        activo: formData.activo,
      })
      .eq('id', selectedCliente.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Cliente Actualizado", description: `${formData.nombre_negocio} ha sido actualizado` });
    resetForm();
    setIsEditOpen(false);
    setSelectedCliente(null);
    fetchData();
  };

  const handleDelete = async () => {
    if (!selectedCliente) return;

    const { error } = await supabase.from('clientes').delete().eq('id', selectedCliente.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Cliente Eliminado", description: `${selectedCliente.nombre_negocio} ha sido eliminado`, variant: "destructive" });
    }

    setIsDeleteOpen(false);
    setSelectedCliente(null);
    fetchData();
  };

  const openEditSheet = (cliente: ClienteConLista) => {
    setSelectedCliente(cliente);
    setFormData({
      // Los clientes de Odoo pueden venir sin correo, dirección o ciudad: los campos siempre reciben texto
      nombre_negocio: cliente.nombre_negocio || "",
      tipo_negocio: cliente.tipo_negocio || "",
      rif: cliente.rif || "",
      email: cliente.email || "",
      telefono: cliente.telefono || "",
      direccion: cliente.direccion || "",
      ciudad: cliente.ciudad || "",
      estado: estadoVe(cliente.estado) ?? "",
      limite_credito: cliente.limite_credito ?? 0,
      dias_credito: cliente.dias_credito ?? 0,
      lista_precios_id: cliente.lista_precios_id || "",
      activo: cliente.activo,
    });
    setIsEditOpen(true);
  };

  // ---- Filtros (en la URL) ----
  const deudaDe = (c: ClienteConLista) => deudas[c.id] ?? SIN_DEUDA;
  const nombreVendedor = (c: ClienteConLista) => (c.vendedor ? `${c.vendedor.nombre} ${c.vendedor.apellido || ""}`.trim() : null);
  const pruebasDeuda: OpcionPrueba<ClienteConLista>[] = [
    { valor: "con", etiqueta: "Con deuda", prueba: (c) => deudaDe(c).neto > 0.009 },
    { valor: "vencida", etiqueta: "Con facturas vencidas", prueba: (c) => deudaDe(c).vencido > 0.009 },
    { valor: "sin", etiqueta: "Sin deuda", prueba: (c) => deudaDe(c).neto <= 0.009 },
    { valor: "favor", etiqueta: "Con saldo a favor", prueba: (c) => deudaDe(c).aFavor < -0.009 },
  ];
  const pruebasCredito: OpcionPrueba<ClienteConLista>[] = [
    { valor: "con", etiqueta: "Con límite de crédito", prueba: (c) => Number(c.limite_credito || 0) > 0 },
    { valor: "sin", etiqueta: "Sin límite (contado)", prueba: (c) => !(Number(c.limite_credito || 0) > 0) },
    { valor: "excedido", etiqueta: "Deuda sobre el límite", prueba: (c) => Number(c.limite_credito || 0) > 0 && deudaDe(c).neto > Number(c.limite_credito) + 0.009 },
  ];
  const pruebasSiNo = (si: string, no: string, p: (c: ClienteConLista) => boolean): OpcionPrueba<ClienteConLista>[] => [
    { valor: "si", etiqueta: si, prueba: p }, { valor: "no", etiqueta: no, prueba: (c) => !p(c) },
  ];
  const pruebasActivo = pruebasSiNo("Activos", "Inactivos", (c) => c.activo);
  const pruebasPortal = pruebasSiNo("Con acceso al portal", "Sin acceso", (c) => conPortal.has(c.id));
  const pruebasTipo: OpcionPrueba<ClienteConLista>[] = [
    { valor: "empresa", etiqueta: "Empresa", prueba: (c) => !c.es_empleado && c.es_empresa !== false },
    { valor: "persona", etiqueta: "Persona natural", prueba: (c) => !c.es_empleado && c.es_empresa === false },
    { valor: "empleado", etiqueta: "Empleado (compras de personal)", prueba: (c) => !!c.es_empleado },
  ];
  const pruebasOrigen: OpcionPrueba<ClienteConLista>[] = [
    { valor: "odoo", etiqueta: "Odoo", prueba: (c) => !!c.odoo_id }, { valor: "guds", etiqueta: "Creado en GUDS", prueba: (c) => !c.odoo_id },
  ];
  const filtroEmpresa = useFiltroEmpresa(clientes);
  const f = useFiltros([
    { clave: "estado", etiqueta: "Estado", todos: "Todos los estados", principal: true, opciones: opcionesDe(clientes, (c) => estadoVe(c.estado) ?? c.estado, undefined, "Sin estado") },
    { clave: "ciudad", etiqueta: "Ciudad", todos: "Todas las ciudades", principal: true, opciones: opcionesTexto(clientes, (c) => c.ciudad, "Sin ciudad") },
    { clave: "vendedor", etiqueta: "Vendedor", principal: true, opciones: opcionesDe(clientes, (c) => c.vendedor_asignado_id, (c) => nombreVendedor(c) ?? "—", "Sin vendedor") },
    { clave: "deuda", etiqueta: "Deuda", todos: "Todas", principal: true, opciones: opcionesPrueba(clientes, pruebasDeuda) },
    { clave: "condicion", etiqueta: "Condición de pago", todos: "Todas", opciones: opcionesDe(clientes, (c) => c.condicion_pago, (_c, v) => textoCondicion(v), "Sin condición") },
    { clave: "credito", etiqueta: "Crédito", todos: "Todos", opciones: opcionesPrueba(clientes, pruebasCredito) },
    { clave: "lista", etiqueta: "Lista de precios", todos: "Todas", opciones: opcionesDe(clientes, (c) => c.lista_precios_id, (c) => c.lista_precios?.nombre ?? "—", "Sin lista") },
    { clave: "tipo", etiqueta: "Tipo", todos: "Todos los tipos", opciones: opcionesPrueba(clientes, pruebasTipo) },
    { clave: "activo", etiqueta: "Situación", todos: "Activos e inactivos", opciones: opcionesPrueba(clientes, pruebasActivo) },
    { clave: "portal", etiqueta: "Portal", todos: "Con y sin acceso", opciones: opcionesPrueba(clientes, pruebasPortal) },
    { clave: "origen", etiqueta: "Origen", todos: "Odoo y GUDS", opciones: opcionesPrueba(clientes, pruebasOrigen) },
    // Clasificación de finanzas (22d), tal como está en Odoo
    { clave: "tipo_cliente", etiqueta: "Tipo de cliente", todos: "Todos", opciones: opcionesDe(clientes, (c) => c.tipo_cliente, undefined, "Sin tipo de cliente") },
    { clave: "canal", etiqueta: "Canal", todos: "Todos", opciones: opcionesDe(clientes, (c) => c.canal, undefined, "Sin canal") },
    { clave: "segmento", etiqueta: "Categoría de cobranza", todos: "Todas", opciones: opcionesDe(clientes, (c) => c.segmento, undefined, "Sin categoría") },
    filtroEmpresa,
  ]);
  const pasaFiltros = (c: ClienteConLista) =>
    coincide(estadoVe(c.estado) ?? c.estado, f.v("estado")) && coincideTexto(c.ciudad, f.v("ciudad"))
    && coincide(c.vendedor_asignado_id, f.v("vendedor")) && pasaPrueba(pruebasDeuda, f.v("deuda"), c)
    && coincide(c.condicion_pago, f.v("condicion")) && pasaPrueba(pruebasCredito, f.v("credito"), c)
    && coincide(c.lista_precios_id, f.v("lista")) && pasaPrueba(pruebasActivo, f.v("activo"), c)
    && pasaPrueba(pruebasPortal, f.v("portal"), c) && pasaPrueba(pruebasOrigen, f.v("origen"), c) && pasaPrueba(pruebasTipo, f.v("tipo"), c)
    && coincide(c.tipo_cliente, f.v("tipo_cliente")) && coincide(c.canal, f.v("canal")) && coincide(c.segmento, f.v("segmento"))
    && (!filtroEmpresa || coincide(c.empresa_id, f.v("empresa")));
  // Base de los indicadores: los filtros sin la búsqueda (sin filtros = todos los clientes, como antes)
  const base = useMemo(() => (f.activos ? clientes.filter(pasaFiltros) : clientes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientes, deudas, conPortal, f.firma]);
  const termino = searchTerm.toLowerCase();
  const filteredClientes = base.filter(c =>
    c.nombre_negocio.toLowerCase().includes(termino) ||
    c.codigo.toLowerCase().includes(termino) ||
    (c.rif || "").toLowerCase().includes(termino)
  );

  const { ordenadas, orden, alternar } = useOrdenTabla(filteredClientes, {
    nombre: (c) => c.nombre_negocio, rif: (c) => c.rif, ciudad: (c) => c.ciudad, estado: (c) => (c.activo ? 1 : 0),
    limite: (c) => Number(c.limite_credito || 0), usado: (c) => Number(c.credito_utilizado || 0),
  });
  const pagination = usePagination(ordenadas, 50, f.firma);
  const exportar = () => exportarCSV("clientes", ordenadas, [
    { titulo: "Código", valor: (c) => c.codigo }, { titulo: "Cliente", valor: (c) => c.nombre_negocio }, { titulo: "RIF", valor: (c) => c.rif },
    { titulo: "Ciudad", valor: (c) => c.ciudad }, { titulo: "Teléfono", valor: (c) => c.telefono }, { titulo: "Email", valor: (c) => c.email },
    { titulo: "Activo", valor: (c) => (c.activo ? "Sí" : "No") }, { titulo: "Límite crédito", valor: (c) => Number(c.limite_credito || 0) },
    { titulo: "Crédito utilizado", valor: (c) => Number(c.credito_utilizado || 0) },
    { titulo: "Estado", valor: (c) => estadoVe(c.estado) ?? c.estado }, { titulo: "Vendedor", valor: (c) => nombreVendedor(c) },
    { titulo: "Condición de pago", valor: (c) => (c.condicion_pago ? textoCondicion(c.condicion_pago) : "") },
    { titulo: "Deuda USD", valor: (c) => Number(deudaDe(c).neto.toFixed(2)) }, { titulo: "Vencido USD", valor: (c) => Number(deudaDe(c).vencido.toFixed(2)) },
    { titulo: "Tipo de cliente", valor: (c) => c.tipo_cliente }, { titulo: "Canal", valor: (c) => c.canal }, { titulo: "Categoría de cobranza", valor: (c) => c.segmento },
  ]);

  const stats = {
    total: base.length,
    activos: base.filter(c => c.activo).length,
  };

  const cols = useColumnas("clientes", [{ etiqueta: "Cliente", fija: true }, { etiqueta: "RIF" }, { etiqueta: "Ciudad" }, { etiqueta: "Lista de Precios" }, { etiqueta: "Estado" }, { etiqueta: "Límite crédito" }, { etiqueta: "Usado" }, { etiqueta: "Acciones", fija: true }]);
  return (
    <MainLayout title="Clientes">
      {cols.estilo}
      {/* Stats */}
      <KpiStrip
        items={[
          { label: "Total Clientes", valor: stats.total, tono: "primario" },
          { label: "Activos", valor: stats.activos, tono: "positivo" },
          { label: "Con Crédito", valor: base.filter(c => c.limite_credito > 0).length, tono: "alerta" },
          { label: "Crédito Utilizado", valor: formatPrice(base.reduce((sum, c) => sum + Number(c.credito_utilizado || 0), 0)), tono: "negativo" },
        ]}
      />

      {/* Header Actions */}
      <BarraLista
        busqueda={searchTerm}
        onBusqueda={setSearchTerm}
        placeholder="Buscar cliente..."
        filtros={<FiltrosLista filtros={f} resultados={filteredClientes.length} />}
        contador={loading ? undefined : contadorFiltrado(filteredClientes.length, clientes.length, f.activos || !!searchTerm)}
        acciones={
          <>
            {cols.selector}
            <BotonExportar onClick={exportar} total={ordenadas.length} />
            {can("clasificacion_clientes", "ver") && (
              <Link to="/admin/configuracion/clasificacion-clientes" title="Tipo de cliente, canal y categoría de cobranza de finanzas">
                <Button size="sm" variant="outline" className="h-8 gap-1.5"><Tags className="h-3.5 w-3.5" /> Clasificación</Button>
              </Link>
            )}
            <Button size="sm" className="gap-1.5" onClick={() => { resetForm(); setIsCreateOpen(true); }}>
              <Plus className="h-3.5 w-3.5" />
              Nuevo Cliente
            </Button>
          </>
        }
      />

      {/* Clients Table */}
      <div className="rounded-lg border border-border bg-card animate-fade-in">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filteredClientes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Building2 className="mb-2 h-8 w-8 opacity-50" />
            {clientes.length > 0 ? (
              <>
                <p className="text-sm">Ningún cliente coincide con la búsqueda o los filtros</p>
                {f.activos > 0 && <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>}
              </>
            ) : (
              <>
                <p className="text-sm">No hay clientes registrados</p>
                <p className="text-xs">Los clientes aparecerán aquí cuando se aprueben registros</p>
              </>
            )}
          </div>
        ) : (
          <Table data-tabla="clientes">
            <TableHeader>
              <TableRow>
                <EncabezadoOrdenable clave="nombre" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="rif" orden={orden} onOrdenar={alternar}>RIF</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="ciudad" orden={orden} onOrdenar={alternar}>Ciudad</EncabezadoOrdenable>
                <TableHead>Lista de Precios</TableHead>
                <EncabezadoOrdenable clave="estado" orden={orden} onOrdenar={alternar}>Estado</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="limite" orden={orden} onOrdenar={alternar} alinear="derecha">Límite crédito</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="usado" orden={orden} onOrdenar={alternar} alinear="derecha">Usado</EncabezadoOrdenable>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.pageItems.map((cliente) => (
                <TableRow
                  key={cliente.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/admin/clientes/${cliente.id}`)}
                >
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                      <span className="max-w-[260px] truncate font-medium" title={cliente.nombre_negocio}>{cliente.nombre_negocio}</span>
                      {cliente.odoo_id && <OdooBadge />}
                      {cliente.es_empleado && <Badge variant="outline" className="px-1.5 py-0 text-[10px]" title="Compras de personal: no cuenta como cartera de vendedor">Empleado</Badge>}
                      <span className="ml-1.5 text-xs text-muted-foreground">{cliente.codigo}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{cliente.rif}</TableCell>
                  <TableCell className="max-w-[160px] truncate whitespace-nowrap text-muted-foreground" title={cliente.ciudad || undefined}>{cliente.ciudad}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant="outline">{cliente.lista_precios?.nombre || 'Sin asignar'}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={cliente.activo ? "default" : "secondary"}>
                      {cliente.activo ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(cliente.limite_credito)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {cliente.credito_utilizado > 0
                      ? <span className="text-destructive">{formatPrice(cliente.credito_utilizado)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Ver detalle"
                        onClick={() => navigate(`/admin/clientes/${cliente.id}`)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Link to={`/admin/clientes/${cliente.id}/usuarios`}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Usuarios del Portal">
                          <UserPlus className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => openEditSheet(cliente)}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      {!cliente.odoo_id && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Eliminar" onClick={() => { setSelectedCliente(cliente); setIsDeleteOpen(true); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && <DataTablePagination pagination={pagination} />}
      </div>

      {/* Create Client Sheet */}
      <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Nuevo Cliente</SheetTitle>
            <SheetDescription>Ingresa los datos del nuevo cliente</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nombre del Negocio *</Label>
              <Input
                placeholder="Ej: Bodega El Sol"
                value={formData.nombre_negocio}
                onChange={(e) => setFormData({ ...formData, nombre_negocio: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo de Negocio *</Label>
                <Select value={formData.tipo_negocio} onValueChange={(v) => setFormData({ ...formData, tipo_negocio: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {tiposNegocio.map(tipo => (
                      <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>RIF *</Label>
                <Input
                  placeholder="J-12345678-9"
                  value={formData.rif}
                  onChange={(e) => setFormData({ ...formData, rif: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input
                  placeholder="+58 412 1234567"
                  value={formData.telefono}
                  onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Dirección *</Label>
              <Input
                placeholder="Av. Principal, Local 1"
                value={formData.direccion}
                onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Ciudad *</Label>
              <Input
                placeholder="Caracas"
                value={formData.ciudad}
                onChange={(e) => setFormData({ ...formData, ciudad: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cli-nuevo-estado">Estado (Odoo lo exige)</Label>
              <Select value={formData.estado || undefined} onValueChange={(v) => setFormData({ ...formData, estado: v })}>
                <SelectTrigger id="cli-nuevo-estado"><SelectValue placeholder="Elige el estado" /></SelectTrigger>
                <SelectContent className="max-h-72">{ESTADOS_VE.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Lista de Precios</Label>
              <Select value={formData.lista_precios_id} onValueChange={(v) => setFormData({ ...formData, lista_precios_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar lista" />
                </SelectTrigger>
                <SelectContent>
                  {listasPrecios.map(lista => (
                    <SelectItem key={lista.id} value={lista.id}>{lista.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Límite de Crédito</Label>
                <Input
                  type="number"
                  placeholder="0"
                  value={formData.limite_credito}
                  onChange={(e) => setFormData({ ...formData, limite_credito: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Días de Crédito</Label>
                <Input
                  type="number"
                  placeholder="30"
                  value={formData.dias_credito}
                  onChange={(e) => setFormData({ ...formData, dias_credito: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label>Cliente Activo</Label>
              <Switch
                checked={formData.activo}
                onCheckedChange={(checked) => setFormData({ ...formData, activo: checked })}
              />
            </div>
            <div className="flex gap-2 pt-4">
              <Button variant="outline" className="flex-1" onClick={() => setIsCreateOpen(false)}>
                Cancelar
              </Button>
              <Button className="flex-1 gap-2" onClick={handleCreate}>
                <Save className="h-4 w-4" />
                Crear Cliente
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit Client Sheet */}
      <Sheet open={isEditOpen} onOpenChange={setIsEditOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">Editar Cliente {!!selectedCliente?.odoo_id && <OdooBadge />}</SheetTitle>
            <SheetDescription>
              {selectedCliente?.odoo_id
                ? "Los datos con la marca Odoo se editan en Odoo. Aquí se asigna la lista de precios."
                : "Modifica los datos del cliente"}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">Nombre del Negocio * {!!selectedCliente?.odoo_id && <OdooBadge />}</Label>
              <Input
                value={formData.nombre_negocio}
                disabled={!!selectedCliente?.odoo_id}
                onChange={(e) => setFormData({ ...formData, nombre_negocio: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">Tipo de Negocio * {!!selectedCliente?.odoo_id && <OdooBadge />}</Label>
                <Select disabled={!!selectedCliente?.odoo_id} value={formData.tipo_negocio} onValueChange={(v) => setFormData({ ...formData, tipo_negocio: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {tiposNegocio.map(tipo => (
                      <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">RIF * {!!selectedCliente?.odoo_id && <OdooBadge />}</Label>
                <Input
                  value={formData.rif}
                disabled={!!selectedCliente?.odoo_id}
                  onChange={(e) => setFormData({ ...formData, rif: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">Email * {!!selectedCliente?.odoo_id && <OdooBadge />}</Label>
                <Input
                  type="email"
                  value={formData.email}
                disabled={!!selectedCliente?.odoo_id}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">Teléfono {!!selectedCliente?.odoo_id && <OdooBadge />}</Label>
                <Input
                  value={formData.telefono}
                disabled={!!selectedCliente?.odoo_id}
                  onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">Dirección * {!!selectedCliente?.odoo_id && <OdooBadge />}</Label>
              <Input
                value={formData.direccion}
                disabled={!!selectedCliente?.odoo_id}
                onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">Ciudad * {!!selectedCliente?.odoo_id && <OdooBadge />}</Label>
              <Input
                value={formData.ciudad}
                disabled={!!selectedCliente?.odoo_id}
                onChange={(e) => setFormData({ ...formData, ciudad: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cli-editar-estado" className="flex items-center gap-1.5">Estado {!!selectedCliente?.odoo_id && <OdooBadge />}</Label>
              <Select value={formData.estado || undefined} onValueChange={(v) => setFormData({ ...formData, estado: v })} disabled={!!selectedCliente?.odoo_id}>
                <SelectTrigger id="cli-editar-estado"><SelectValue placeholder="Elige el estado" /></SelectTrigger>
                <SelectContent className="max-h-72">{ESTADOS_VE.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Lista de Precios</Label>
              <Select value={formData.lista_precios_id} onValueChange={(v) => setFormData({ ...formData, lista_precios_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar lista" />
                </SelectTrigger>
                <SelectContent>
                  {listasPrecios.map(lista => (
                    <SelectItem key={lista.id} value={lista.id}>{lista.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">Límite de Crédito {!!selectedCliente?.odoo_id && <OdooBadge titulo="Viene de Odoo; si lo cambias aquí queda pendiente de enviar a Odoo" />}</Label>
                <Input
                  type="number"
                  min={0}
                  value={formData.limite_credito}
                  onChange={(e) => setFormData({ ...formData, limite_credito: Number(e.target.value) })}
                />
                {!!selectedCliente?.odoo_id && <p className="text-xs text-muted-foreground">Al guardar queda pendiente de enviar a Odoo.</p>}
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">Días de Crédito {!!selectedCliente?.odoo_id && <OdooBadge />}</Label>
                <Input
                  type="number"
                  value={formData.dias_credito}
                disabled={!!selectedCliente?.odoo_id}
                  onChange={(e) => setFormData({ ...formData, dias_credito: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label className="flex items-center gap-1.5">Cliente Activo {!!selectedCliente?.odoo_id && <OdooBadge />}</Label>
              <Switch
                disabled={!!selectedCliente?.odoo_id}
                checked={formData.activo}
                onCheckedChange={(checked) => setFormData({ ...formData, activo: checked })}
              />
            </div>
            <div className="flex gap-2 pt-4">
              <Button variant="outline" className="flex-1" onClick={() => setIsEditOpen(false)}>
                Cancelar
              </Button>
              <Button className="flex-1 gap-2" onClick={handleEdit}>
                <Save className="h-4 w-4" />
                Guardar Cambios
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El cliente "{selectedCliente?.nombre_negocio}" será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
};

export default Clientes;
