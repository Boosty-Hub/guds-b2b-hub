import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Plus, 
  Search, 
  MoreHorizontal,
  Ticket,
  Percent,
  DollarSign,
  Calendar,
  Users,
  Copy,
  Edit,
  Trash2,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  Tag,
  ShoppingCart
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Cupon {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string;
  tipo: "porcentaje" | "monto_fijo" | "envio_gratis";
  valor: number;
  montoMinimo: number;
  montoMaximoDescuento: number | null;
  usosMaximos: number | null;
  usosActuales: number;
  usosPorCliente: number;
  fechaInicio: string;
  fechaFin: string;
  estado: "activo" | "inactivo" | "expirado" | "agotado";
  aplicaA: "todos" | "categoria" | "productos" | "clientes";
  clientesEspecificos: string[];
}

interface Descuento {
  id: string;
  nombre: string;
  descripcion: string;
  tipo: "porcentaje" | "monto_fijo" | "2x1" | "3x2";
  valor: number;
  aplicaA: "categoria" | "producto" | "cliente";
  objetivo: string;
  fechaInicio: string;
  fechaFin: string;
  estado: "activo" | "inactivo" | "programado";
  prioridad: number;
}

const cuponesData: Cupon[] = [
  {
    id: "CUP-001",
    codigo: "BIENVENIDO20",
    nombre: "Descuento de Bienvenida",
    descripcion: "20% de descuento para nuevos clientes",
    tipo: "porcentaje",
    valor: 20,
    montoMinimo: 500,
    montoMaximoDescuento: 1000,
    usosMaximos: 100,
    usosActuales: 45,
    usosPorCliente: 1,
    fechaInicio: "2024-01-01",
    fechaFin: "2024-03-31",
    estado: "activo",
    aplicaA: "todos",
    clientesEspecificos: [],
  },
  {
    id: "CUP-002",
    codigo: "ENVIOGRATIS",
    nombre: "Envío Gratis",
    descripcion: "Envío gratis en compras mayores a $1,000",
    tipo: "envio_gratis",
    valor: 0,
    montoMinimo: 1000,
    montoMaximoDescuento: null,
    usosMaximos: null,
    usosActuales: 128,
    usosPorCliente: 3,
    fechaInicio: "2024-01-01",
    fechaFin: "2024-12-31",
    estado: "activo",
    aplicaA: "todos",
    clientesEspecificos: [],
  },
  {
    id: "CUP-003",
    codigo: "MAYORISTA500",
    nombre: "Descuento Mayorista",
    descripcion: "$500 de descuento para clientes mayoristas",
    tipo: "monto_fijo",
    valor: 500,
    montoMinimo: 5000,
    montoMaximoDescuento: null,
    usosMaximos: 50,
    usosActuales: 50,
    usosPorCliente: 2,
    fechaInicio: "2024-01-01",
    fechaFin: "2024-02-28",
    estado: "agotado",
    aplicaA: "clientes",
    clientesEspecificos: ["Walmart", "Soriana", "Chedraui"],
  },
  {
    id: "CUP-004",
    codigo: "VERANO15",
    nombre: "Promoción Verano",
    descripcion: "15% en productos de temporada",
    tipo: "porcentaje",
    valor: 15,
    montoMinimo: 300,
    montoMaximoDescuento: 500,
    usosMaximos: 200,
    usosActuales: 0,
    usosPorCliente: 1,
    fechaInicio: "2024-06-01",
    fechaFin: "2024-08-31",
    estado: "inactivo",
    aplicaA: "categoria",
    clientesEspecificos: [],
  },
];

const descuentosData: Descuento[] = [
  {
    id: "DESC-001",
    nombre: "Descuento Aceites 10%",
    descripcion: "10% de descuento en toda la categoría de aceites",
    tipo: "porcentaje",
    valor: 10,
    aplicaA: "categoria",
    objetivo: "Aceites",
    fechaInicio: "2024-01-15",
    fechaFin: "2024-01-31",
    estado: "activo",
    prioridad: 1,
  },
  {
    id: "DESC-002",
    nombre: "2x1 en Arroz",
    descripcion: "Lleva 2 y paga 1 en arroz seleccionado",
    tipo: "2x1",
    valor: 0,
    aplicaA: "producto",
    objetivo: "Arroz Grano Largo 1kg",
    fechaInicio: "2024-01-10",
    fechaFin: "2024-01-20",
    estado: "activo",
    prioridad: 2,
  },
  {
    id: "DESC-003",
    nombre: "Descuento VIP Walmart",
    descripcion: "15% de descuento exclusivo para Walmart",
    tipo: "porcentaje",
    valor: 15,
    aplicaA: "cliente",
    objetivo: "Walmart",
    fechaInicio: "2024-01-01",
    fechaFin: "2024-12-31",
    estado: "activo",
    prioridad: 3,
  },
  {
    id: "DESC-004",
    nombre: "3x2 Enlatados",
    descripcion: "Lleva 3 y paga 2 en productos enlatados",
    tipo: "3x2",
    valor: 0,
    aplicaA: "categoria",
    objetivo: "Enlatados",
    fechaInicio: "2024-02-01",
    fechaFin: "2024-02-15",
    estado: "programado",
    prioridad: 1,
  },
];

const estadoCuponConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  activo: { label: "Activo", variant: "default" },
  inactivo: { label: "Inactivo", variant: "secondary" },
  expirado: { label: "Expirado", variant: "outline" },
  agotado: { label: "Agotado", variant: "destructive" },
};

const estadoDescuentoConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  activo: { label: "Activo", variant: "default" },
  inactivo: { label: "Inactivo", variant: "secondary" },
  programado: { label: "Programado", variant: "outline" },
};

const Cupones = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterEstado, setFilterEstado] = useState<string>("todos");
  const [isCreateCuponOpen, setIsCreateCuponOpen] = useState(false);
  const [isCreateDescuentoOpen, setIsCreateDescuentoOpen] = useState(false);
  const [selectedCupon, setSelectedCupon] = useState<Cupon | null>(null);
  const { toast } = useToast();

  // Form state for new coupon
  const [cuponForm, setCuponForm] = useState({
    codigo: "",
    nombre: "",
    descripcion: "",
    tipo: "porcentaje",
    valor: "",
    montoMinimo: "",
    montoMaximoDescuento: "",
    usosMaximos: "",
    usosPorCliente: "1",
    fechaInicio: "",
    fechaFin: "",
    aplicaA: "todos",
  });

  // Form state for new discount
  const [descuentoForm, setDescuentoForm] = useState({
    nombre: "",
    descripcion: "",
    tipo: "porcentaje",
    valor: "",
    aplicaA: "categoria",
    objetivo: "",
    fechaInicio: "",
    fechaFin: "",
    prioridad: "1",
  });

  const filteredCupones = cuponesData.filter((cupon) => {
    const matchesSearch =
      cupon.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cupon.nombre.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesEstado = filterEstado === "todos" || cupon.estado === filterEstado;
    return matchesSearch && matchesEstado;
  });

  const filteredDescuentos = descuentosData.filter((descuento) => {
    const matchesSearch =
      descuento.nombre.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesEstado = filterEstado === "todos" || descuento.estado === filterEstado;
    return matchesSearch && matchesEstado;
  });

  const handleCopyCodigo = (codigo: string) => {
    navigator.clipboard.writeText(codigo);
    toast({
      title: "Código copiado",
      description: `El código ${codigo} ha sido copiado al portapapeles`,
    });
  };

  const handleCreateCupon = () => {
    if (!cuponForm.codigo || !cuponForm.nombre || !cuponForm.valor) {
      toast({
        title: "Error",
        description: "Completa los campos requeridos",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Cupón Creado",
      description: `El cupón ${cuponForm.codigo} ha sido creado exitosamente`,
    });

    setCuponForm({
      codigo: "",
      nombre: "",
      descripcion: "",
      tipo: "porcentaje",
      valor: "",
      montoMinimo: "",
      montoMaximoDescuento: "",
      usosMaximos: "",
      usosPorCliente: "1",
      fechaInicio: "",
      fechaFin: "",
      aplicaA: "todos",
    });
    setIsCreateCuponOpen(false);
  };

  const handleCreateDescuento = () => {
    if (!descuentoForm.nombre || !descuentoForm.objetivo) {
      toast({
        title: "Error",
        description: "Completa los campos requeridos",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Descuento Creado",
      description: `El descuento "${descuentoForm.nombre}" ha sido creado exitosamente`,
    });

    setDescuentoForm({
      nombre: "",
      descripcion: "",
      tipo: "porcentaje",
      valor: "",
      aplicaA: "categoria",
      objetivo: "",
      fechaInicio: "",
      fechaFin: "",
      prioridad: "1",
    });
    setIsCreateDescuentoOpen(false);
  };

  const getTipoIcon = (tipo: string) => {
    switch (tipo) {
      case "porcentaje":
        return <Percent className="h-4 w-4" />;
      case "monto_fijo":
        return <DollarSign className="h-4 w-4" />;
      case "envio_gratis":
        return <ShoppingCart className="h-4 w-4" />;
      case "2x1":
      case "3x2":
        return <Tag className="h-4 w-4" />;
      default:
        return <Ticket className="h-4 w-4" />;
    }
  };

  const stats = {
    cuponesActivos: cuponesData.filter(c => c.estado === "activo").length,
    descuentosActivos: descuentosData.filter(d => d.estado === "activo").length,
    usosHoy: 23,
    ahorroTotal: 45680,
  };

  return (
    <MainLayout title="Cupones y Descuentos">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Ticket className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.cuponesActivos}</p>
                <p className="text-xs text-muted-foreground">Cupones Activos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <Percent className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.descuentosActivos}</p>
                <p className="text-xs text-muted-foreground">Descuentos Activos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.usosHoy}</p>
                <p className="text-xs text-muted-foreground">Usos Hoy</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">${stats.ahorroTotal.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Ahorro Total (Mes)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="cupones" className="space-y-6">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="cupones" className="gap-2">
              <Ticket className="h-4 w-4" />
              Cupones
            </TabsTrigger>
            <TabsTrigger value="descuentos" className="gap-2">
              <Percent className="h-4 w-4" />
              Descuentos
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Cupones Tab */}
        <TabsContent value="cupones" className="space-y-4">
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="flex flex-1 gap-4 w-full md:w-auto">
                  <div className="relative flex-1 md:max-w-sm">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por código o nombre..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Select value={filterEstado} onValueChange={setFilterEstado}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="activo">Activos</SelectItem>
                      <SelectItem value="inactivo">Inactivos</SelectItem>
                      <SelectItem value="expirado">Expirados</SelectItem>
                      <SelectItem value="agotado">Agotados</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="gap-2" onClick={() => setIsCreateCuponOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Nuevo Cupón
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle>Lista de Cupones ({filteredCupones.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Usos</TableHead>
                    <TableHead>Vigencia</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCupones.map((cupon) => (
                    <TableRow key={cupon.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
                            {cupon.codigo}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleCopyCodigo(cupon.codigo)}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{cupon.nombre}</p>
                          <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                            {cupon.descripcion}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getTipoIcon(cupon.tipo)}
                          <span className="text-sm capitalize">
                            {cupon.tipo.replace("_", " ")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">
                          {cupon.tipo === "porcentaje" ? `${cupon.valor}%` :
                           cupon.tipo === "monto_fijo" ? `$${cupon.valor}` : "Gratis"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <span className="font-medium">{cupon.usosActuales}</span>
                          <span className="text-muted-foreground">
                            {cupon.usosMaximos ? ` / ${cupon.usosMaximos}` : " (ilimitado)"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          <p>{cupon.fechaInicio}</p>
                          <p>{cupon.fechaFin}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={estadoCuponConfig[cupon.estado].variant}>
                          {estadoCuponConfig[cupon.estado].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setSelectedCupon(cupon)}>
                              <Eye className="h-4 w-4 mr-2" />
                              Ver Detalle
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Edit className="h-4 w-4 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopyCodigo(cupon.codigo)}>
                              <Copy className="h-4 w-4 mr-2" />
                              Copiar Código
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive">
                              <Trash2 className="h-4 w-4 mr-2" />
                              Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Descuentos Tab */}
        <TabsContent value="descuentos" className="space-y-4">
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="flex flex-1 gap-4 w-full md:w-auto">
                  <div className="relative flex-1 md:max-w-sm">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar descuento..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Select value={filterEstado} onValueChange={setFilterEstado}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="activo">Activos</SelectItem>
                      <SelectItem value="inactivo">Inactivos</SelectItem>
                      <SelectItem value="programado">Programados</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="gap-2" onClick={() => setIsCreateDescuentoOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Nuevo Descuento
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredDescuentos.map((descuento) => (
              <Card key={descuento.id} className="border-border">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      descuento.tipo === "porcentaje" ? "bg-emerald-500/10" :
                      descuento.tipo === "monto_fijo" ? "bg-blue-500/10" : "bg-purple-500/10"
                    }`}>
                      {getTipoIcon(descuento.tipo)}
                    </div>
                    <Badge variant={estadoDescuentoConfig[descuento.estado].variant}>
                      {estadoDescuentoConfig[descuento.estado].label}
                    </Badge>
                  </div>
                  
                  <h3 className="font-semibold mb-1">{descuento.nombre}</h3>
                  <p className="text-sm text-muted-foreground mb-3">{descuento.descripcion}</p>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Aplica a:</span>
                      <span className="font-medium">{descuento.objetivo}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Valor:</span>
                      <span className="font-medium">
                        {descuento.tipo === "porcentaje" ? `${descuento.valor}%` :
                         descuento.tipo === "monto_fijo" ? `$${descuento.valor}` : descuento.tipo.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Vigencia:</span>
                      <span className="text-xs">{descuento.fechaInicio} - {descuento.fechaFin}</span>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                    <Button variant="outline" size="sm" className="flex-1">
                      <Edit className="h-4 w-4 mr-1" />
                      Editar
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Create Cupon Dialog */}
      <Dialog open={isCreateCuponOpen} onOpenChange={setIsCreateCuponOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Crear Nuevo Cupón</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Código del Cupón *</Label>
                <Input
                  placeholder="Ej: DESCUENTO20"
                  value={cuponForm.codigo}
                  onChange={(e) => setCuponForm({ ...cuponForm, codigo: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="space-y-2">
                <Label>Nombre *</Label>
                <Input
                  placeholder="Nombre del cupón"
                  value={cuponForm.nombre}
                  onChange={(e) => setCuponForm({ ...cuponForm, nombre: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descripción</Label>
              <Textarea
                placeholder="Descripción del cupón..."
                value={cuponForm.descripcion}
                onChange={(e) => setCuponForm({ ...cuponForm, descripcion: e.target.value })}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo de Descuento *</Label>
                <Select
                  value={cuponForm.tipo}
                  onValueChange={(value) => setCuponForm({ ...cuponForm, tipo: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="porcentaje">Porcentaje (%)</SelectItem>
                    <SelectItem value="monto_fijo">Monto Fijo ($)</SelectItem>
                    <SelectItem value="envio_gratis">Envío Gratis</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Valor *</Label>
                <Input
                  type="number"
                  placeholder={cuponForm.tipo === "porcentaje" ? "Ej: 20" : "Ej: 500"}
                  value={cuponForm.valor}
                  onChange={(e) => setCuponForm({ ...cuponForm, valor: e.target.value })}
                  disabled={cuponForm.tipo === "envio_gratis"}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Monto Mínimo de Compra</Label>
                <Input
                  type="number"
                  placeholder="Ej: 500"
                  value={cuponForm.montoMinimo}
                  onChange={(e) => setCuponForm({ ...cuponForm, montoMinimo: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Descuento Máximo</Label>
                <Input
                  type="number"
                  placeholder="Sin límite"
                  value={cuponForm.montoMaximoDescuento}
                  onChange={(e) => setCuponForm({ ...cuponForm, montoMaximoDescuento: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Usos Máximos Totales</Label>
                <Input
                  type="number"
                  placeholder="Ilimitado"
                  value={cuponForm.usosMaximos}
                  onChange={(e) => setCuponForm({ ...cuponForm, usosMaximos: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Usos por Cliente</Label>
                <Input
                  type="number"
                  placeholder="1"
                  value={cuponForm.usosPorCliente}
                  onChange={(e) => setCuponForm({ ...cuponForm, usosPorCliente: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha de Inicio *</Label>
                <Input
                  type="date"
                  value={cuponForm.fechaInicio}
                  onChange={(e) => setCuponForm({ ...cuponForm, fechaInicio: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Fecha de Fin *</Label>
                <Input
                  type="date"
                  value={cuponForm.fechaFin}
                  onChange={(e) => setCuponForm({ ...cuponForm, fechaFin: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Aplica a</Label>
              <Select
                value={cuponForm.aplicaA}
                onValueChange={(value) => setCuponForm({ ...cuponForm, aplicaA: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los productos</SelectItem>
                  <SelectItem value="categoria">Categoría específica</SelectItem>
                  <SelectItem value="productos">Productos específicos</SelectItem>
                  <SelectItem value="clientes">Clientes específicos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateCuponOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateCupon}>Crear Cupón</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Descuento Dialog */}
      <Dialog open={isCreateDescuentoOpen} onOpenChange={setIsCreateDescuentoOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Crear Nuevo Descuento</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Nombre del Descuento *</Label>
              <Input
                placeholder="Ej: Descuento Verano"
                value={descuentoForm.nombre}
                onChange={(e) => setDescuentoForm({ ...descuentoForm, nombre: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Descripción</Label>
              <Textarea
                placeholder="Descripción del descuento..."
                value={descuentoForm.descripcion}
                onChange={(e) => setDescuentoForm({ ...descuentoForm, descripcion: e.target.value })}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select
                  value={descuentoForm.tipo}
                  onValueChange={(value) => setDescuentoForm({ ...descuentoForm, tipo: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="porcentaje">Porcentaje (%)</SelectItem>
                    <SelectItem value="monto_fijo">Monto Fijo ($)</SelectItem>
                    <SelectItem value="2x1">2x1</SelectItem>
                    <SelectItem value="3x2">3x2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Valor</Label>
                <Input
                  type="number"
                  placeholder="Ej: 15"
                  value={descuentoForm.valor}
                  onChange={(e) => setDescuentoForm({ ...descuentoForm, valor: e.target.value })}
                  disabled={descuentoForm.tipo === "2x1" || descuentoForm.tipo === "3x2"}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Aplica a *</Label>
                <Select
                  value={descuentoForm.aplicaA}
                  onValueChange={(value) => setDescuentoForm({ ...descuentoForm, aplicaA: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="categoria">Categoría</SelectItem>
                    <SelectItem value="producto">Producto</SelectItem>
                    <SelectItem value="cliente">Cliente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Objetivo *</Label>
                <Input
                  placeholder={
                    descuentoForm.aplicaA === "categoria" ? "Ej: Aceites" :
                    descuentoForm.aplicaA === "producto" ? "Ej: Arroz 1kg" : "Ej: Walmart"
                  }
                  value={descuentoForm.objetivo}
                  onChange={(e) => setDescuentoForm({ ...descuentoForm, objetivo: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha de Inicio *</Label>
                <Input
                  type="date"
                  value={descuentoForm.fechaInicio}
                  onChange={(e) => setDescuentoForm({ ...descuentoForm, fechaInicio: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Fecha de Fin *</Label>
                <Input
                  type="date"
                  value={descuentoForm.fechaFin}
                  onChange={(e) => setDescuentoForm({ ...descuentoForm, fechaFin: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Prioridad</Label>
              <Select
                value={descuentoForm.prioridad}
                onValueChange={(value) => setDescuentoForm({ ...descuentoForm, prioridad: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Alta (1)</SelectItem>
                  <SelectItem value="2">Media (2)</SelectItem>
                  <SelectItem value="3">Baja (3)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDescuentoOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateDescuento}>Crear Descuento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cupon Detail Dialog */}
      <Dialog open={!!selectedCupon} onOpenChange={() => setSelectedCupon(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle del Cupón</DialogTitle>
          </DialogHeader>
          {selectedCupon && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <code className="bg-muted px-4 py-2 rounded text-lg font-mono font-bold">
                  {selectedCupon.codigo}
                </code>
                <Badge variant={estadoCuponConfig[selectedCupon.estado].variant} className="text-base">
                  {estadoCuponConfig[selectedCupon.estado].label}
                </Badge>
              </div>

              <div>
                <h3 className="font-semibold text-lg">{selectedCupon.nombre}</h3>
                <p className="text-muted-foreground">{selectedCupon.descripcion}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Card className="border-border">
                  <CardContent className="p-4 text-center">
                    <p className="text-3xl font-bold text-primary">
                      {selectedCupon.tipo === "porcentaje" ? `${selectedCupon.valor}%` :
                       selectedCupon.tipo === "monto_fijo" ? `$${selectedCupon.valor}` : "Gratis"}
                    </p>
                    <p className="text-sm text-muted-foreground">Descuento</p>
                  </CardContent>
                </Card>
                <Card className="border-border">
                  <CardContent className="p-4 text-center">
                    <p className="text-3xl font-bold">
                      {selectedCupon.usosActuales}
                      <span className="text-lg text-muted-foreground">
                        {selectedCupon.usosMaximos ? ` / ${selectedCupon.usosMaximos}` : ""}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">Usos</p>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monto mínimo:</span>
                  <span className="font-medium">${selectedCupon.montoMinimo}</span>
                </div>
                {selectedCupon.montoMaximoDescuento && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Descuento máximo:</span>
                    <span className="font-medium">${selectedCupon.montoMaximoDescuento}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Usos por cliente:</span>
                  <span className="font-medium">{selectedCupon.usosPorCliente}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vigencia:</span>
                  <span className="font-medium">{selectedCupon.fechaInicio} - {selectedCupon.fechaFin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Aplica a:</span>
                  <span className="font-medium capitalize">{selectedCupon.aplicaA}</span>
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <Button className="flex-1" onClick={() => handleCopyCodigo(selectedCupon.codigo)}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copiar Código
                </Button>
                <Button variant="outline" className="flex-1">
                  <Edit className="h-4 w-4 mr-2" />
                  Editar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Cupones;
