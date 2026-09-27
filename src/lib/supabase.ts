import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oyyxkbwtyxdpzsgarmim.supabase.co';
// Llave PUBLISHABLE nueva (sb_publishable_...). Reemplaza la anon JWT legacy,
// que quedará deshabilitada. supabase-js la envía en el header `apikey`.
const supabaseAnonKey = 'sb_publishable_J8477Ia3F9Ro3S7NQQlwrw_BDOYElbV';

// Multiempresa: cada petición a PostgREST lleva la empresa activa en el header x-empresa-id
// (uuid de la empresa o 'todas'). La base filtra por ella (RLS) y rechaza escrituras en otra
// empresa o en modo 'todas'. Lo actualiza EmpresaContext; ver docs/PLAN-ESPEJO-ODOO.md (Fase 1).
let empresaHeader = 'todas';
export const setEmpresaHeader = (valor: string) => {
  empresaHeader = valor;
};

const fetchConEmpresa: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes('/rest/v1/')) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set('x-empresa-id', empresaHeader);
  return fetch(input, { ...init, headers });
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchConEmpresa },
});

// Types
export interface Empresa {
  id: string;
  odoo_company_id: number | null;
  nombre: string;
  nombre_corto: string;
  prefijo: string;
  rif: string | null;
  direccion: string | null;
  ciudad: string | null;
  estado: string | null;
  telefono: string | null;
  email: string | null;
  sitio_web: string | null;
  logo_url: string | null;
  color: string | null;
  activo: boolean;
  orden: number;
}

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
  imagenes: string[];
  imagen_emoji: string | null;
  stock_actual: number;
  stock_disponible?: number;          // existencia − comprometido (entregas de Odoo y pedidos de GUDS)
  controla_stock?: boolean;           // en Odoo: producto con control de existencias
  comprometido_odoo?: number;
  comprometido_guds?: number;
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
  // Espejo Odoo (Fase 3)
  odoo_id?: number | null;
  precio_origen?: 'odoo' | 'guds';
  disponible?: boolean | null;
  oculto_tienda?: boolean;
  vendible?: boolean | null;
  tipo_odoo?: string | null;
  empresa_id?: string | null;
}

export interface Cliente {
  id: string;
  codigo: string;
  nombre_negocio: string;
  tipo_negocio: string;
  rif: string;
  contribuyente_especial: boolean;
  email: string;
  telefono: string | null;
  direccion: string;
  direccion_entrega: string | null;
  ciudad: string;
  limite_credito: number;
  credito_utilizado: number;
  dias_credito: number;
  lista_precios_id: string | null;
  vendedor_asignado_id: string | null;
  activo: boolean;
  created_at: string;
  // Campos importados desde Odoo
  odoo_id?: number | null;
  cedula?: string | null;
  estado?: string | null;
  celular?: string | null;
  es_empresa?: boolean | null;
  tipo_residencia?: string | null;
  vendedor_odoo?: string | null;
  condicion_pago?: string | null;
  licencia_actividad?: string | null;
  sitio_web?: string | null;
  notas?: string | null;
  fecha_registro_odoo?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  retiene_iva?: boolean;
  retiene_islr?: boolean;
}

export interface RegistroCliente {
  id: string;
  nombre_negocio: string;
  tipo_negocio: string;
  rif: string;
  contribuyente_especial: boolean;
  rif_documento_path: string | null;
  nombre_contacto: string;
  apellido_contacto: string | null;
  email: string;
  telefono: string;
  direccion: string;
  direccion_entrega: string | null;
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
