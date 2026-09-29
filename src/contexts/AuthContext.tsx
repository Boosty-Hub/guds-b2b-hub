import { createContext, useCallback, useContext, useRef, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { guardarAsignadas, lanzarArranque, SELECT_PERFIL } from "@/lib/arranque";

export type UserRole = "admin" | "cliente" | "vendedor" | "delivery";

export interface User {
  id: string;
  auth_id?: string;
  email: string;
  nombre: string;
  apellido: string;
  role: UserRole;
  avatar?: string;
  cliente_id?: string;
  telefono?: string;
  debe_cambiar_clave?: boolean;
}

export interface RegistroCliente {
  id: string;
  nombreNegocio: string;
  nombreContacto: string;
  apellidoContacto: string;
  email: string;
  telefono: string;
  direccion: string;
  direccionEntrega: string | null;
  ciudad: string;
  rif: string;
  contribuyenteEspecial: boolean;
  rifDocumentoPath: string | null;
  tipoNegocio: string;
  empresaId?: string | null;          // empresa con la que quiere comprar (GUDS / Quirutec)
  estadoVe?: string | null;           // estado de Venezuela de la dirección (Odoo lo exige para crear el cliente)
  estado: "pendiente" | "aprobado" | "rechazado";
  fechaRegistro: string;
  notas?: string;
  clienteCreadoId?: string | null;    // cliente al que quedó ligado al aprobarse
  usoClienteExistente?: boolean;      // al aprobar ya existía (mismo RIF o nombre): no se creó otro
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; role?: UserRole; error?: string }>;
  logout: () => void;
  updateUser: (patch: Partial<User>) => void;
  registros: RegistroCliente[];
  addRegistro: (registro: Omit<RegistroCliente, "id" | "estado" | "fechaRegistro">) => Promise<boolean>;
  aprobarRegistro: (
    id: string,
    opts?: { lista_precios_id?: string; vendedor_id?: string; limite_credito?: number; dias_credito?: number }
  ) => Promise<{ success: boolean; email?: string; password?: string; clienteId?: string; error?: string }>;
  rechazarRegistro: (id: string, notas: string) => Promise<void>;
  getPendingRegistros: () => RegistroCliente[];
  refreshRegistros: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [registros, setRegistros] = useState<RegistroCliente[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Verificar sesión existente
    const checkSession = async () => {
      try {
        console.log('Verificando sesión...');
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          console.log('Sesión encontrada:', session.user.email);
          // Empresas (y la ficha del cliente) salen en paralelo con el perfil: ver lib/arranque.ts
          lanzarArranque(session.user.id);
          const { data: userData, error } = await supabase
            .from('usuarios')
            .select(SELECT_PERFIL)
            .eq('auth_id', session.user.id)
            .single();

          console.log('Usuario encontrado:', userData, error);

          if (userData && userData.activo === false) {
            // Cuenta desactivada: cerrar la sesión persistida
            await supabase.auth.signOut();
            setUser(null);
          } else if (userData) {
            guardarAsignadas(userData.id, userData.usuario_empresas);
            setUser({
              id: userData.id,
              auth_id: userData.auth_id,
              email: userData.email,
              nombre: userData.nombre,
              apellido: userData.apellido || '',
              role: (userData.role as UserRole) || 'cliente',
              avatar: userData.avatar_url || undefined,
              cliente_id: userData.cliente_id || undefined,
              telefono: userData.telefono || undefined,
              debe_cambiar_clave: !!userData.debe_cambiar_clave,
            });
          } else {
            // Cuenta sin perfil en GUDS: los perfiles los crea GUDS (acceso de contactos, registro aprobado, usuarios del
            // admin). No se crea uno por defecto: se cierra la sesión.
            await supabase.auth.signOut();
            setUser(null);
          }
        } else {
          console.log('No hay sesión activa');
        }
      } catch (error) {
        console.error('Error checking session:', error);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    // Escuchar cambios de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state change:', event, session?.user?.email);
      if (event === 'SIGNED_OUT') {
        setUser(null);
      }
      // No hacemos nada en SIGNED_IN aquí porque la función login ya maneja eso
      // Esto evita queries duplicadas y posibles bloqueos
    });

    return () => subscription.unsubscribe();
  }, []);

  // Solicitudes de registro: solo las usa la pantalla de Registros del admin, que las pide al abrirse
  // (refreshRegistros). Antes se pedían en cada arranque para cualquier usuario, incluso sin sesión.
  const registrosPedidos = useRef(false);
  const fetchRegistros = useCallback(async () => {
    registrosPedidos.current = true;
    const { data } = await supabase
      .from('registros_clientes')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (data) {
      setRegistros(data.map(r => ({
        id: r.id,
        nombreNegocio: r.nombre_negocio,
        nombreContacto: r.nombre_contacto,
        apellidoContacto: r.apellido_contacto || '',
        email: r.email,
        telefono: r.telefono,
        direccion: r.direccion,
        direccionEntrega: r.direccion_entrega,
        ciudad: r.ciudad,
        rif: r.rif,
        contribuyenteEspecial: r.contribuyente_especial,
        rifDocumentoPath: r.rif_documento_path,
        tipoNegocio: r.tipo_negocio,
        empresaId: r.empresa_id ?? null,
        estadoVe: r.estado_ve ?? null,
        estado: r.estado,
        fechaRegistro: r.created_at?.split('T')[0] || '',
        notas: r.notas,
        clienteCreadoId: r.cliente_creado_id ?? null,
        usoClienteExistente: !!r.uso_cliente_existente,
      })));
    }
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; role?: UserRole; error?: string }> => {
    try {
      console.log('Intentando login con:', email);
      
      // Autenticar con Supabase Auth con timeout
      const authPromise = supabase.auth.signInWithPassword({
        email,
        password,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout: La conexión tardó demasiado')), 15000);
      });

      const { data: authData, error: authError } = await Promise.race([authPromise, timeoutPromise]) as Awaited<typeof authPromise>;

      console.log('Respuesta auth:', { user: authData?.user?.email, error: authError?.message });

      if (authError) {
        console.error('Error de autenticación:', authError);
        // Traducir mensajes de error comunes
        let errorMessage = authError.message;
        if (authError.message.includes('Invalid login credentials')) {
          errorMessage = 'Email o contraseña incorrectos';
        } else if (authError.message.includes('Email not confirmed')) {
          errorMessage = 'Por favor confirma tu email antes de iniciar sesión';
        }
        return { success: false, error: errorMessage };
      }

      if (!authData.user) {
        return { success: false, error: "No se pudo obtener el usuario" };
      }

      console.log('Usuario autenticado:', authData.user.id);
      lanzarArranque(authData.user.id);

      // Obtener datos del usuario desde la tabla usuarios
      const { data: userData, error: userError } = await supabase
        .from('usuarios')
        .select(SELECT_PERFIL)
        .eq('auth_id', authData.user.id)
        .single();

      console.log('Datos de usuario:', { userData, userError });

      if (userError || !userData) {
        // Cuenta sin perfil en GUDS: no se crea uno por defecto (los perfiles los crea GUDS)
        await supabase.auth.signOut();
        return { success: false, error: "Tu cuenta no tiene acceso configurado en GUDS. Pide acceso a tu ejecutivo de cuenta." };
      }

      // Usuario existente: bloquear si está desactivado
      if (userData.activo === false) {
        await supabase.auth.signOut();
        return { success: false, error: "Tu cuenta está desactivada. Contacta al administrador." };
      }

      const role = (userData.role as UserRole) || 'cliente';
      guardarAsignadas(userData.id, userData.usuario_empresas);
      setUser({
        id: userData.id,
        auth_id: userData.auth_id,
        email: userData.email,
        nombre: userData.nombre,
        apellido: userData.apellido || '',
        role: role,
        avatar: userData.avatar_url || undefined,
        cliente_id: userData.cliente_id || undefined,
        telefono: userData.telefono || undefined,
        debe_cambiar_clave: !!userData.debe_cambiar_clave,
      });

      console.log('Login exitoso, rol:', role);
      return { success: true, role };
    } catch (error) {
      console.error('Error en login:', error);
      return { success: false, error: "Error de conexión. Verifica tu internet." };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const addRegistro = async (registro: Omit<RegistroCliente, "id" | "estado" | "fechaRegistro">): Promise<boolean> => {
    const { error } = await supabase
      .from('registros_clientes')
      .insert({
        nombre_negocio: registro.nombreNegocio,
        nombre_contacto: registro.nombreContacto,
        apellido_contacto: registro.apellidoContacto || null,
        email: registro.email,
        telefono: registro.telefono,
        direccion: registro.direccion,
        direccion_entrega: registro.direccionEntrega,
        ciudad: registro.ciudad,
        rif: registro.rif,
        contribuyente_especial: registro.contribuyenteEspecial,
        rif_documento_path: registro.rifDocumentoPath,
        tipo_negocio: registro.tipoNegocio,
        empresa_id: registro.empresaId || null,
        estado_ve: registro.estadoVe || null,
        estado: 'pendiente',
      });
    
    if (!error) {
      if (registrosPedidos.current) await fetchRegistros();
      return true;
    }
    return false;
  };

  const aprobarRegistro = async (
    id: string,
    opts?: { lista_precios_id?: string; vendedor_id?: string; limite_credito?: number; dias_credito?: number }
  ): Promise<{ success: boolean; email?: string; password?: string; clienteId?: string; error?: string }> => {
    // Aprueba: crea el cliente (o usa el que ya existe con ese RIF o nombre) + la cuenta de acceso, encola su alta en Odoo
    // y devuelve la contraseña temporal.
    const { data, error } = await supabase.rpc('aprobar_registro_cliente', {
      p_registro_id: id,
      p_admin_id: user?.id ?? null,
      p_lista_precios_id: opts?.lista_precios_id ?? null,
      p_vendedor_id: opts?.vendedor_id ?? null,
      p_limite_credito: opts?.limite_credito ?? 0,
      p_dias_credito: opts?.dias_credito ?? 0,
    });

    if (error) {
      return { success: false, error: error.message };
    }
    await fetchRegistros();
    const row = Array.isArray(data) ? data[0] : data;
    return { success: true, email: row?.email, password: row?.password_temporal, clienteId: row?.cliente_id };
  };

  const rechazarRegistro = async (id: string, notas: string) => {
    await supabase
      .from('registros_clientes')
      .update({ estado: 'rechazado', notas })
      .eq('id', id);
    
    await fetchRegistros();
  };

  const getPendingRegistros = () => {
    return registros.filter(r => r.estado === "pendiente");
  };

  const refreshRegistros = fetchRegistros;

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        login,
        logout,
        updateUser,
        registros,
        addRegistro,
        aprobarRegistro,
        rechazarRegistro,
        getPendingRegistros,
        refreshRegistros,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
