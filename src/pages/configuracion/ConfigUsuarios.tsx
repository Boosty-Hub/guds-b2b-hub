import { useState, useEffect } from "react";
import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  UserPlus,
  Shield,
  Users,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  Save
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase, Rol, Modulo, Permiso, type Empresa } from "@/lib/supabase";
import { EmpresaDistintivo } from "@/components/EmpresaSelector";
import { UsuarioEmpresasField, guardarEmpresasUsuario, type EmpresasAsignadas } from "@/components/configuracion/UsuarioEmpresasField";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";

interface UsuarioConRol {
  id: string;
  email: string;
  nombre: string;
  apellido: string | null;
  telefono: string | null;
  role: string;
  rol_id: string | null;
  cliente_id: string | null;
  activo: boolean;
  created_at: string;
  rol?: Rol;
  cliente?: {
    nombre_negocio: string;
  };
}

interface PermisoConModulo extends Permiso {
  modulo: Modulo;
}

// Traduce el nombre de tabla de la FK que bloqueó el borrado a una razón legible.
const RAZON_POR_TABLA: Record<string, string> = {
  clientes: "tiene clientes asignados como vendedor",
  registros_clientes: "revisó solicitudes de registro de clientes",
  ordenes: "tiene órdenes registradas a su nombre",
  pagos: "verificó pagos de clientes",
  entregas: "tiene entregas asignadas como repartidor",
  movimientos_inventario: "registró movimientos de inventario",
  metas_vendedor: "tiene metas de vendedor cargadas",
  pago_facturas: "aplicó pagos a facturas",
  declaraciones_consignacion: "declaró o revisó ventas en consignación",
};

/** Arma un mensaje descriptivo para el popup de error al eliminar un usuario. */
function describirErrorEliminar(error: { code?: string; message: string; details?: string | null }, nombre: string): string {
  if (error.code === "23503") {
    const fuente = error.details || error.message;
    const tabla = fuente.match(/table "(\w+)"/)?.[1];
    const razon = (tabla && RAZON_POR_TABLA[tabla]) || "tiene actividad registrada en el sistema";
    return `No se puede eliminar a ${nombre} porque ${razon}. Para retirarlo sin perder ese historial, desactivalo en vez de eliminarlo: dejará de poder ingresar pero sus registros se conservan.`;
  }
  return `No se pudo eliminar a ${nombre}: ${error.message}`;
}

