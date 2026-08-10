import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";

export type UserRole = "admin" | "cliente" | "vendedor" | "delivery";

export interface User {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  role: UserRole;
  avatar?: string;
  cliente_id?: string;
  telefono?: string;
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
  estado: "pendiente" | "aprobado" | "rechazado";
  fechaRegistro: string;
  notas?: string;
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
  ) => Promise<{ success: boolean; email?: string; password?: string; error?: string }>;
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
          const { data: userData, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('auth_id', session.user.id)
            .single();

          console.log('Usuario encontrado:', userData, error);

          if (userData && userData.activo === false) {
            // Cuenta desactivada: cerrar la sesión persistida
            await supabase.auth.signOut();
            setUser(null);
          } else if (userData) {
            setUser({
              id: userData.id,
              email: userData.email,
              nombre: userData.nombre,
              apellido: userData.apellido || '',
              role: (userData.role as UserRole) || 'cliente',
              avatar: userData.avatar_url || undefined,
              cliente_id: userData.cliente_id || undefined,
              telefono: userData.telefono || undefined,
            });
          } else {
            // Usuario autenticado pero sin registro en tabla usuarios - crear registro
            const { data: newUser } = await supabase
              .from('usuarios')
              .insert({
                auth_id: session.user.id,
                email: session.user.email,
                nombre: session.user.email?.split('@')[0] || 'Usuario',
                role: 'cliente',
                activo: true,
              })
              .select('*')
              .single();

            if (newUser) {
              setUser({
                id: newUser.id,
                email: newUser.email,
                nombre: newUser.nombre,
                apellido: newUser.apellido || '',
                role: (newUser.role as UserRole) || 'cliente',
                avatar: newUser.avatar_url || undefined,
                cliente_id: newUser.cliente_id || undefined,
                telefono: newUser.telefono || undefined,
              });
            }
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
    fetchRegistros();

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

  const fetchRegistros = async () => {
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
        estado: r.estado,
        fechaRegistro: r.created_at?.split('T')[0] || '',
        notas: r.notas,
      })));
    }
  };

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

      // Obtener datos del usuario desde la tabla usuarios
      const { data: userData, error: userError } = await supabase
        .from('usuarios')
        .select('*')
        .eq('auth_id', authData.user.id)
        .single();

      console.log('Datos de usuario:', { userData, userError });

      if (userError || !userData) {
        console.log('Usuario no encontrado, creando perfil...');
        // Si no existe en la tabla usuarios, crear el registro
        const { data: newUser, error: createError } = await supabase
          .from('usuarios')
          .insert({
            auth_id: authData.user.id,
            email: authData.user.email,
            nombre: authData.user.email?.split('@')[0] || 'Usuario',
            role: 'cliente',
            activo: true,
          })
          .select('*')
          .single();

        console.log('Nuevo usuario creado:', { newUser, createError });

        if (createError || !newUser) {
          console.error('Error creando usuario:', createError);
          return { success: false, error: "Error al crear perfil de usuario" };
        }

        const role = (newUser.role as UserRole) || 'cliente';
        setUser({
          id: newUser.id,
          email: newUser.email,
          nombre: newUser.nombre,
          apellido: newUser.apellido || '',
          role: role,
          avatar: newUser.avatar_url || undefined,
          cliente_id: newUser.cliente_id || undefined,
          telefono: newUser.telefono || undefined,
        });
        return { success: true, role };
      }

      // Usuario existente: bloquear si está desactivado
      if (userData.activo === false) {
        await supabase.auth.signOut();
        return { success: false, error: "Tu cuenta está desactivada. Contacta al administrador." };
      }

      const role = (userData.role as UserRole) || 'cliente';
      setUser({
        id: userData.id,
        email: userData.email,
        nombre: userData.nombre,
        apellido: userData.apellido || '',
        role: role,
        avatar: userData.avatar_url || undefined,
        cliente_id: userData.cliente_id || undefined,
        telefono: userData.telefono || undefined,
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

  const updateUser = (patch: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  };

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
        estado: 'pendiente',
      });
    
    if (!error) {
      await fetchRegistros();
      return true;
    }
    return false;
  };

  const aprobarRegistro = async (
    id: string,
    opts?: { lista_precios_id?: string; vendedor_id?: string; limite_credito?: number; dias_credito?: number }
  ): Promise<{ success: boolean; email?: string; password?: string; error?: string }> => {
    // Aprueba, crea el cliente + la cuenta de auth y devuelve la contraseña temporal.
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
    return { success: true, email: row?.email, password: row?.password_temporal };
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

  const refreshRegistros = async () => {
    await fetchRegistros();
  };

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
