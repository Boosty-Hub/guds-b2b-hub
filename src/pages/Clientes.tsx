import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Plus, Search, Building2, MapPin, Users, Eye, Edit, Loader2, Trash2, Save, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase, Cliente, ListaPrecios } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";

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

    const { error } = await supabase.from('clientes').insert({
      codigo: generateCodigo(),
      nombre_negocio: formData.nombre_negocio,
      tipo_negocio: formData.tipo_negocio,
      rif: formData.rif,
      email: formData.email,
      telefono: formData.telefono || null,
      direccion: formData.direccion,
      ciudad: formData.ciudad,
      limite_credito: formData.limite_credito,
      dias_credito: formData.dias_credito,
      lista_precios_id: formData.lista_precios_id || null,
      activo: formData.activo,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Cliente Creado", description: `${formData.nombre_negocio} ha sido creado exitosamente` });
    resetForm();
    setIsCreateOpen(false);
    fetchData();
  };

  const handleEdit = async () => {
    if (!selectedCliente) return;

    const { error } = await supabase
      .from('clientes')
      .update({
        nombre_negocio: formData.nombre_negocio,
        tipo_negocio: formData.tipo_negocio,
        rif: formData.rif,
        email: formData.email,
        telefono: formData.telefono || null,
        direccion: formData.direccion,
        ciudad: formData.ciudad,
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
      nombre_negocio: cliente.nombre_negocio,
      tipo_negocio: cliente.tipo_negocio,
      rif: cliente.rif,
      email: cliente.email,
      telefono: cliente.telefono || "",
      direccion: cliente.direccion,
      ciudad: cliente.ciudad,
      limite_credito: cliente.limite_credito,
      dias_credito: cliente.dias_credito,
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

  const stats = {
    total: clientes.length,
    activos: clientes.filter(c => c.activo).length,
  };

  return (
    <MainLayout title="Clientes">
      {/* Stats */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Total Clientes</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2">
              <Building2 className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.activos}</p>
              <p className="text-sm text-muted-foreground">Activos</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2">
              <MapPin className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">{clientes.filter(c => c.limite_credito > 0).length}</p>
              <p className="text-sm text-muted-foreground">Con Crédito</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-destructive/10 p-2">
              <Users className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatPrice(clientes.reduce((sum, c) => sum + Number(c.credito_utilizado || 0), 0))}</p>
              <p className="text-sm text-muted-foreground">Crédito Utilizado</p>
            </div>
          </div>
        </div>
      </div>

      {/* Header Actions */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder="Buscar cliente..." 
            className="pl-9" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button className="gap-2" onClick={() => { resetForm(); setIsCreateOpen(true); }}>
          <Plus className="h-4 w-4" />
          Nuevo Cliente
        </Button>
      </div>

      {/* Clients Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredClientes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Building2 className="h-12 w-12 mb-4 opacity-50" />
            <p>No hay clientes registrados</p>
            <p className="text-sm">Los clientes aparecerán aquí cuando se aprueben registros</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>RIF</TableHead>
                <TableHead>Ciudad</TableHead>
                <TableHead>Lista de Precios</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Crédito</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredClientes.map((cliente) => (
                <TableRow key={cliente.id} className="hover:bg-muted/50">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="bg-primary/10 text-primary text-sm">
                          {cliente.nombre_negocio.split(' ').map(w => w[0]).join('').slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{cliente.nombre_negocio}</p>
                        <p className="text-xs text-muted-foreground">{cliente.codigo}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{cliente.rif}</TableCell>
                  <TableCell className="text-muted-foreground">{cliente.ciudad}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{cliente.lista_precios?.nombre || 'Sin asignar'}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={cliente.activo ? "default" : "secondary"}>
                      {cliente.activo ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="text-sm">
                      <p className="font-semibold">{formatPrice(cliente.limite_credito)}</p>
                      {cliente.credito_utilizado > 0 && (
                        <p className="text-xs text-destructive">Usado: {formatPrice(cliente.credito_utilizado)}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Link to={`/admin/clientes/${cliente.id}/usuarios`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Usuarios del Portal">
                          <UserPlus className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditSheet(cliente)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-destructive"
                        onClick={() => { setSelectedCliente(cliente); setIsDeleteOpen(true); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
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
            <SheetTitle>Editar Cliente</SheetTitle>
            <SheetDescription>Modifica los datos del cliente</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nombre del Negocio *</Label>
              <Input
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
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input
                  value={formData.telefono}
                  onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Dirección *</Label>
              <Input
                value={formData.direccion}
                onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Ciudad *</Label>
              <Input
                value={formData.ciudad}
                onChange={(e) => setFormData({ ...formData, ciudad: e.target.value })}
              />
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
                  value={formData.limite_credito}
                  onChange={(e) => setFormData({ ...formData, limite_credito: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Días de Crédito</Label>
                <Input
                  type="number"
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
