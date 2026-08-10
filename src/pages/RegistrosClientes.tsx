import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Search,
  MoreHorizontal,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  Building2,
  User,
  Mail,
  Phone,
  MapPin,
  FileText,
  UserPlus,
  Filter
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, RegistroCliente } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

const statusConfig = {
  pendiente: { label: "Pendiente", color: "bg-yellow-500", icon: Clock },
  aprobado: { label: "Aprobado", color: "bg-green-500", icon: CheckCircle },
  rechazado: { label: "Rechazado", color: "bg-red-500", icon: XCircle },
};

const RegistrosClientes = () => {
  const { registros, aprobarRegistro, rechazarRegistro, getPendingRegistros } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedRegistro, setSelectedRegistro] = useState<RegistroCliente | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [isApproveOpen, setIsApproveOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [approving, setApproving] = useState(false);
  // Credenciales generadas al aprobar (para comunicárselas al cliente)
  const [credenciales, setCredenciales] = useState<{ email: string; password: string } | null>(null);
  const { toast } = useToast();

  const pendingCount = getPendingRegistros().length;

  const filteredRegistros = registros.filter((reg) => {
    const matchesSearch = 
      reg.nombreNegocio.toLowerCase().includes(searchTerm.toLowerCase()) ||
      reg.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      reg.nombreContacto.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || reg.estado === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleApprove = async () => {
    if (!selectedRegistro) return;
    setApproving(true);
    const res = await aprobarRegistro(selectedRegistro.id);
    setApproving(false);

    if (!res.success) {
      toast({
        title: "No se pudo aprobar",
        description: res.error || "Ocurrió un error al aprobar el registro",
        variant: "destructive",
      });
      return;
    }
    const negocio = selectedRegistro.nombreNegocio;
    setIsApproveOpen(false);
    setSelectedRegistro(null);
    // Mostrar las credenciales temporales para comunicárselas al cliente
    if (res.email && res.password) {
      setCredenciales({ email: res.email, password: res.password });
    }
    toast({
      title: "Registro Aprobado",
      description: `${negocio} ha sido aprobado como cliente`,
    });
  };

  const handleReject = () => {
    if (!selectedRegistro) return;
    rechazarRegistro(selectedRegistro.id, rejectReason);
    toast({
      title: "Registro Rechazado",
      description: `${selectedRegistro.nombreNegocio} ha sido rechazado`,
      variant: "destructive",
    });
    setIsRejectOpen(false);
    setRejectReason("");
    setSelectedRegistro(null);
  };

  const openViewDialog = (registro: RegistroCliente) => {
    setSelectedRegistro(registro);
    setIsViewOpen(true);
  };

  const handleViewDocumento = async (path: string) => {
    const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 120);
    if (error || !data?.signedUrl) {
      toast({ title: "No se pudo abrir el documento", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <MainLayout title="Registros de Clientes">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <UserPlus className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{registros.length}</p>
                <p className="text-xs text-muted-foreground">Total Solicitudes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border border-yellow-500/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-yellow-500/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{pendingCount}</p>
                <p className="text-xs text-muted-foreground">Pendientes</p>
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
                <p className="text-2xl font-bold">
                  {registros.filter(r => r.estado === "aprobado").length}
                </p>
                <p className="text-xs text-muted-foreground">Aprobados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {registros.filter(r => r.estado === "rechazado").length}
                </p>
                <p className="text-xs text-muted-foreground">Rechazados</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por negocio, email o contacto..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {["all", "pendiente", "aprobado", "rechazado"].map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(status)}
            >
              {status === "all" ? "Todos" : statusConfig[status as keyof typeof statusConfig]?.label}
              {status === "pendiente" && pendingCount > 0 && (
                <Badge className="ml-2 bg-yellow-500">{pendingCount}</Badge>
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card className="border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Negocio</TableHead>
                <TableHead>Contacto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Ciudad</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRegistros.map((registro) => {
                const StatusIcon = statusConfig[registro.estado].icon;
                return (
                  <TableRow key={registro.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{registro.nombreNegocio}</p>
                        <p className="text-sm text-muted-foreground">
                          {registro.rif}
                          {registro.contribuyenteEspecial && " · Contrib. especial"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{registro.nombreContacto}</p>
                        <p className="text-sm text-muted-foreground">{registro.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>{registro.tipoNegocio}</TableCell>
                    <TableCell>{registro.ciudad}</TableCell>
                    <TableCell>{registro.fechaRegistro}</TableCell>
                    <TableCell>
                      <Badge className={`${statusConfig[registro.estado].color} text-white`}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {statusConfig[registro.estado].label}
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
                          <DropdownMenuItem onClick={() => openViewDialog(registro)}>
                            <Eye className="h-4 w-4 mr-2" />
                            Ver Detalles
                          </DropdownMenuItem>
                          {registro.estado === "pendiente" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-green-600"
                                onClick={() => {
                                  setSelectedRegistro(registro);
                                  setIsApproveOpen(true);
                                }}
                              >
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Aprobar
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                className="text-red-600"
                                onClick={() => {
                                  setSelectedRegistro(registro);
                                  setIsRejectOpen(true);
                                }}
                              >
                                <XCircle className="h-4 w-4 mr-2" />
                                Rechazar
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* View Dialog */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalles del Registro</DialogTitle>
          </DialogHeader>
          {selectedRegistro && (
            <div className="space-y-6">
              {/* Status */}
              <div className="flex items-center justify-between">
                <Badge className={`${statusConfig[selectedRegistro.estado].color} text-white`}>
                  {statusConfig[selectedRegistro.estado].label}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Registrado: {selectedRegistro.fechaRegistro}
                </span>
              </div>

              {/* Business Info */}
              <div className="space-y-3">
                <h4 className="font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Información del Negocio
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Razón Social</p>
                    <p className="font-medium">{selectedRegistro.nombreNegocio}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Tipo</p>
                    <p className="font-medium">{selectedRegistro.tipoNegocio}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">RIF</p>
                    <p className="font-medium">{selectedRegistro.rif}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Contribuyente especial</p>
                    <p className="font-medium">{selectedRegistro.contribuyenteEspecial ? "Sí" : "No"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground mb-1">Documento RIF</p>
                    {selectedRegistro.rifDocumentoPath ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewDocumento(selectedRegistro.rifDocumentoPath!)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Ver documento
                      </Button>
                    ) : (
                      <p className="font-medium text-muted-foreground">No adjuntado</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="space-y-3">
                <h4 className="font-semibold flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Información de Contacto
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Persona de Contacto</p>
                    <p className="font-medium">{selectedRegistro.nombreContacto}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Teléfono</p>
                    <p className="font-medium">{selectedRegistro.telefono}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Email</p>
                    <p className="font-medium">{selectedRegistro.email}</p>
                  </div>
                </div>
              </div>

              {/* Address */}
              <div className="space-y-3">
                <h4 className="font-semibold flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Dirección
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Fiscal</p>
                    <p className="font-medium">{selectedRegistro.direccion}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Entrega</p>
                    <p className="font-medium">{selectedRegistro.direccionEntrega || "Misma que la fiscal"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Ciudad</p>
                    <p className="font-medium">{selectedRegistro.ciudad}</p>
                  </div>
                </div>
              </div>

              {/* Notes (if rejected) */}
              {selectedRegistro.notas && (
                <div className="space-y-3">
                  <h4 className="font-semibold flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Notas
                  </h4>
                  <p className="text-sm bg-muted p-3 rounded-lg">{selectedRegistro.notas}</p>
                </div>
              )}

              {/* Actions for pending */}
              {selectedRegistro.estado === "pendiente" && (
                <div className="flex gap-3 pt-4 border-t">
                  <Button
                    variant="outline"
                    className="flex-1 text-red-600 border-red-600 hover:bg-red-50"
                    onClick={() => {
                      setIsViewOpen(false);
                      setIsRejectOpen(true);
                    }}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Rechazar
                  </Button>
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700"
                    onClick={() => {
                      setIsViewOpen(false);
                      setIsApproveOpen(true);
                    }}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Aprobar
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Approve Confirmation */}
      <AlertDialog open={isApproveOpen} onOpenChange={setIsApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Aprobar este registro?</AlertDialogTitle>
            <AlertDialogDescription>
              Se creará la cuenta de cliente para "{selectedRegistro?.nombreNegocio}" y se generará
              una contraseña temporal. Deberás comunicársela al cliente (no se envía por email).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleApprove} disabled={approving} className="bg-green-600 hover:bg-green-700">
              {approving ? "Aprobando..." : "Aprobar Cliente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Credenciales generadas */}
      <Dialog open={!!credenciales} onOpenChange={(o) => { if (!o) setCredenciales(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cliente aprobado — credenciales de acceso</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <p className="text-muted-foreground">
              Comunícale estas credenciales al cliente por un canal seguro (WhatsApp, llamada).
              Esta contraseña temporal <b>solo se muestra una vez</b>.
            </p>
            <div className="rounded-lg border border-border bg-muted p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Email</span>
                <code className="font-medium">{credenciales?.email}</code>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Contraseña temporal</span>
                <code className="font-bold text-primary">{credenciales?.password}</code>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(`Email: ${credenciales?.email}\nContraseña temporal: ${credenciales?.password}`);
                toast({ title: "Copiado", description: "Credenciales copiadas al portapapeles" });
              }}
            >
              Copiar
            </Button>
            <Button onClick={() => setCredenciales(null)}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar Registro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              ¿Estás seguro de rechazar el registro de "{selectedRegistro?.nombreNegocio}"?
            </p>
            <div className="space-y-2">
              <Label>Motivo del rechazo (opcional)</Label>
              <Textarea
                placeholder="Ingresa el motivo del rechazo..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleReject}>
              Rechazar Registro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default RegistrosClientes;
