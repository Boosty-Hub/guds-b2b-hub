import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oyyxkbwtyxdpzsgarmim.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95eXhrYnd0eXhkcHpzZ2FybWltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMzgwNTEsImV4cCI6MjA4MDcxNDA1MX0.0hdYtGizONaFhJy9ZC9yB7qdMK1kRrXaP7pw-nR_Kq0';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types
export interface Categoria {
  id: string;
  nombre: string;
  icono: string | null;
  color: string | null;
  orden: number;
  activo: boolean;
  created_at: string;
}

export interface Producto {
  id: string;
  sku: string;
  nombre: string;
  descripcion: string | null;
  categoria_id: string | null;
  tipo_empaque_id: string | null;
  unidad: string;
  precio_base: number;
  costo: number | null;
  imagen_url: string | null;
  imagen_emoji: string | null;
  stock_actual: number;
  stock_minimo: number;
  stock_maximo: number | null;
  precio_oferta: number | null;
  porcentaje_descuento: number | null;
  en_oferta: boolean;
  activo: boolean;
  destacado: boolean;
  created_at: string;
  categoria?: Categoria;
  tipo_empaque?: TipoEmpaque;
}

export interface Cliente {
  id: string;
  codigo: string;
  nombre_negocio: string;
  tipo_negocio: string;
  rif: string;
  email: string;
  telefono: string | null;
  direccion: string;
  ciudad: string;
  limite_credito: number;
  credito_utilizado: number;
  dias_credito: number;
  lista_precios_id: string | null;
  vendedor_asignado_id: string | null;
  activo: boolean;
  created_at: string;
}

export interface RegistroCliente {
  id: string;
  nombre_negocio: string;
  tipo_negocio: string;
  rif: string;
  nombre_contacto: string;
  apellido_contacto: string;
  email: string;
  telefono: string;
  direccion: string;
  ciudad: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  notas: string | null;
  created_at: string;
}

export interface ListaPrecios {
  id: string;
  nombre: string;
  descripcion: string | null;
  es_default: boolean;
  porcentaje_descuento: number;
  activo: boolean;
}

export interface PrecioLista {
  id: string;
  lista_precios_id: string;
  producto_id: string;
  precio: number;
  producto?: Producto;
  lista_precios?: ListaPrecios;
}

export interface TipoEmpaque {
  id: string;
  nombre: string;
  descripcion: string | null;
  unidades: number;
  activo: boolean;
  orden: number;
  created_at: string;
}

export interface ProductoEmpaque {
  id: string;
  producto_id: string;
  tipo_empaque_id: string;
  precio_empaque: number | null;
  activo: boolean;
  tipo_empaque?: TipoEmpaque;
}

export interface Rol {
  id: string;
  nombre: string;
  descripcion: string | null;
  color: string;
  es_sistema: boolean;
  activo: boolean;
  created_at: string;
}

export interface Modulo {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  icono: string | null;
  orden: number;
  activo: boolean;
}

export interface Permiso {
  id: string;
  rol_id: string;
  modulo_id: string;
  puede_ver: boolean;
  puede_crear: boolean;
  puede_editar: boolean;
  puede_eliminar: boolean;
  modulo?: Modulo;
}

export interface Usuario {
  id: string;
  auth_id: string | null;
  email: string;
  nombre: string;
  apellido: string | null;
  telefono: string | null;
  avatar_url: string | null;
  role: 'admin' | 'vendedor' | 'delivery' | 'cliente';
  rol_id: string | null;
  activo: boolean;
  cliente_id: string | null;
  created_at: string;
  rol?: Rol;
}
