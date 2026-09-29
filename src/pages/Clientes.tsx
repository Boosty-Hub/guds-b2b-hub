import { useState, useEffect } from "react";
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
import { Plus, Building2, Eye, Edit, Loader2, Trash2, Save, UserPlus } from "lucide-react";
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

interface ClienteConLista extends Cliente {
  lista_precios?: ListaPrecios | null;
}

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
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
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
    const [clientesRes, listasRes] = await Promise.all([
      supabase.from('clientes').select('*, lista_precios:listas_precios(*)').order('nombre_negocio'),
      supabase.from('listas_precios').select('*').eq('activo', true).order('nombre'),
    ]);
    
    if (clientesRes.data) setClientes(clientesRes.data);
    if (listasRes.data) setListasPrecios(listasRes.data);
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

  const filteredClientes = clientes.filter(c =>
    c.nombre_negocio.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.rif.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const { ordenadas, orden, alternar } = useOrdenTabla(filteredClientes, {
    nombre: (c) => c.nombre_negocio, rif: (c) => c.rif, ciudad: (c) => c.ciudad, estado: (c) => (c.activo ? 1 : 0),
    limite: (c) => Number(c.limite_credito || 0), usado: (c) => Number(c.credito_utilizado || 0),
  });
  const pagination = usePagination(ordenadas, 50);
  const exportar = () => exportarCSV("clientes", ordenadas, [
    { titulo: "Código", valor: (c) => c.codigo }, { titulo: "Cliente", valor: (c) => c.nombre_negocio }, { titulo: "RIF", valor: (c) => c.rif },
    { titulo: "Ciudad", valor: (c) => c.ciudad }, { titulo: "Teléfono", valor: (c) => c.telefono }, { titulo: "Email", valor: (c) => c.email },
    { titulo: "Activo", valor: (c) => (c.activo ? "Sí" : "No") }, { titulo: "Límite crédito", valor: (c) => Number(c.limite_credito || 0) },
    { titulo: "Crédito utilizado", valor: (c) => Number(c.credito_utilizado || 0) },
  ]);

  const stats = {
    total: clientes.length,
    activos: clientes.filter(c => c.activo).length,
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
          { label: "Con Crédito", valor: clientes.filter(c => c.limite_credito > 0).length, tono: "alerta" },
          { label: "Crédito Utilizado", valor: formatPrice(clientes.reduce((sum, c) => sum + Number(c.credito_utilizado || 0), 0)), tono: "negativo" },
        ]}
      />

      {/* Header Actions */}
      <BarraLista
        busqueda={searchTerm}
        onBusqueda={setSearchTerm}
        placeholder="Buscar cliente..."
        contador={`${filteredClientes.length} registros`}
        acciones={
          <>
            {cols.selector}
            <BotonExportar onClick={exportar} total={ordenadas.length} />
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
            <p className="text-sm">No hay clientes registrados</p>
            <p className="text-xs">Los clientes aparecerán aquí cuando se aprueben registros</p>
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
