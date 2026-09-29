import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  Building2,
  User,
  MapPin,
  FileText,
  ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useAuth, RegistroCliente } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { AprobarRegistroDialog } from "@/components/clientes/AprobarRegistroDialog";

const statusConfig = {
  pendiente: { label: "Pendiente", color: "bg-yellow-500", icon: Clock },
  aprobado: { label: "Aprobado", color: "bg-green-500", icon: CheckCircle },
  rechazado: { label: "Rechazado", color: "bg-red-500", icon: XCircle },
};

const RegistrosClientes = () => {
  const { registros, aprobarRegistro, rechazarRegistro, getPendingRegistros, refreshRegistros } = useAuth();
  // Las solicitudes se cargan al abrir esta pantalla (ya no en cada arranque de la app)
  useEffect(() => { refreshRegistros(); }, [refreshRegistros]);
  const { empresas } = useEmpresa();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedRegistro, setSelectedRegistro] = useState<RegistroCliente | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [isApproveOpen, setIsApproveOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // Credenciales generadas al aprobar (para comunicárselas al cliente) y a qué cliente quedó ligado
  const [credenciales, setCredenciales] = useState<{ email: string; password: string; clienteId?: string; existente: boolean } | null>(null);
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

  const pagination = usePagination(filteredRegistros, 50);

  const handleApprove = async ({ estado, vendedorId }: { estado: string | null; vendedorId: string | null }) => {
    if (!selectedRegistro) return;
    // El estado de Venezuela (Odoo lo exige para crear el cliente) se guarda en el registro antes de aprobar
    if (estado && estado !== selectedRegistro.estadoVe) {
      const { error } = await supabase.from("registros_clientes").update({ estado_ve: estado }).eq("id", selectedRegistro.id);
      if (error) {
        toast({ title: "No se pudo guardar el estado", description: error.message, variant: "destructive" });
        return;
      }
    }
    const res = await aprobarRegistro(selectedRegistro.id, vendedorId ? { vendedor_id: vendedorId } : undefined);

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
    // ¿Quedó ligado a un cliente que ya existía? (lo anota la aprobación en el registro)
    const { data: reg } = await supabase.from("registros_clientes").select("uso_cliente_existente").eq("id", selectedRegistro.id).maybeSingle();
    const existente = !!(reg as { uso_cliente_existente?: boolean } | null)?.uso_cliente_existente;
    // Mostrar las credenciales temporales para comunicárselas al cliente
    if (res.email && res.password) {
      setCredenciales({ email: res.email, password: res.password, clienteId: res.clienteId, existente });
    }
    toast({
      title: "Registro Aprobado",
      description: existente ? `${negocio}: el acceso quedó ligado al cliente que ya existía` : `${negocio} ha sido aprobado como cliente; su alta en Odoo está en curso`,
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
      <KpiStrip
        items={[
          { label: "Total Solicitudes", valor: registros.length, tono: "primario" },
          { label: "Pendientes", valor: pendingCount, tono: "alerta" },
          { label: "Aprobados", valor: registros.filter(r => r.estado === "aprobado").length, tono: "positivo" },
          { label: "Rechazados", valor: registros.filter(r => r.estado === "rechazado").length, tono: "negativo" },
        ]}
      />

      {/* Filters */}
      <BarraLista
        busqueda={searchTerm}
        onBusqueda={setSearchTerm}
        placeholder="Buscar por negocio, email o contacto..."
        contador={`${filteredRegistros.length} registros`}
        filtros={
          <div className="flex flex-wrap gap-1.5">
            {["all", "pendiente", "aprobado", "rechazado"].map((status) => (
              <Button
                key={status}
                variant={statusFilter === status ? "default" : "outline"}
                size="sm"
                className="h-8 text-[13px]"
                onClick={() => setStatusFilter(status)}
              >
                {status === "all" ? "Todos" : statusConfig[status as keyof typeof statusConfig]?.label}
                {status === "pendiente" && pendingCount > 0 && (
                  <Badge className="ml-1.5 bg-yellow-500">{pendingCount}</Badge>
                )}
              </Button>
            ))}
          </div>
        }
      />

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Negocio</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Ciudad</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.pageItems.map((registro) => {
              const StatusIcon = statusConfig[registro.estado].icon;
              return (
                <TableRow
                  key={registro.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openViewDialog(registro)}
                >
                  <TableCell>
                    <div className="flex min-w-0 items-center whitespace-nowrap">
                      <span className="max-w-[260px] truncate font-medium" title={registro.nombreNegocio}>{registro.nombreNegocio}</span>
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground">{registro.rif}</span>
                      {registro.contribuyenteEspecial && <span className="ml-1.5 text-xs text-muted-foreground">· Contrib. especial</span>}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate whitespace-nowrap" title={registro.nombreContacto}>{registro.nombreContacto}</TableCell>
                  <TableCell className="max-w-[220px] truncate whitespace-nowrap text-muted-foreground" title={registro.email}>{registro.email}</TableCell>
                  <TableCell className="whitespace-nowrap">{registro.tipoNegocio}</TableCell>
                  <TableCell className="whitespace-nowrap">{registro.ciudad}</TableCell>
                  <TableCell className="whitespace-nowrap">{registro.fechaRegistro}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge className={`${statusConfig[registro.estado].color} text-white`}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {statusConfig[registro.estado].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {registro.estado === "pendiente" && (
                      <div className="flex justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-green-600 hover:text-green-700"
                          title="Aprobar"
                          onClick={() => {
                            setSelectedRegistro(registro);
                            setIsApproveOpen(true);
                          }}
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-600 hover:text-red-700"
                          title="Rechazar"
                          onClick={() => {
                            setSelectedRegistro(registro);
                            setIsRejectOpen(true);
                          }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <DataTablePagination pagination={pagination} />
      </div>

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
                    <p className="text-muted-foreground">Quiere comprar con</p>
                    <p className="font-medium">{empresas.find((e) => e.id === selectedRegistro.empresaId)?.nombre_corto || "Sin indicar (se crea en la empresa activa)"}</p>
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

              {selectedRegistro.estado === "aprobado" && selectedRegistro.clienteCreadoId && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  <span className="text-muted-foreground">{selectedRegistro.usoClienteExistente ? "Quedó ligado a un cliente que ya existía (mismo RIF o nombre)" : "Cliente creado al aprobar"}</span>
                  <Link to={`/admin/clientes/${selectedRegistro.clienteCreadoId}`} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline">
                    Ver cliente y su estado en Odoo <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}

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

      {/* Aprobación: qué pasará (ya existe / enlazar / crear en Odoo), estado y vendedor */}
      <AprobarRegistroDialog registro={selectedRegistro} open={isApproveOpen} onOpenChange={setIsApproveOpen} onAprobar={handleApprove} />

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
            {credenciales?.clienteId && (
              <p className="text-xs text-muted-foreground">
                {credenciales.existente
                  ? "No se creó otro cliente: el acceso quedó ligado al cliente que ya existía con ese RIF o nombre. "
                  : "El cliente se está creando (o enlazando) en Odoo en segundo plano. "}
                <Link to={`/admin/clientes/${credenciales.clienteId}`} className="font-medium text-primary underline-offset-2 hover:underline">Ver su ficha y el estado en Odoo</Link>
              </p>
            )}
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