const ConfigUsuarios = () => {
  const [usuarios, setUsuarios] = useState<UsuarioConRol[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [modulos, setModulos] = useState<Modulo[]>([]);
  const [permisos, setPermisos] = useState<PermisoConModulo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRol, setFilterRol] = useState("todos");
  
  // Dialogs
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [isDeleteUserOpen, setIsDeleteUserOpen] = useState(false);
  const [isCreateRolOpen, setIsCreateRolOpen] = useState(false);
  const [isEditRolOpen, setIsEditRolOpen] = useState(false);
  const [isDeleteRolOpen, setIsDeleteRolOpen] = useState(false);
  
  const [selectedUsuario, setSelectedUsuario] = useState<UsuarioConRol | null>(null);
  const [selectedRol, setSelectedRol] = useState<Rol | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  // Credenciales temporales del usuario recién creado
  const [credencialesNuevo, setCredencialesNuevo] = useState<{ email: string; password: string } | null>(null);
  // Popup descriptivo cuando falla el borrado de un usuario (FK u otro error)
  const [errorEliminarUsuario, setErrorEliminarUsuario] = useState<string | null>(null);
  const { toast } = useToast();

  // Form states
  const [userForm, setUserForm] = useState({
    nombre: "",
    apellido: "",
    email: "",
    telefono: "",
    rol_id: "",
    password: "",
  });

  const [rolForm, setRolForm] = useState({
    nombre: "",
    descripcion: "",
    color: "bg-gray-500",
  });

  // Multiempresa: empresas de cada usuario
  const { empresaActiva } = useEmpresa();
  const [empresasTodas, setEmpresasTodas] = useState<Empresa[]>([]);
  const [asignaciones, setAsignaciones] = useState<Record<string, { empresa_id: string; por_defecto: boolean }[]>>({});
  const [empresasForm, setEmpresasForm] = useState<EmpresasAsignadas>({ ids: [], defecto: null });
  const empresasPorDefecto = (): EmpresasAsignadas => {
    const ids = empresaActiva ? [empresaActiva.id] : empresasTodas.map((e) => e.id);
    return { ids, defecto: ids[0] ?? null };
  };

  const [rolPermisos, setRolPermisos] = useState<Record<string, { ver: boolean; crear: boolean; editar: boolean; eliminar: boolean }>>({});

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [usuariosRes, rolesRes, modulosRes, empresasRes, asignacionesRes] = await Promise.all([
      supabase.from('usuarios').select('*, rol:roles(*)').order('nombre'),
      supabase.from('roles').select('*').order('nombre'),
      supabase.from('modulos').select('*').eq('activo', true).order('orden'),
      supabase.from('empresas').select('*').eq('activo', true).order('orden'),
      supabase.from('usuario_empresas').select('usuario_id, empresa_id, por_defecto'),
    ]);
    if (empresasRes.data) setEmpresasTodas(empresasRes.data as Empresa[]);
    if (asignacionesRes.data) {
      const mapa: Record<string, { empresa_id: string; por_defecto: boolean }[]> = {};
      for (const a of asignacionesRes.data) (mapa[a.usuario_id] ??= []).push({ empresa_id: a.empresa_id, por_defecto: a.por_defecto });
      setAsignaciones(mapa);
    }
    
    console.log('Usuarios response:', usuariosRes);
    
    if (usuariosRes.error) {
      console.error('Error fetching usuarios:', usuariosRes.error);
    }
    
    if (usuariosRes.data) {
      // Fetch client names separately for users with cliente_id
      const usersWithClients = await Promise.all(
        usuariosRes.data.map(async (user) => {
          if (user.cliente_id) {
            const { data: clienteData } = await supabase
              .from('clientes')
              .select('nombre_negocio')
              .eq('id', user.cliente_id)
              .single();
            return { ...user, cliente: clienteData };
          }
          return { ...user, cliente: null };
        })
      );
      setUsuarios(usersWithClients);
    }
    if (rolesRes.data) setRoles(rolesRes.data);
    if (modulosRes.data) setModulos(modulosRes.data);
    setLoading(false);
  };

  const fetchPermisosForRol = async (rolId: string) => {
    const { data } = await supabase
      .from('permisos')
      .select('*, modulo:modulos(*)')
      .eq('rol_id', rolId);
    
    if (data) {
      setPermisos(data);
      // Inicializar el estado de permisos
      const permisosMap: Record<string, { ver: boolean; crear: boolean; editar: boolean; eliminar: boolean }> = {};
      modulos.forEach(m => {
        const permiso = data.find(p => p.modulo_id === m.id);
        permisosMap[m.id] = {
          ver: permiso?.puede_ver || false,
          crear: permiso?.puede_crear || false,
          editar: permiso?.puede_editar || false,
          eliminar: permiso?.puede_eliminar || false,
        };
      });
      setRolPermisos(permisosMap);
    }
  };

  const resetUserForm = () => {
    setUserForm({ nombre: "", apellido: "", email: "", telefono: "", rol_id: "", password: "" });
    setEmpresasForm(empresasPorDefecto());
  };

  const resetRolForm = () => {
    setRolForm({ nombre: "", descripcion: "", color: "bg-gray-500" });
    setRolPermisos({});
  };

  // User CRUD
  const handleCreateUser = async () => {
    if (!userForm.nombre || !userForm.email || !userForm.rol_id) {
      toast({ title: "Error", description: "Completa nombre, email y rol", variant: "destructive" });
      return;
    }
    if (!empresasForm.ids.length) {
      toast({ title: "Error", description: "Asigna al menos una empresa", variant: "destructive" });
      return;
    }
    if (!userForm.password || userForm.password.length < 6) {
      toast({ title: "Error", description: "La contraseña debe tener al menos 6 caracteres", variant: "destructive" });
      return;
    }

    const rol = roles.find(r => r.id === userForm.rol_id);
    const roleEnum: 'admin' | 'vendedor' | 'delivery' | 'cliente' =
      rol?.nombre.toLowerCase() === 'administrador' ? 'admin' :
      rol?.nombre.toLowerCase() === 'vendedor' ? 'vendedor' :
      rol?.nombre.toLowerCase() === 'delivery' ? 'delivery' : 'cliente';

    // Crear la cuenta en el servidor (sin signUp en el navegador, que cerraría
    // la sesión del admin). Devuelve una contraseña temporal para comunicar.
    // p_rol_id va directo en la misma llamada — evita el update de enlace posterior
    // que, si fallaba, dejaba el usuario creado pero "Sin rol" (bug real de Fase 14).
    const { data, error } = await supabase.rpc('crear_usuario_admin', {
      p_email: userForm.email,
      p_nombre: userForm.nombre,
      p_apellido: userForm.apellido || null,
      p_role: roleEnum,
      p_telefono: userForm.telefono || null,
      p_cliente_id: null,
      p_password: userForm.password,
      p_rol_id: userForm.rol_id,
    });

    if (error) {
      toast({ title: "No se pudo crear el usuario", description: error.message, variant: "destructive" });
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row?.usuario_id) {
      const errorEmpresas = await guardarEmpresasUsuario(row.usuario_id, empresasForm);
      if (errorEmpresas) toast({ title: "Usuario creado sin empresas", description: errorEmpresas.message, variant: "destructive" });
    }
    resetUserForm();
    setIsCreateUserOpen(false);
    fetchData();
    if (row?.password_temporal) {
      setCredencialesNuevo({ email: userForm.email, password: row.password_temporal });
    }
    toast({ title: "Usuario Creado", description: `${userForm.nombre} ha sido creado exitosamente` });
  };

  const handleEditUser = async () => {
    if (!selectedUsuario) return;
    if (!userForm.rol_id) {
      toast({ title: "Error", description: "Selecciona un rol para el usuario", variant: "destructive" });
      return;
    }
    if (!empresasForm.ids.length) {
      toast({ title: "Error", description: "Asigna al menos una empresa", variant: "destructive" });
      return;
    }

    const rol = roles.find(r => r.id === userForm.rol_id);
    const { error } = await supabase
      .from('usuarios')
      .update({
        nombre: userForm.nombre,
        apellido: userForm.apellido || null,
        telefono: userForm.telefono || null,
        rol_id: userForm.rol_id || null,
        role: rol?.nombre.toLowerCase() === 'administrador' ? 'admin' : 
              rol?.nombre.toLowerCase() === 'vendedor' ? 'vendedor' : 
              rol?.nombre.toLowerCase() === 'delivery' ? 'delivery' : 'cliente',
      })
      .eq('id', selectedUsuario.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    const errorEmpresas = await guardarEmpresasUsuario(selectedUsuario.id, empresasForm);
    if (errorEmpresas) {
      toast({ title: "No se guardaron las empresas", description: errorEmpresas.message, variant: "destructive" });
      return;
    }

    toast({ title: "Usuario Actualizado", description: `${userForm.nombre} ha sido actualizado` });
    resetUserForm();
    setIsEditUserOpen(false);
    setSelectedUsuario(null);
    fetchData();
  };

  const handleDeleteUser = async () => {
    if (!selectedUsuario) return;

    const { error } = await supabase.from('usuarios').delete().eq('id', selectedUsuario.id);
    setIsDeleteUserOpen(false);

    if (error) {
      // Se mantiene selectedUsuario para poder ofrecer "Desactivar en su lugar".
      setErrorEliminarUsuario(describirErrorEliminar(error, selectedUsuario.nombre));
      return;
    }

    toast({ title: "Usuario Eliminado", description: `${selectedUsuario.nombre} ha sido eliminado`, variant: "destructive" });
    setSelectedUsuario(null);
    fetchData();
  };

  const handleDesactivarDesdeError = async () => {
    if (!selectedUsuario) return;
    await handleToggleUserStatus(selectedUsuario);
    setErrorEliminarUsuario(null);
    setSelectedUsuario(null);
  };

  const handleToggleUserStatus = async (usuario: UsuarioConRol) => {
    const { error } = await supabase.from('usuarios').update({ activo: !usuario.activo }).eq('id', usuario.id);
    if (error) {
      toast({ title: "No se pudo cambiar el estado", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: usuario.activo ? "Usuario Desactivado" : "Usuario Activado",
      description: `${usuario.nombre} ha sido ${usuario.activo ? "desactivado" : "activado"}`,
    });
    fetchData();
  };

  // Rol CRUD
  const handleCreateRol = async () => {
    if (!rolForm.nombre) {
      toast({ title: "Error", description: "El nombre es requerido", variant: "destructive" });
      return;
    }

    const { data: newRol, error } = await supabase
      .from('roles')
      .insert({
        nombre: rolForm.nombre,
        descripcion: rolForm.descripcion || null,
        color: rolForm.color,
        es_sistema: false,
        activo: true,
      })
      .select()
      .single();

    if (error || !newRol) {
      toast({ title: "Error", description: error?.message || "Error al crear rol", variant: "destructive" });
      return;
    }

    // Crear permisos para el nuevo rol
    const permisosInsert = modulos.map(m => ({
      rol_id: newRol.id,
      modulo_id: m.id,
      puede_ver: rolPermisos[m.id]?.ver || false,
      puede_crear: rolPermisos[m.id]?.crear || false,
      puede_editar: rolPermisos[m.id]?.editar || false,
      puede_eliminar: rolPermisos[m.id]?.eliminar || false,
    }));
    
    const { error: permError } = await supabase.from('permisos').insert(permisosInsert);
    if (permError) {
      toast({ title: "Rol creado, pero sin permisos", description: `El rol se creó pero no se guardaron sus permisos: ${permError.message}. Edítalo para reintentar.`, variant: "destructive" });
      resetRolForm();
      setIsCreateRolOpen(false);
      fetchData();
      return;
    }

    toast({ title: "Rol Creado", description: `${rolForm.nombre} ha sido creado` });
    resetRolForm();
    setIsCreateRolOpen(false);
    fetchData();
  };

  const handleEditRol = async () => {
    if (!selectedRol) return;

    const { error } = await supabase
      .from('roles')
      .update({
        nombre: rolForm.nombre,
        descripcion: rolForm.descripcion || null,
        color: rolForm.color,
      })
      .eq('id', selectedRol.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    // Actualizar permisos (borrar + reinsertar). Comprobamos ambos pasos para no
    // dejar el rol sin permisos por un fallo silencioso.
    const { error: delError } = await supabase.from('permisos').delete().eq('rol_id', selectedRol.id);
    if (delError) {
      toast({ title: "No se pudieron actualizar los permisos", description: delError.message, variant: "destructive" });
      fetchData();
      return;
    }

    const permisosInsert = modulos.map(m => ({
      rol_id: selectedRol.id,
      modulo_id: m.id,
      puede_ver: rolPermisos[m.id]?.ver || false,
      puede_crear: rolPermisos[m.id]?.crear || false,
      puede_editar: rolPermisos[m.id]?.editar || false,
      puede_eliminar: rolPermisos[m.id]?.eliminar || false,
    }));

    const { error: insError } = await supabase.from('permisos').insert(permisosInsert);
    if (insError) {
      toast({ title: "Atención: permisos incompletos", description: `El rol quedó sin permisos por un error: ${insError.message}. Vuelve a guardarlo.`, variant: "destructive" });
      fetchData();
      return;
    }

    toast({ title: "Rol Actualizado", description: `${rolForm.nombre} ha sido actualizado` });
    resetRolForm();
    setIsEditRolOpen(false);
    setSelectedRol(null);
    fetchData();
  };

  const handleDeleteRol = async () => {
    if (!selectedRol) return;

    if (selectedRol.es_sistema) {
      toast({ title: "Error", description: "No se pueden eliminar roles del sistema", variant: "destructive" });
      return;
    }

    const { error } = await supabase.from('roles').delete().eq('id', selectedRol.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Rol Eliminado", description: `${selectedRol.nombre} ha sido eliminado`, variant: "destructive" });
    }
    
    setIsDeleteRolOpen(false);
    setSelectedRol(null);
    fetchData();
  };

  const openEditUser = (usuario: UsuarioConRol) => {
    setSelectedUsuario(usuario);
    setUserForm({
      nombre: usuario.nombre,
      apellido: usuario.apellido || "",
      email: usuario.email,
      telefono: usuario.telefono || "",
      rol_id: usuario.rol_id || "",
      password: "",
    });
    const actuales = asignaciones[usuario.id] ?? [];
    setEmpresasForm({
      ids: actuales.map((a) => a.empresa_id),
      defecto: actuales.find((a) => a.por_defecto)?.empresa_id ?? actuales[0]?.empresa_id ?? null,
    });
    setIsEditUserOpen(true);
  };

  const openEditRol = async (rol: Rol) => {
    setSelectedRol(rol);
    setRolForm({
      nombre: rol.nombre,
      descripcion: rol.descripcion || "",
      color: rol.color,
    });
    await fetchPermisosForRol(rol.id);
    setIsEditRolOpen(true);
  };

  const togglePermiso = (moduloId: string, tipo: 'ver' | 'crear' | 'editar' | 'eliminar') => {
    setRolPermisos(prev => ({
      ...prev,
      [moduloId]: {
        ...prev[moduloId],
        [tipo]: !prev[moduloId]?.[tipo],
      }
    }));
  };

  const toggleAllPermisos = (moduloId: string) => {
    const current = rolPermisos[moduloId];
    const allEnabled = current?.ver && current?.crear && current?.editar && current?.eliminar;
    setRolPermisos(prev => ({
      ...prev,
      [moduloId]: {
        ver: !allEnabled,
        crear: !allEnabled,
        editar: !allEnabled,
        eliminar: !allEnabled,
      }
    }));
  };

  const filteredUsuarios = usuarios.filter(u => {
    const matchSearch = u.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       u.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchRol = filterRol === "todos" || u.rol_id === filterRol;
    return matchSearch && matchRol;
  });

  const pagination = usePagination(filteredUsuarios, 50);
  const pagination2 = usePagination(modulos, 50);

  const stats = {
    total: usuarios.length,
    activos: usuarios.filter(u => u.activo).length,
    roles: roles.length,
  };

  const colorOptions = [
    { value: "bg-red-500", label: "Rojo" },
    { value: "bg-blue-500", label: "Azul" },
    { value: "bg-green-500", label: "Verde" },
    { value: "bg-yellow-500", label: "Amarillo" },
    { value: "bg-purple-500", label: "Púrpura" },
    { value: "bg-pink-500", label: "Rosa" },
    { value: "bg-orange-500", label: "Naranja" },
    { value: "bg-gray-500", label: "Gris" },
  ];

  return (
    <ConfiguracionLayout 
      title="Gestión de Usuarios y Roles" 
      description="Administra usuarios, roles y permisos del sistema"
    >
      <Tabs defaultValue="usuarios">
        <TabsList>
          <TabsTrigger value="usuarios" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Usuarios
          </TabsTrigger>
          <TabsTrigger value="roles" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Roles y Permisos
          </TabsTrigger>
        </TabsList>

        {/* Tab Usuarios */}
        <TabsContent value="usuarios">
          <KpiStrip
            items={[
              { label: "Total Usuarios", valor: stats.total },
              { label: "Activos", valor: stats.activos, tono: "positivo" },
              { label: "Roles", valor: stats.roles, tono: "primario" },
            ]}
          />

          <BarraLista
            busqueda={searchTerm}
            onBusqueda={setSearchTerm}
            placeholder="Buscar por nombre o email..."
            filtros={
              <Select value={filterRol} onValueChange={setFilterRol}>
                <SelectTrigger className="h-8 w-40 text-[13px]">
                  <SelectValue placeholder="Rol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los roles</SelectItem>
                  {roles.map(rol => (
                    <SelectItem key={rol.id} value={rol.id}>{rol.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            contador={loading ? undefined : `${filteredUsuarios.length} registros`}
            acciones={
              <Button size="sm" className="gap-1.5" onClick={() => { resetUserForm(); setIsCreateUserOpen(true); }}>
                <UserPlus className="h-3.5 w-3.5" />
                Nuevo Usuario
              </Button>
            }
          />

          {/* Users Table */}
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Empresas</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination.pageItems.map((usuario) => (
                    <TableRow key={usuario.id}>
                      <TableCell>
                        <div className="flex items-center whitespace-nowrap">
                          <span className="max-w-[220px] truncate font-medium" title={`${usuario.nombre} ${usuario.apellido || ""}`.trim()}>
                            {usuario.nombre} {usuario.apellido}
                          </span>
                          {usuario.cliente && (
                            <span className="ml-1.5 max-w-[180px] truncate text-xs text-blue-500" title={usuario.cliente.nombre_negocio}>🏪 {usuario.cliente.nombre_negocio}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center whitespace-nowrap">
                          <span className="max-w-[240px] truncate" title={usuario.email}>{usuario.email}</span>
                          {usuario.telefono && (
                            <span className="ml-1.5 text-xs text-muted-foreground">{usuario.telefono}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 whitespace-nowrap">
                          <Badge className={`${usuario.rol?.color || 'bg-gray-500'} border-0 text-white`}>
                            {usuario.rol?.nombre || 'Sin rol'}
                          </Badge>
                          {usuario.cliente_id && (
                            <Badge variant="outline" className="border-blue-500 text-xs text-blue-500">
                              👤 Cliente
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 whitespace-nowrap">
                          {(asignaciones[usuario.id] ?? []).length === 0 ? (
                            <span className="text-xs text-muted-foreground">Sin empresa</span>
                          ) : (asignaciones[usuario.id] ?? []).map((a) => {
                            const emp = empresasTodas.find((e) => e.id === a.empresa_id);
                            return emp ? (
                              <span
                                key={a.empresa_id}
                                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0 text-xs ${a.por_defecto ? "border-primary/40" : "border-border"}`}
                                title={a.por_defecto ? "Empresa por defecto" : undefined}
                              >
                                <EmpresaDistintivo empresa={emp} className="h-4 w-4 text-[8px]" />
                                {emp.nombre_corto}
                              </span>
                            ) : null;
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={usuario.activo}
                          onCheckedChange={() => handleToggleUserStatus(usuario)}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => openEditUser(usuario)}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            title="Eliminar"
                            onClick={() => { setSelectedUsuario(usuario); setIsDeleteUserOpen(true); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!loading && <DataTablePagination pagination={pagination} />}
          </div>
        </TabsContent>

        {/* Tab Roles */}
        <TabsContent value="roles">
          <BarraLista
            filtros={
              <p className="min-w-0 text-sm font-semibold">
                Roles del Sistema
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">Gestiona los roles y sus permisos</span>
              </p>
            }
            contador={`${roles.length} registros`}
            acciones={
              <Button size="sm" className="gap-1.5" onClick={() => { resetRolForm(); setIsCreateRolOpen(true); }}>
                <Plus className="h-3.5 w-3.5" />
                Nuevo Rol
              </Button>
            }
          />

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rol</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right">Usuarios</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map(rol => (
                  <TableRow key={rol.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${rol.color}`} />
                        <span className="font-medium">{rol.nombre}</span>
                        {rol.es_sistema && (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">Sistema</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="block max-w-[420px] truncate" title={rol.descripcion || undefined}>{rol.descripcion || 'Sin descripción'}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                      {usuarios.filter(u => u.rol_id === rol.id).length} usuarios
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar rol" onClick={() => openEditRol(rol)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        {!rol.es_sistema && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            title="Eliminar rol"
                            onClick={() => { setSelectedRol(rol); setIsDeleteRolOpen(true); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Create User Dialog */}
      <Dialog open={isCreateUserOpen} onOpenChange={setIsCreateUserOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Crear Nuevo Usuario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre *</Label>
                <Input
                  placeholder="Nombre"
                  value={userForm.nombre}
                  onChange={(e) => setUserForm({ ...userForm, nombre: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Apellido</Label>
                <Input
                  placeholder="Apellido"
                  value={userForm.apellido}
                  onChange={(e) => setUserForm({ ...userForm, apellido: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input
                type="email"
                placeholder="usuario@ejemplo.com"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input
                placeholder="+58 412 1234567"
                value={userForm.telefono}
                onChange={(e) => setUserForm({ ...userForm, telefono: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Rol *</Label>
              <Select value={userForm.rol_id} onValueChange={(v) => setUserForm({ ...userForm, rol_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un rol" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map(rol => (
                    <SelectItem key={rol.id} value={rol.id}>{rol.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <UsuarioEmpresasField empresas={empresasTodas} value={empresasForm} onChange={setEmpresasForm} />
            <div className="space-y-2">
              <Label>Contraseña *</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Mínimo 6 caracteres"
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateUserOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateUser}>Crear Usuario</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={isEditUserOpen} onOpenChange={setIsEditUserOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Usuario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre *</Label>
                <Input
                  value={userForm.nombre}
                  onChange={(e) => setUserForm({ ...userForm, nombre: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Apellido</Label>
                <Input
                  value={userForm.apellido}
                  onChange={(e) => setUserForm({ ...userForm, apellido: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={userForm.email} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input
                value={userForm.telefono}
                onChange={(e) => setUserForm({ ...userForm, telefono: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Rol *</Label>
              <Select value={userForm.rol_id} onValueChange={(v) => setUserForm({ ...userForm, rol_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un rol" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map(rol => (
                    <SelectItem key={rol.id} value={rol.id}>{rol.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <UsuarioEmpresasField empresas={empresasTodas} value={empresasForm} onChange={setEmpresasForm} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditUserOpen(false)}>Cancelar</Button>
            <Button onClick={handleEditUser}>Guardar Cambios</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation */}
      <AlertDialog open={isDeleteUserOpen} onOpenChange={setIsDeleteUserOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El usuario "{selectedUsuario?.nombre}" será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* No se pudo eliminar el usuario */}
      <Dialog open={!!errorEliminarUsuario} onOpenChange={(o) => { if (!o) { setErrorEliminarUsuario(null); setSelectedUsuario(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No se pudo eliminar el usuario</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">{errorEliminarUsuario}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setErrorEliminarUsuario(null); setSelectedUsuario(null); }}>
              Cerrar
            </Button>
            <Button onClick={handleDesactivarDesdeError}>
              Desactivar en su lugar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Rol Dialog */}
      <Dialog open={isCreateRolOpen || isEditRolOpen} onOpenChange={(open) => {
        if (!open) {
          setIsCreateRolOpen(false);
          setIsEditRolOpen(false);
          setSelectedRol(null);
        }
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditRolOpen ? 'Editar Rol' : 'Crear Nuevo Rol'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre del Rol *</Label>
                <Input
                  placeholder="Ej: Supervisor"
                  value={rolForm.nombre}
                  onChange={(e) => setRolForm({ ...rolForm, nombre: e.target.value })}
                  disabled={selectedRol?.es_sistema}
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <Select value={rolForm.color} onValueChange={(v) => setRolForm({ ...rolForm, color: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {colorOptions.map(c => (
                      <SelectItem key={c.value} value={c.value}>
                        <div className="flex items-center gap-2">
                          <div className={`h-3 w-3 rounded-full ${c.value}`} />
                          {c.label}
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
                placeholder="Descripción del rol"
                value={rolForm.descripcion}
                onChange={(e) => setRolForm({ ...rolForm, descripcion: e.target.value })}
              />
            </div>

            <div className="space-y-4">
              <Label className="text-base font-semibold">Permisos por Módulo</Label>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">Módulo</TableHead>
                      <TableHead className="text-center">Ver</TableHead>
                      <TableHead className="text-center">Crear</TableHead>
                      <TableHead className="text-center">Editar</TableHead>
                      <TableHead className="text-center">Eliminar</TableHead>
                      <TableHead className="text-center">Todos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagination2.pageItems.map(modulo => (
                      <TableRow key={modulo.id}>
                        <TableCell className="font-medium">{modulo.nombre}</TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={rolPermisos[modulo.id]?.ver || false}
                            onCheckedChange={() => togglePermiso(modulo.id, 'ver')}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={rolPermisos[modulo.id]?.crear || false}
                            onCheckedChange={() => togglePermiso(modulo.id, 'crear')}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={rolPermisos[modulo.id]?.editar || false}
                            onCheckedChange={() => togglePermiso(modulo.id, 'editar')}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={rolPermisos[modulo.id]?.eliminar || false}
                            onCheckedChange={() => togglePermiso(modulo.id, 'eliminar')}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={
                              rolPermisos[modulo.id]?.ver &&
                              rolPermisos[modulo.id]?.crear &&
                              rolPermisos[modulo.id]?.editar &&
                              rolPermisos[modulo.id]?.eliminar
                            }
                            onCheckedChange={() => toggleAllPermisos(modulo.id)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <DataTablePagination pagination={pagination2} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsCreateRolOpen(false);
              setIsEditRolOpen(false);
              setSelectedRol(null);
            }}>
              Cancelar
            </Button>
            <Button onClick={isEditRolOpen ? handleEditRol : handleCreateRol} className="gap-2">
              <Save className="h-4 w-4" />
              {isEditRolOpen ? 'Guardar Cambios' : 'Crear Rol'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Rol Confirmation */}
      <AlertDialog open={isDeleteRolOpen} onOpenChange={setIsDeleteRolOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar rol?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El rol "{selectedRol?.nombre}" será eliminado permanentemente.
              Los usuarios con este rol quedarán sin rol asignado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRol} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Credenciales del usuario recién creado */}
      <Dialog open={!!credencialesNuevo} onOpenChange={(o) => { if (!o) setCredencialesNuevo(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usuario creado — credenciales de acceso</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <p className="text-muted-foreground">
              Comunícale estas credenciales al usuario por un canal seguro. La contraseña
              <b> solo se muestra una vez</b>.
            </p>
            <div className="rounded-lg border border-border bg-muted p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Email</span>
                <code className="font-medium">{credencialesNuevo?.email}</code>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Contraseña</span>
                <code className="font-bold text-primary">{credencialesNuevo?.password}</code>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(`Email: ${credencialesNuevo?.email}\nContraseña: ${credencialesNuevo?.password}`);
                toast({ title: "Copiado", description: "Credenciales copiadas al portapapeles" });
              }}
            >
              Copiar
            </Button>
            <Button onClick={() => setCredencialesNuevo(null)}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfiguracionLayout>
  );
};

export default ConfigUsuarios;
