import { useState, useEffect } from "react";
import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { 
  Plus, 
  CreditCard, 
  Building2, 
  Banknote, 
  Wallet,
  QrCode,
  MoreHorizontal,
  Edit,
  Trash2,
  GripVertical,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  Globe,
  Smartphone,
  Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

interface MetodoPagoDB {
  id: string;
  nombre: string;
  descripcion: string | null;
  tipo: string;
  icono: string | null;
  activo: boolean;
  disponible_portal_cliente: boolean;
  disponible_portal_vendedor: boolean;
  requiere_comprobante: boolean;
  instrucciones: string | null;
  datos_bancarios: Record<string, string>;
  orden: number;
}

interface MetodoPago {
  id: string;
  nombre: string;
  descripcion: string;
  tipo: "transferencia" | "tarjeta" | "efectivo" | "deposito" | "cheque" | "credito" | "pago_movil" | "otro";
  icono: string;
  activo: boolean;
  disponiblePortalCliente: boolean;
  disponiblePortalVendedor: boolean;
  requiereComprobante: boolean;
  instrucciones: string;
  datosAdicionales: {
    banco?: string;
    cuenta?: string;
    clabe?: string;
    titular?: string;
    telefono?: string;
    cedula?: string;
  };
  orden: number;
}

// Helper to convert DB format to UI format
const dbToUi = (db: MetodoPagoDB): MetodoPago => ({
  id: db.id,
  nombre: db.nombre,
  descripcion: db.descripcion || "",
  tipo: db.tipo as MetodoPago["tipo"],
  icono: db.icono || db.tipo,
  activo: db.activo,
  disponiblePortalCliente: db.disponible_portal_cliente,
  disponiblePortalVendedor: db.disponible_portal_vendedor,
  requiereComprobante: db.requiere_comprobante,
  instrucciones: db.instrucciones || "",
  datosAdicionales: db.datos_bancarios || {},
  orden: db.orden,
});

// Data is now fetched from Supabase

const tiposMetodo = [
  { value: "transferencia", label: "Transferencia Bancaria", icon: Building2 },
  { value: "deposito", label: "Depósito", icon: Banknote },
  { value: "tarjeta", label: "Tarjeta de Crédito/Débito", icon: CreditCard },
  { value: "efectivo", label: "Efectivo", icon: Wallet },
  { value: "cheque", label: "Cheque", icon: QrCode },
  { value: "credito", label: "Crédito", icon: CreditCard },
  { value: "otro", label: "Otro", icon: Wallet },
];

const getIconComponent = (tipo: string) => {
  switch (tipo) {
    case "transferencia":
      return <Building2 className="h-5 w-5" />;
    case "deposito":
      return <Banknote className="h-5 w-5" />;
    case "tarjeta":
      return <CreditCard className="h-5 w-5" />;
    case "efectivo":
      return <Wallet className="h-5 w-5" />;
    case "cheque":
      return <QrCode className="h-5 w-5" />;
    case "credito":
      return <CreditCard className="h-5 w-5" />;
    default:
      return <Wallet className="h-5 w-5" />;
  }
};

const ConfigMetodosPago = () => {
  const [metodos, setMetodos] = useState<MetodoPago[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedMetodo, setSelectedMetodo] = useState<MetodoPago | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    nombre: "",
    descripcion: "",
    tipo: "transferencia",
    instrucciones: "",
    requiereComprobante: true,
    disponiblePortalCliente: true,
    disponiblePortalVendedor: true,
    banco: "",
    cuenta: "",
    clabe: "",
    titular: "",
  });

  useEffect(() => {
    fetchMetodos();
  }, []);

  const fetchMetodos = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('metodos_pago')
      .select('*')
      .order('orden');
    
    if (data) {
      setMetodos(data.map(dbToUi));
    }
    setLoading(false);
  };

  const resetForm = () => {
    setFormData({
      nombre: "",
      descripcion: "",
      tipo: "transferencia",
      instrucciones: "",
      requiereComprobante: true,
      disponiblePortalCliente: true,
      disponiblePortalVendedor: true,
      banco: "",
      cuenta: "",
      clabe: "",
      titular: "",
    });
  };

  const handleToggleActivo = async (id: string) => {
    const metodo = metodos.find(m => m.id === id);
    if (!metodo) return;
    
    const newActivo = !metodo.activo;
    setMetodos(metodos.map(m => m.id === id ? { ...m, activo: newActivo } : m));

    const { error } = await supabase
      .from('metodos_pago')
      .update({ activo: newActivo })
      .eq('id', id);

    if (error) {
      // revertir el cambio optimista
      setMetodos(metodos.map(m => m.id === id ? { ...m, activo: metodo.activo } : m));
      toast({ title: "No se pudo actualizar", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: newActivo ? "Método Habilitado" : "Método Deshabilitado",
      description: `${metodo.nombre} ha sido ${newActivo ? "habilitado" : "deshabilitado"}`,
    });
  };

  const handleCreate = async () => {
    if (!formData.nombre || !formData.tipo) {
      toast({
        title: "Error",
        description: "Completa los campos requeridos",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const { data, error } = await supabase
      .from('metodos_pago')
      .insert({
        nombre: formData.nombre,
        descripcion: formData.descripcion,
        tipo: formData.tipo,
        activo: true,
        disponible_portal_cliente: formData.disponiblePortalCliente,
        disponible_portal_vendedor: formData.disponiblePortalVendedor,
        requiere_comprobante: formData.requiereComprobante,
        instrucciones: formData.instrucciones,
        datos_bancarios: {
          banco: formData.banco,
          cuenta: formData.cuenta,
          clabe: formData.clabe,
          titular: formData.titular,
        },
        orden: metodos.length + 1,
      })
      .select()
      .single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else if (data) {
      setMetodos([...metodos, dbToUi(data)]);
      toast({ title: "Método Creado", description: `${formData.nombre} ha sido agregado` });
      resetForm();
      setIsCreateOpen(false);
    }
    setSaving(false);
  };

  const handleEdit = async () => {
    if (!selectedMetodo) return;

    setSaving(true);
    const { error } = await supabase
      .from('metodos_pago')
      .update({
        nombre: formData.nombre,
        descripcion: formData.descripcion,
        tipo: formData.tipo,
        instrucciones: formData.instrucciones,
        requiere_comprobante: formData.requiereComprobante,
        disponible_portal_cliente: formData.disponiblePortalCliente,
        disponible_portal_vendedor: formData.disponiblePortalVendedor,
        datos_bancarios: {
          banco: formData.banco,
          cuenta: formData.cuenta,
          clabe: formData.clabe,
          titular: formData.titular,
        },
      })
      .eq('id', selectedMetodo.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setMetodos(metodos.map(m => 
        m.id === selectedMetodo.id ? {
          ...m,
          nombre: formData.nombre,
          descripcion: formData.descripcion,
          tipo: formData.tipo as MetodoPago["tipo"],
          instrucciones: formData.instrucciones,
          requiereComprobante: formData.requiereComprobante,
          disponiblePortalCliente: formData.disponiblePortalCliente,
          disponiblePortalVendedor: formData.disponiblePortalVendedor,
          datosAdicionales: {
            banco: formData.banco,
            cuenta: formData.cuenta,
            clabe: formData.clabe,
            titular: formData.titular,
          },
        } : m
      ));
      toast({ title: "Actualizado", description: `${formData.nombre} ha sido actualizado` });
      resetForm();
      setIsEditOpen(false);
      setSelectedMetodo(null);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!selectedMetodo) return;

    const { error } = await supabase
      .from('metodos_pago')
      .delete()
      .eq('id', selectedMetodo.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setMetodos(metodos.filter(m => m.id !== selectedMetodo.id));
      toast({ title: "Eliminado", description: `${selectedMetodo.nombre} ha sido eliminado`, variant: "destructive" });
    }
    setIsDeleteOpen(false);
    setSelectedMetodo(null);
  };

  const openEditDialog = (metodo: MetodoPago) => {
    setSelectedMetodo(metodo);
    setFormData({
      nombre: metodo.nombre,
      descripcion: metodo.descripcion,
      tipo: metodo.tipo,
      instrucciones: metodo.instrucciones,
      requiereComprobante: metodo.requiereComprobante,
      disponiblePortalCliente: metodo.disponiblePortalCliente,
      disponiblePortalVendedor: metodo.disponiblePortalVendedor,
      banco: metodo.datosAdicionales.banco || "",
      cuenta: metodo.datosAdicionales.cuenta || "",
      clabe: metodo.datosAdicionales.clabe || "",
      titular: metodo.datosAdicionales.titular || "",
    });
    setIsEditOpen(true);
  };

  const metodosActivos = metodos.filter(m => m.activo).length;

  return (
    <ConfiguracionLayout 
      title="Métodos de Pago" 
      description="Configura los métodos de pago disponibles para clientes y vendedores"
    >
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <CreditCard className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{metodos.length}</p>
                <p className="text-xs text-muted-foreground">Total Métodos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{metodosActivos}</p>
                <p className="text-xs text-muted-foreground">Activos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gray-500/10 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-gray-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{metodos.length - metodosActivos}</p>
                <p className="text-xs text-muted-foreground">Inactivos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Métodos Configurados</h2>
          <p className="text-sm text-muted-foreground">Arrastra para reordenar la prioridad de los métodos</p>
        </div>
        <Button className="gap-2" onClick={() => {
          resetForm();
          setIsCreateOpen(true);
        }}>
          <Plus className="h-4 w-4" />
          Nuevo Método
        </Button>
      </div>

      {/* Methods List */}
      <div className="space-y-3">
        {metodos.sort((a, b) => a.orden - b.orden).map((metodo) => (
          <Card key={metodo.id} className={`border-border ${!metodo.activo ? "opacity-60" : ""}`}>
            <CardContent className="p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-center gap-4 min-w-0">
                <div className="hidden sm:block cursor-grab text-muted-foreground hover:text-foreground">
                  <GripVertical className="h-5 w-5" />
                </div>

                <div className={`h-12 w-12 shrink-0 rounded-lg flex items-center justify-center ${
                  metodo.activo ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}>
                  {getIconComponent(metodo.tipo)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{metodo.nombre}</h3>
                    {!metodo.activo && (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{metodo.descripcion}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                    {metodo.disponiblePortalCliente && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Globe className="h-3 w-3" />
                        <span>Portal Cliente</span>
                      </div>
                    )}
                    {metodo.disponiblePortalVendedor && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Smartphone className="h-3 w-3" />
                        <span>Portal Vendedor</span>
                      </div>
                    )}
                    {metodo.requiereComprobante && (
                      <Badge variant="outline" className="text-xs">Requiere Comprobante</Badge>
                    )}
                  </div>
                </div>
                </div>

                <div className="flex items-center justify-between gap-4 sm:justify-start">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {metodo.activo ? "Activo" : "Inactivo"}
                    </span>
                    <Switch
                      checked={metodo.activo}
                      onCheckedChange={() => handleToggleActivo(metodo.id)}
                    />
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(metodo)}>
                        <Edit className="h-4 w-4 mr-2" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleToggleActivo(metodo.id)}>
                        {metodo.activo ? (
                          <>
                            <EyeOff className="h-4 w-4 mr-2" />
                            Deshabilitar
                          </>
                        ) : (
                          <>
                            <Eye className="h-4 w-4 mr-2" />
                            Habilitar
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        className="text-destructive"
                        onClick={() => {
                          setSelectedMetodo(metodo);
                          setIsDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Bank Details (if applicable) */}
              {(metodo.tipo === "transferencia" || metodo.tipo === "deposito") && metodo.datosAdicionales.banco && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    {metodo.datosAdicionales.banco && (
                      <div>
                        <p className="text-muted-foreground">Banco</p>
                        <p className="font-medium">{metodo.datosAdicionales.banco}</p>
                      </div>
                    )}
                    {metodo.datosAdicionales.cuenta && (
                      <div>
                        <p className="text-muted-foreground">Cuenta</p>
                        <p className="font-medium font-mono">{metodo.datosAdicionales.cuenta}</p>
                      </div>
                    )}
                    {metodo.datosAdicionales.clabe && (
                      <div>
                        <p className="text-muted-foreground">CLABE</p>
                        <p className="font-medium font-mono">{metodo.datosAdicionales.clabe}</p>
                      </div>
                    )}
                    {metodo.datosAdicionales.titular && (
                      <div>
                        <p className="text-muted-foreground">Titular</p>
                        <p className="font-medium">{metodo.datosAdicionales.titular}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Crear Método de Pago</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre *</Label>
                <Input
                  placeholder="Ej: Transferencia Bancaria"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select
                  value={formData.tipo}
                  onValueChange={(value) => setFormData({ ...formData, tipo: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tiposMetodo.map((tipo) => (
                      <SelectItem key={tipo.value} value={tipo.value}>
                        <div className="flex items-center gap-2">
                          <tipo.icon className="h-4 w-4" />
                          {tipo.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descripción</Label>
              <Input
                placeholder="Breve descripción del método de pago"
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Instrucciones para el Cliente</Label>
              <Textarea
                placeholder="Instrucciones detalladas de cómo realizar el pago..."
                value={formData.instrucciones}
                onChange={(e) => setFormData({ ...formData, instrucciones: e.target.value })}
                rows={3}
              />
            </div>

            {/* Bank Details */}
            {(formData.tipo === "transferencia" || formData.tipo === "deposito") && (
              <Card className="border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Datos Bancarios</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Banco</Label>
                      <Input
                        placeholder="Ej: BBVA"
                        value={formData.banco}
                        onChange={(e) => setFormData({ ...formData, banco: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Número de Cuenta</Label>
                      <Input
                        placeholder="Ej: 0123456789"
                        value={formData.cuenta}
                        onChange={(e) => setFormData({ ...formData, cuenta: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>CLABE Interbancaria</Label>
                      <Input
                        placeholder="18 dígitos"
                        value={formData.clabe}
                        onChange={(e) => setFormData({ ...formData, clabe: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Titular de la Cuenta</Label>
                      <Input
                        placeholder="Nombre del titular"
                        value={formData.titular}
                        onChange={(e) => setFormData({ ...formData, titular: e.target.value })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Options */}
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Opciones</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Disponible en Portal de Cliente</p>
                    <p className="text-sm text-muted-foreground">Los clientes podrán seleccionar este método</p>
                  </div>
                  <Switch
                    checked={formData.disponiblePortalCliente}
                    onCheckedChange={(checked) => setFormData({ ...formData, disponiblePortalCliente: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Disponible en Portal de Vendedor</p>
                    <p className="text-sm text-muted-foreground">Los vendedores podrán usar este método</p>
                  </div>
                  <Switch
                    checked={formData.disponiblePortalVendedor}
                    onCheckedChange={(checked) => setFormData({ ...formData, disponiblePortalVendedor: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Requiere Comprobante</p>
                    <p className="text-sm text-muted-foreground">El cliente debe subir comprobante de pago</p>
                  </div>
                  <Switch
                    checked={formData.requiereComprobante}
                    onCheckedChange={(checked) => setFormData({ ...formData, requiereComprobante: checked })}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate}>Crear Método</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar Método de Pago</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre *</Label>
                <Input
                  placeholder="Ej: Transferencia Bancaria"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select
                  value={formData.tipo}
                  onValueChange={(value) => setFormData({ ...formData, tipo: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tiposMetodo.map((tipo) => (
                      <SelectItem key={tipo.value} value={tipo.value}>
                        <div className="flex items-center gap-2">
                          <tipo.icon className="h-4 w-4" />
                          {tipo.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descripción</Label>
              <Input
                placeholder="Breve descripción del método de pago"
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Instrucciones para el Cliente</Label>
              <Textarea
                placeholder="Instrucciones detalladas de cómo realizar el pago..."
                value={formData.instrucciones}
                onChange={(e) => setFormData({ ...formData, instrucciones: e.target.value })}
                rows={3}
              />
            </div>

            {/* Bank Details */}
            {(formData.tipo === "transferencia" || formData.tipo === "deposito") && (
              <Card className="border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Datos Bancarios</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Banco</Label>
                      <Input
                        placeholder="Ej: BBVA"
                        value={formData.banco}
                        onChange={(e) => setFormData({ ...formData, banco: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Número de Cuenta</Label>
                      <Input
                        placeholder="Ej: 0123456789"
                        value={formData.cuenta}
                        onChange={(e) => setFormData({ ...formData, cuenta: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>CLABE Interbancaria</Label>
                      <Input
                        placeholder="18 dígitos"
                        value={formData.clabe}
                        onChange={(e) => setFormData({ ...formData, clabe: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Titular de la Cuenta</Label>
                      <Input
                        placeholder="Nombre del titular"
                        value={formData.titular}
                        onChange={(e) => setFormData({ ...formData, titular: e.target.value })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Options */}
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Opciones</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Disponible en Portal de Cliente</p>
                    <p className="text-sm text-muted-foreground">Los clientes podrán seleccionar este método</p>
                  </div>
                  <Switch
                    checked={formData.disponiblePortalCliente}
                    onCheckedChange={(checked) => setFormData({ ...formData, disponiblePortalCliente: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Disponible en Portal de Vendedor</p>
                    <p className="text-sm text-muted-foreground">Los vendedores podrán usar este método</p>
                  </div>
                  <Switch
                    checked={formData.disponiblePortalVendedor}
                    onCheckedChange={(checked) => setFormData({ ...formData, disponiblePortalVendedor: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Requiere Comprobante</p>
                    <p className="text-sm text-muted-foreground">El cliente debe subir comprobante de pago</p>
                  </div>
                  <Switch
                    checked={formData.requiereComprobante}
                    onCheckedChange={(checked) => setFormData({ ...formData, requiereComprobante: checked })}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleEdit}>Guardar Cambios</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar método de pago?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El método de pago "{selectedMetodo?.nombre}" será eliminado permanentemente.
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
    </ConfiguracionLayout>
  );
};

export default ConfigMetodosPago;
