-- Foto de esquema de Supabase (proyecto oyyxkbwtyxdpzsgarmim) · 2026-09-27T14:58:59.995Z
-- Referencia/restauración manual. NO es una migración: no aplicar sobre una base que ya tiene estas tablas.

-- ════════════════ EXTENSIONES ════════════════

create extension if not exists "pg_cron" with schema pg_catalog;
create extension if not exists "pg_net" with schema public;
create extension if not exists "pg_stat_statements" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "supabase_vault" with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;

-- ════════════════ TIPOS ENUM ════════════════

create type public.entrega_estado as enum ('asignada', 'en_camino', 'entregada', 'fallida');
create type public.orden_estado as enum ('pendiente', 'confirmado', 'procesando', 'enviado', 'completado', 'cancelado');
create type public.pago_estado as enum ('pendiente', 'verificado', 'rechazado');
create type public.pago_metodo as enum ('transferencia', 'efectivo', 'credito', 'pago_movil', 'tarjeta');
create type public.registro_estado as enum ('pendiente', 'aprobado', 'rechazado');
create type public.user_role as enum ('admin', 'cliente', 'vendedor', 'delivery');

-- ════════════════ SECUENCIAS ════════════════

create sequence if not exists public.cuentas_cobrar_seq start 1 increment 1;
create sequence if not exists public.declaracion_consignacion_seq start 1 increment 1;
create sequence if not exists public.factura_interna_seq start 1 increment 1;
create sequence if not exists public.retencion_seq start 1 increment 1;

-- ════════════════ TABLAS ════════════════

create table public."almacenes" (
  "id" uuid default gen_random_uuid() not null,
  "odoo_id" integer,
  "nombre" text not null,
  "codigo" text,
  "tipo" text default 'propio'::text not null,
  "cliente_id" uuid,
  "activo" boolean default true,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."bancos" (
  "id" uuid default gen_random_uuid() not null,
  "nombre" character varying not null,
  "metodo_pago" pago_metodo not null,
  "moneda" character varying default 'USD'::character varying not null,
  "numero_cuenta" character varying,
  "titular" character varying,
  "documento" character varying,
  "activo" boolean default true not null,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "odoo_id" integer,
  "metodos" text[]
);
create table public."banners" (
  "id" uuid default gen_random_uuid() not null,
  "titulo" character varying(100) not null,
  "subtitulo" character varying(200),
  "color_fondo" character varying(100) not null,
  "color_texto" character varying(20) default 'white'::character varying,
  "link" character varying(255),
  "orden" integer default 0,
  "activo" boolean default true,
  "fecha_inicio" date,
  "fecha_fin" date,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "imagen_url" text
);
create table public."carrito" (
  "id" uuid default gen_random_uuid() not null,
  "usuario_id" uuid not null,
  "producto_id" uuid not null,
  "cantidad" integer default 1 not null,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "tipo_empaque_id" uuid,
  "precio_unitario" numeric(10,2)
);
create table public."categorias" (
  "id" uuid default gen_random_uuid() not null,
  "nombre" character varying(100) not null,
  "icono" character varying(10),
  "color" character varying(50),
  "orden" integer default 0,
  "activo" boolean default true,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "odoo_id" integer
);
create table public."clientes" (
  "id" uuid default gen_random_uuid() not null,
  "codigo" text not null,
  "nombre_negocio" character varying(200) not null,
  "tipo_negocio" character varying(100) not null,
  "rif" text not null,
  "email" character varying(255),
  "telefono" text,
  "direccion" text,
  "ciudad" character varying(100),
  "latitud" numeric(10,8),
  "longitud" numeric(11,8),
  "limite_credito" numeric(12,2) default 0,
  "credito_utilizado" numeric(12,2) default 0,
  "dias_credito" integer default 0,
  "lista_precios_id" uuid,
  "vendedor_asignado_id" uuid,
  "registro_origen_id" uuid,
  "activo" boolean default true,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "contribuyente_especial" boolean default false not null,
  "direccion_entrega" text,
  "odoo_id" integer,
  "cedula" text,
  "estado" text,
  "celular" text,
  "es_empresa" boolean,
  "tipo_residencia" text,
  "vendedor_odoo" text,
  "condicion_pago" text,
  "licencia_actividad" text,
  "sitio_web" text,
  "notas" text,
  "fecha_registro_odoo" timestamp with time zone,
  "retiene_iva" boolean default false not null,
  "retiene_islr" boolean default false not null
);
create table public."conceptos_retencion_islr" (
  "id" uuid default gen_random_uuid() not null,
  "codigo" text,
  "concepto" text not null,
  "porcentaje" numeric not null,
  "activo" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."configuracion" (
  "id" uuid default gen_random_uuid() not null,
  "clave" character varying(100) not null,
  "valor" text,
  "tipo" character varying(20) default 'string'::character varying,
  "descripcion" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."cuentas_cobrar" (
  "id" uuid default gen_random_uuid() not null,
  "numero" text,
  "cliente_id" uuid not null,
  "concepto" text not null,
  "monto" numeric not null,
  "monto_pagado" numeric default 0 not null,
  "estado_pago" text default 'pendiente'::text not null,
  "fecha" date default ((now() AT TIME ZONE 'America/Caracas'::text))::date not null,
  "origen" text default 'manual'::text,
  "notas" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."cupones" (
  "id" uuid default gen_random_uuid() not null,
  "codigo" character varying(50) not null,
  "descripcion" text,
  "tipo" character varying(20) not null,
  "valor" numeric(12,2) not null,
  "minimo_compra" numeric(12,2) default 0,
  "maximo_descuento" numeric(12,2),
  "usos_maximos" integer,
  "usos_actuales" integer default 0,
  "usos_por_cliente" integer default 1,
  "fecha_inicio" date,
  "fecha_fin" date,
  "activo" boolean default true,
  "solo_primera_compra" boolean default false,
  "cliente_especifico_id" uuid,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."declaracion_consignacion_items" (
  "id" uuid default gen_random_uuid() not null,
  "declaracion_id" uuid not null,
  "producto_id" uuid,
  "nombre_producto" text,
  "sku_producto" text,
  "cantidad" numeric not null,
  "precio_unitario" numeric default 0 not null,
  "subtotal" numeric default 0 not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."declaraciones_consignacion" (
  "id" uuid default gen_random_uuid() not null,
  "numero" text not null,
  "almacen_id" uuid not null,
  "cliente_id" uuid not null,
  "declarado_por" uuid,
  "rol_declarante" text not null,
  "estado" text default 'pendiente'::text not null,
  "fecha" date default CURRENT_DATE not null,
  "subtotal" numeric default 0 not null,
  "impuesto" numeric default 0 not null,
  "total" numeric default 0 not null,
  "factura_id" uuid,
  "notas" text,
  "revisado_por" uuid,
  "revisado_en" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."entregas" (
  "id" uuid default gen_random_uuid() not null,
  "orden_id" uuid not null,
  "repartidor_id" uuid,
  "estado" entrega_estado default 'asignada'::entrega_estado,
  "prioridad" character varying(20) default 'normal'::character varying,
  "orden_ruta" integer,
  "distancia_km" numeric(6,2),
  "tiempo_estimado_min" integer,
  "fecha_asignacion" timestamp with time zone default now(),
  "fecha_inicio_entrega" timestamp with time zone,
  "fecha_entrega" timestamp with time zone,
  "firma_url" text,
  "foto_entrega_url" text,
  "receptor_nombre" character varying(100),
  "notas" text,
  "motivo_fallo" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."extracto_lineas" (
  "id" uuid default gen_random_uuid() not null,
  "extracto_id" uuid not null,
  "fecha" date not null,
  "monto" numeric not null,
  "referencia" text,
  "descripcion" text,
  "estado" text default 'pendiente'::text not null,
  "movimiento_bancario_id" uuid,
  "metodo_match" text,
  "confianza" numeric,
  "sugerencia_ia" jsonb,
  "revisado_por" uuid,
  "revisado_en" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);
create table public."extractos_bancarios" (
  "id" uuid default gen_random_uuid() not null,
  "banco_id" uuid not null,
  "nombre_archivo" text not null,
  "moneda" text default 'USD'::text not null,
  "fecha_desde" date,
  "fecha_hasta" date,
  "total_lineas" integer default 0 not null,
  "cargado_por" uuid,
  "created_at" timestamp with time zone default now() not null
);
create table public."factura_items" (
  "id" uuid default gen_random_uuid() not null,
  "factura_id" uuid not null,
  "producto_id" uuid,
  "nombre_producto" text,
  "sku_producto" text,
  "cantidad" numeric default 0 not null,
  "precio_unitario" numeric default 0 not null,
  "descuento" numeric default 0 not null,
  "subtotal" numeric default 0 not null,
  "total" numeric default 0 not null,
  "odoo_id" integer,
  "created_at" timestamp with time zone default now()
);
create table public."facturas" (
  "id" uuid default gen_random_uuid() not null,
  "numero" text not null,
  "tipo" text default 'factura'::text not null,
  "cliente_id" uuid,
  "orden_id" uuid,
  "fecha_emision" date,
  "fecha_vencimiento" date,
  "moneda" text default 'USD'::text not null,
  "tasa_cambio" numeric,
  "subtotal" numeric default 0 not null,
  "impuesto" numeric default 0 not null,
  "total" numeric default 0 not null,
  "monto_pagado" numeric default 0 not null,
  "saldo_pendiente" numeric default 0 not null,
  "estado_pago" text default 'pendiente'::text not null,
  "estado" text default 'posted'::text not null,
  "referencia" text,
  "nro_control" text,
  "vendedor_odoo" text,
  "notas" text,
  "odoo_id" integer,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "total_usd" numeric default 0 not null,
  "saldo_odoo_usd" numeric default 0 not null,
  "monto_aplicado_usd" numeric default 0 not null,
  "odoo_sync_at" timestamp with time zone,
  "creada_en_guds" boolean default false not null,
  "monto_retenido_usd" numeric default 0 not null,
  "saldo_usd" numeric generated always as (round(((saldo_odoo_usd - monto_aplicado_usd) - monto_retenido_usd), 2)) stored,
  "estado_cobro" text generated always as (
CASE
    WHEN ((estado_pago = 'anulado'::text) OR (estado = 'cancel'::text)) THEN 'anulado'::text
    WHEN (abs(((saldo_odoo_usd - monto_aplicado_usd) - monto_retenido_usd)) <= 0.01) THEN 'pagado'::text
    WHEN (abs(((saldo_odoo_usd - monto_aplicado_usd) - monto_retenido_usd)) < abs(total_usd)) THEN 'parcial'::text
    ELSE 'pendiente'::text
END) stored
);
create table public."favoritos" (
  "id" uuid default gen_random_uuid() not null,
  "usuario_id" uuid not null,
  "producto_id" uuid not null,
  "created_at" timestamp with time zone default now()
);
create table public."iconos" (
  "id" uuid default gen_random_uuid() not null,
  "emoji" character varying(10) not null,
  "nombre" character varying(100) not null,
  "categoria" character varying(50) default 'general'::character varying not null,
  "activo" boolean default true,
  "orden" integer default 0,
  "created_at" timestamp with time zone default now()
);
create table public."inventario_almacen" (
  "id" uuid default gen_random_uuid() not null,
  "almacen_id" uuid not null,
  "producto_id" uuid not null,
  "cantidad" numeric default 0 not null,
  "updated_at" timestamp with time zone default now()
);
create table public."listas_precios" (
  "id" uuid default gen_random_uuid() not null,
  "nombre" character varying(100) not null,
  "descripcion" text,
  "es_default" boolean default false,
  "porcentaje_descuento" numeric(5,2) default 0,
  "activo" boolean default true,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."metas_vendedor" (
  "id" uuid default gen_random_uuid() not null,
  "vendedor_id" uuid not null,
  "mes" integer not null,
  "anio" integer not null,
  "meta_ventas" numeric(12,2) not null,
  "ventas_actuales" numeric(12,2) default 0,
  "comision_porcentaje" numeric(5,2) default 5,
  "comision_ganada" numeric(12,2) default 0,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."metodos_pago" (
  "id" uuid default gen_random_uuid() not null,
  "nombre" character varying not null,
  "descripcion" text,
  "tipo" character varying default 'otro'::character varying not null,
  "icono" character varying,
  "activo" boolean default true,
  "disponible_portal_cliente" boolean default true,
  "disponible_portal_vendedor" boolean default true,
  "requiere_comprobante" boolean default false,
  "instrucciones" text,
  "datos_bancarios" jsonb default '{}'::jsonb,
  "orden" integer default 0,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."modulos" (
  "id" uuid default gen_random_uuid() not null,
  "codigo" character varying(50) not null,
  "nombre" character varying(100) not null,
  "descripcion" character varying(200),
  "icono" character varying(50),
  "orden" integer default 0,
  "activo" boolean default true
);
create table public."movimientos_bancarios" (
  "id" uuid default gen_random_uuid() not null,
  "banco_id" uuid not null,
  "tipo" text default 'entrada'::text not null,
  "monto" numeric not null,
  "referencia" text,
  "descripcion" text,
  "pago_id" uuid,
  "fecha" timestamp with time zone default now() not null,
  "created_at" timestamp with time zone default now()
);
create table public."movimientos_inventario" (
  "id" uuid default gen_random_uuid() not null,
  "producto_id" uuid not null,
  "tipo" character varying(20) not null,
  "cantidad" integer not null,
  "stock_anterior" integer not null,
  "stock_nuevo" integer not null,
  "motivo" text,
  "referencia_id" uuid,
  "referencia_tipo" character varying(50),
  "usuario_id" uuid,
  "created_at" timestamp with time zone default now()
);
create table public."notificaciones" (
  "id" uuid default gen_random_uuid() not null,
  "usuario_id" uuid not null,
  "titulo" character varying(200) not null,
  "mensaje" text,
  "tipo" character varying(50),
  "leida" boolean default false,
  "link" character varying(255),
  "data" jsonb,
  "created_at" timestamp with time zone default now()
);
create table public."orden_items" (
  "id" uuid default gen_random_uuid() not null,
  "orden_id" uuid not null,
  "producto_id" uuid,
  "cantidad" integer not null,
  "precio_unitario" numeric(12,2) not null,
  "descuento" numeric(12,2) default 0,
  "subtotal" numeric(12,2) not null,
  "created_at" timestamp with time zone default now(),
  "odoo_id" integer,
  "nombre_producto" text,
  "sku_producto" text
);
create table public."ordenes" (
  "id" uuid default gen_random_uuid() not null,
  "numero" character varying(20) not null,
  "cliente_id" uuid not null,
  "usuario_id" uuid,
  "vendedor_id" uuid,
  "subtotal" numeric(12,2) default 0 not null,
  "descuento" numeric(12,2) default 0,
  "impuesto" numeric(12,2) default 0,
  "envio" numeric(12,2) default 0,
  "total" numeric(12,2) default 0 not null,
  "estado" orden_estado default 'pendiente'::orden_estado,
  "fecha_entrega_estimada" date,
  "fecha_entrega_real" timestamp with time zone,
  "direccion_entrega" text,
  "ciudad_entrega" character varying(100),
  "notas" text,
  "metodo_pago" pago_metodo,
  "pagado" boolean default false,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "stock_descontado" boolean default false not null,
  "comprobante_url" text,
  "referencia_pago" text,
  "odoo_id" integer,
  "vendedor_odoo" text,
  "moneda_original" text,
  "estado_odoo" text,
  "fecha_pedido" timestamp with time zone,
  "monto_pagado" numeric default 0 not null,
  "estado_pago" text default 'pendiente'::text not null
);
create table public."pago_cuentas" (
  "id" uuid default gen_random_uuid() not null,
  "pago_id" uuid not null,
  "cuenta_id" uuid not null,
  "monto_aplicado" numeric not null,
  "created_at" timestamp with time zone default now()
);
create table public."pago_facturas" (
  "id" uuid default gen_random_uuid() not null,
  "pago_id" uuid not null,
  "factura_id" uuid not null,
  "monto_aplicado" numeric not null,
  "created_at" timestamp with time zone default now() not null,
  "created_by" uuid
);
create table public."pago_ordenes" (
  "id" uuid default gen_random_uuid() not null,
  "pago_id" uuid not null,
  "orden_id" uuid not null,
  "monto_aplicado" numeric not null,
  "created_at" timestamp with time zone default now()
);
create table public."pagos" (
  "id" uuid default gen_random_uuid() not null,
  "numero" character varying(20) not null,
  "cliente_id" uuid not null,
  "orden_id" uuid,
  "monto" numeric(12,2) not null,
  "metodo" pago_metodo not null,
  "referencia" character varying(100),
  "banco" character varying(100),
  "estado" pago_estado default 'pendiente'::pago_estado,
  "comprobante_url" text,
  "notas" text,
  "verificado_por" uuid,
  "fecha_verificacion" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "banco_id" uuid,
  "moneda" character varying default 'USD'::character varying not null,
  "tasa_cambio" numeric,
  "monto_moneda" numeric,
  "odoo_id" integer
);
create table public."permisos" (
  "id" uuid default gen_random_uuid() not null,
  "rol_id" uuid not null,
  "modulo_id" uuid not null,
  "puede_ver" boolean default false,
  "puede_crear" boolean default false,
  "puede_editar" boolean default false,
  "puede_eliminar" boolean default false,
  "created_at" timestamp with time zone default now()
);
create table public."precios_lista" (
  "id" uuid default gen_random_uuid() not null,
  "lista_precios_id" uuid not null,
  "producto_id" uuid not null,
  "precio" numeric(12,2) not null,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."producto_empaques" (
  "id" uuid default gen_random_uuid() not null,
  "producto_id" uuid not null,
  "tipo_empaque_id" uuid not null,
  "precio_empaque" numeric(12,2),
  "activo" boolean default true,
  "created_at" timestamp with time zone default now()
);
create table public."productos" (
  "id" uuid default gen_random_uuid() not null,
  "sku" character varying(50) not null,
  "nombre" character varying(200) not null,
  "descripcion" text,
  "categoria_id" uuid,
  "unidad" character varying(50) not null,
  "precio_base" numeric(12,2) not null,
  "costo" numeric(12,2),
  "imagen_url" text,
  "imagen_emoji" character varying(10),
  "stock_actual" integer default 0,
  "stock_minimo" integer default 0,
  "stock_maximo" integer,
  "precio_oferta" numeric(12,2),
  "porcentaje_descuento" integer,
  "en_oferta" boolean default false,
  "activo" boolean default true,
  "destacado" boolean default false,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "tipo_empaque_id" uuid,
  "imagenes" jsonb default '[]'::jsonb not null,
  "odoo_id" integer
);
create table public."registros_clientes" (
  "id" uuid default gen_random_uuid() not null,
  "nombre_negocio" character varying(200) not null,
  "tipo_negocio" character varying(100) not null,
  "rif" character varying(20) not null,
  "nombre_contacto" character varying(100) not null,
  "apellido_contacto" character varying(100),
  "email" character varying(255) not null,
  "telefono" character varying(20) not null,
  "direccion" text not null,
  "ciudad" character varying(100) not null,
  "estado" registro_estado default 'pendiente'::registro_estado,
  "notas" text,
  "revisado_por" uuid,
  "fecha_revision" timestamp with time zone,
  "cliente_creado_id" uuid,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "contribuyente_especial" boolean default false not null,
  "direccion_entrega" text,
  "rif_documento_path" text
);
create table public."retencion_items" (
  "id" uuid default gen_random_uuid() not null,
  "retencion_id" uuid not null,
  "factura_id" uuid not null,
  "monto_aplicado" numeric not null,
  "created_at" timestamp with time zone default now() not null,
  "odoo_id" integer
);
create table public."retenciones" (
  "id" uuid default gen_random_uuid() not null,
  "numero" text not null,
  "tipo" text not null,
  "cliente_id" uuid not null,
  "concepto_islr_id" uuid,
  "porcentaje" numeric,
  "base_imponible" numeric default 0 not null,
  "total" numeric default 0 not null,
  "fecha" date default CURRENT_DATE not null,
  "comprobante_url" text,
  "estado" text default 'pendiente'::text not null,
  "declarado_por" uuid,
  "rol_declarante" text not null,
  "revisado_por" uuid,
  "revisado_en" timestamp with time zone,
  "notas" text,
  "odoo_id" integer,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."roles" (
  "id" uuid default gen_random_uuid() not null,
  "nombre" character varying(50) not null,
  "descripcion" character varying(200),
  "color" character varying(20) default 'bg-gray-500'::character varying,
  "es_sistema" boolean default false,
  "activo" boolean default true,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."tasa_bcv" (
  "id" uuid default gen_random_uuid() not null,
  "tasa" numeric(14,4) not null,
  "fuente" text,
  "fecha" date default ((now() AT TIME ZONE 'America/Caracas'::text))::date not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."tipos_empaque" (
  "id" uuid default gen_random_uuid() not null,
  "nombre" character varying(50) not null,
  "descripcion" character varying(200),
  "unidades" integer default 1 not null,
  "activo" boolean default true,
  "orden" integer default 0,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table public."usuarios" (
  "id" uuid default gen_random_uuid() not null,
  "auth_id" uuid,
  "email" character varying(255) not null,
  "nombre" character varying(100) not null,
  "apellido" character varying(100),
  "telefono" character varying(20),
  "avatar_url" text,
  "role" user_role default 'cliente'::user_role not null,
  "activo" boolean default true,
  "cliente_id" uuid,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "rol_id" uuid
);

-- ════════════════ RESTRICCIONES (PK, UNIQUE, CHECK, luego FK) ════════════════

alter table public."almacenes" add constraint "almacenes_odoo_id_key" UNIQUE (odoo_id);
alter table public."almacenes" add constraint "almacenes_pkey" PRIMARY KEY (id);
alter table public."bancos" add constraint "bancos_moneda_check" CHECK (((moneda)::text = ANY ((ARRAY['USD'::character varying, 'BS'::character varying])::text[])));
alter table public."bancos" add constraint "bancos_pkey" PRIMARY KEY (id);
alter table public."banners" add constraint "banners_pkey" PRIMARY KEY (id);
alter table public."carrito" add constraint "carrito_pkey" PRIMARY KEY (id);
alter table public."carrito" add constraint "carrito_usuario_id_producto_id_key" UNIQUE (usuario_id, producto_id);
alter table public."categorias" add constraint "categorias_pkey" PRIMARY KEY (id);
alter table public."clientes" add constraint "clientes_codigo_key" UNIQUE (codigo);
alter table public."clientes" add constraint "clientes_pkey" PRIMARY KEY (id);
alter table public."conceptos_retencion_islr" add constraint "conceptos_retencion_islr_pkey" PRIMARY KEY (id);
alter table public."configuracion" add constraint "configuracion_clave_key" UNIQUE (clave);
alter table public."configuracion" add constraint "configuracion_pkey" PRIMARY KEY (id);
alter table public."cuentas_cobrar" add constraint "cuentas_cobrar_pkey" PRIMARY KEY (id);
alter table public."cupones" add constraint "cupones_codigo_key" UNIQUE (codigo);
alter table public."cupones" add constraint "cupones_pkey" PRIMARY KEY (id);
alter table public."declaracion_consignacion_items" add constraint "declaracion_consignacion_items_cantidad_check" CHECK ((cantidad > (0)::numeric));
alter table public."declaracion_consignacion_items" add constraint "declaracion_consignacion_items_pkey" PRIMARY KEY (id);
alter table public."declaraciones_consignacion" add constraint "declaraciones_consignacion_estado_check" CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text])));
alter table public."declaraciones_consignacion" add constraint "declaraciones_consignacion_pkey" PRIMARY KEY (id);
alter table public."declaraciones_consignacion" add constraint "declaraciones_consignacion_rol_declarante_check" CHECK ((rol_declarante = ANY (ARRAY['cliente'::text, 'vendedor'::text, 'admin'::text])));
alter table public."entregas" add constraint "entregas_pkey" PRIMARY KEY (id);
alter table public."extracto_lineas" add constraint "extracto_lineas_estado_check" CHECK ((estado = ANY (ARRAY['pendiente'::text, 'conciliado'::text, 'descartado'::text])));
alter table public."extracto_lineas" add constraint "extracto_lineas_metodo_match_check" CHECK ((metodo_match = ANY (ARRAY['automatico'::text, 'ia'::text, 'manual'::text])));
alter table public."extracto_lineas" add constraint "extracto_lineas_pkey" PRIMARY KEY (id);
alter table public."extractos_bancarios" add constraint "extractos_bancarios_pkey" PRIMARY KEY (id);
alter table public."factura_items" add constraint "factura_items_odoo_id_key" UNIQUE (odoo_id);
alter table public."factura_items" add constraint "factura_items_pkey" PRIMARY KEY (id);
alter table public."facturas" add constraint "facturas_estado_pago_check" CHECK ((estado_pago = ANY (ARRAY['pendiente'::text, 'parcial'::text, 'pagado'::text, 'anulado'::text])));
alter table public."facturas" add constraint "facturas_moneda_check" CHECK ((moneda = ANY (ARRAY['USD'::text, 'VES'::text])));
alter table public."facturas" add constraint "facturas_odoo_id_key" UNIQUE (odoo_id);
alter table public."facturas" add constraint "facturas_pkey" PRIMARY KEY (id);
alter table public."facturas" add constraint "facturas_tipo_check" CHECK ((tipo = ANY (ARRAY['factura'::text, 'nota_credito'::text])));
alter table public."favoritos" add constraint "favoritos_pkey" PRIMARY KEY (id);
alter table public."favoritos" add constraint "favoritos_usuario_id_producto_id_key" UNIQUE (usuario_id, producto_id);
alter table public."iconos" add constraint "iconos_pkey" PRIMARY KEY (id);
alter table public."inventario_almacen" add constraint "inventario_almacen_almacen_id_producto_id_key" UNIQUE (almacen_id, producto_id);
alter table public."inventario_almacen" add constraint "inventario_almacen_pkey" PRIMARY KEY (id);
alter table public."listas_precios" add constraint "listas_precios_pkey" PRIMARY KEY (id);
alter table public."metas_vendedor" add constraint "metas_vendedor_pkey" PRIMARY KEY (id);
alter table public."metas_vendedor" add constraint "metas_vendedor_vendedor_id_mes_anio_key" UNIQUE (vendedor_id, mes, anio);
alter table public."metodos_pago" add constraint "metodos_pago_pkey" PRIMARY KEY (id);
alter table public."modulos" add constraint "modulos_codigo_key" UNIQUE (codigo);
alter table public."modulos" add constraint "modulos_pkey" PRIMARY KEY (id);
alter table public."movimientos_bancarios" add constraint "movimientos_bancarios_pkey" PRIMARY KEY (id);
alter table public."movimientos_inventario" add constraint "movimientos_inventario_pkey" PRIMARY KEY (id);
alter table public."notificaciones" add constraint "notificaciones_pkey" PRIMARY KEY (id);
alter table public."orden_items" add constraint "orden_items_pkey" PRIMARY KEY (id);
alter table public."ordenes" add constraint "ordenes_numero_key" UNIQUE (numero);
alter table public."ordenes" add constraint "ordenes_pkey" PRIMARY KEY (id);
alter table public."pago_cuentas" add constraint "pago_cuentas_pago_id_cuenta_id_key" UNIQUE (pago_id, cuenta_id);
alter table public."pago_cuentas" add constraint "pago_cuentas_pkey" PRIMARY KEY (id);
alter table public."pago_facturas" add constraint "pago_facturas_monto_aplicado_check" CHECK ((monto_aplicado > (0)::numeric));
alter table public."pago_facturas" add constraint "pago_facturas_pago_id_factura_id_key" UNIQUE (pago_id, factura_id);
alter table public."pago_facturas" add constraint "pago_facturas_pkey" PRIMARY KEY (id);
alter table public."pago_ordenes" add constraint "pago_ordenes_pago_id_orden_id_key" UNIQUE (pago_id, orden_id);
alter table public."pago_ordenes" add constraint "pago_ordenes_pkey" PRIMARY KEY (id);
alter table public."pagos" add constraint "pagos_numero_key" UNIQUE (numero);
alter table public."pagos" add constraint "pagos_pkey" PRIMARY KEY (id);
alter table public."permisos" add constraint "permisos_pkey" PRIMARY KEY (id);
alter table public."permisos" add constraint "permisos_rol_id_modulo_id_key" UNIQUE (rol_id, modulo_id);
alter table public."precios_lista" add constraint "precios_lista_lista_precios_id_producto_id_key" UNIQUE (lista_precios_id, producto_id);
alter table public."precios_lista" add constraint "precios_lista_pkey" PRIMARY KEY (id);
alter table public."producto_empaques" add constraint "producto_empaques_pkey" PRIMARY KEY (id);
alter table public."producto_empaques" add constraint "producto_empaques_producto_id_tipo_empaque_id_key" UNIQUE (producto_id, tipo_empaque_id);
alter table public."productos" add constraint "productos_pkey" PRIMARY KEY (id);
alter table public."productos" add constraint "productos_sku_key" UNIQUE (sku);
alter table public."registros_clientes" add constraint "registros_clientes_pkey" PRIMARY KEY (id);
alter table public."retencion_items" add constraint "retencion_items_monto_aplicado_check" CHECK ((monto_aplicado > (0)::numeric));
alter table public."retencion_items" add constraint "retencion_items_odoo_id_key" UNIQUE (odoo_id);
alter table public."retencion_items" add constraint "retencion_items_pkey" PRIMARY KEY (id);
alter table public."retenciones" add constraint "retenciones_estado_check" CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text])));
alter table public."retenciones" add constraint "retenciones_odoo_id_key" UNIQUE (odoo_id);
alter table public."retenciones" add constraint "retenciones_pkey" PRIMARY KEY (id);
alter table public."retenciones" add constraint "retenciones_rol_declarante_check" CHECK ((rol_declarante = ANY (ARRAY['cliente'::text, 'vendedor'::text, 'admin'::text])));
alter table public."retenciones" add constraint "retenciones_tipo_check" CHECK ((tipo = ANY (ARRAY['iva'::text, 'islr'::text])));
alter table public."roles" add constraint "roles_nombre_key" UNIQUE (nombre);
alter table public."roles" add constraint "roles_pkey" PRIMARY KEY (id);
alter table public."tasa_bcv" add constraint "tasa_bcv_pkey" PRIMARY KEY (id);
alter table public."tipos_empaque" add constraint "tipos_empaque_nombre_key" UNIQUE (nombre);
alter table public."tipos_empaque" add constraint "tipos_empaque_pkey" PRIMARY KEY (id);
alter table public."usuarios" add constraint "usuarios_auth_id_key" UNIQUE (auth_id);
alter table public."usuarios" add constraint "usuarios_email_key" UNIQUE (email);
alter table public."usuarios" add constraint "usuarios_pkey" PRIMARY KEY (id);
alter table public."usuarios" add constraint "usuarios_rol_id_requerido_check" CHECK (((role = 'cliente'::user_role) OR (rol_id IS NOT NULL)));
alter table public."almacenes" add constraint "almacenes_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;
alter table public."carrito" add constraint "carrito_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
alter table public."carrito" add constraint "carrito_tipo_empaque_id_fkey" FOREIGN KEY (tipo_empaque_id) REFERENCES tipos_empaque(id);
alter table public."carrito" add constraint "carrito_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
alter table public."clientes" add constraint "clientes_lista_precios_id_fkey" FOREIGN KEY (lista_precios_id) REFERENCES listas_precios(id);
alter table public."clientes" add constraint "clientes_registro_origen_id_fkey" FOREIGN KEY (registro_origen_id) REFERENCES registros_clientes(id);
alter table public."clientes" add constraint "clientes_vendedor_asignado_id_fkey" FOREIGN KEY (vendedor_asignado_id) REFERENCES usuarios(id);
alter table public."cuentas_cobrar" add constraint "cuentas_cobrar_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
alter table public."cupones" add constraint "cupones_cliente_especifico_id_fkey" FOREIGN KEY (cliente_especifico_id) REFERENCES clientes(id);
alter table public."declaracion_consignacion_items" add constraint "declaracion_consignacion_items_declaracion_id_fkey" FOREIGN KEY (declaracion_id) REFERENCES declaraciones_consignacion(id) ON DELETE CASCADE;
alter table public."declaracion_consignacion_items" add constraint "declaracion_consignacion_items_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public."declaraciones_consignacion" add constraint "declaraciones_consignacion_almacen_id_fkey" FOREIGN KEY (almacen_id) REFERENCES almacenes(id);
alter table public."declaraciones_consignacion" add constraint "declaraciones_consignacion_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public."declaraciones_consignacion" add constraint "declaraciones_consignacion_declarado_por_fkey" FOREIGN KEY (declarado_por) REFERENCES usuarios(id);
alter table public."declaraciones_consignacion" add constraint "declaraciones_consignacion_factura_id_fkey" FOREIGN KEY (factura_id) REFERENCES facturas(id);
alter table public."declaraciones_consignacion" add constraint "declaraciones_consignacion_revisado_por_fkey" FOREIGN KEY (revisado_por) REFERENCES usuarios(id);
alter table public."entregas" add constraint "entregas_orden_id_fkey" FOREIGN KEY (orden_id) REFERENCES ordenes(id);
alter table public."entregas" add constraint "entregas_repartidor_id_fkey" FOREIGN KEY (repartidor_id) REFERENCES usuarios(id);
alter table public."extracto_lineas" add constraint "extracto_lineas_extracto_id_fkey" FOREIGN KEY (extracto_id) REFERENCES extractos_bancarios(id) ON DELETE CASCADE;
alter table public."extracto_lineas" add constraint "extracto_lineas_movimiento_bancario_id_fkey" FOREIGN KEY (movimiento_bancario_id) REFERENCES movimientos_bancarios(id);
alter table public."extracto_lineas" add constraint "extracto_lineas_revisado_por_fkey" FOREIGN KEY (revisado_por) REFERENCES usuarios(id);
alter table public."extractos_bancarios" add constraint "extractos_bancarios_banco_id_fkey" FOREIGN KEY (banco_id) REFERENCES bancos(id);
alter table public."extractos_bancarios" add constraint "extractos_bancarios_cargado_por_fkey" FOREIGN KEY (cargado_por) REFERENCES usuarios(id);
alter table public."factura_items" add constraint "factura_items_factura_id_fkey" FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE CASCADE;
alter table public."factura_items" add constraint "factura_items_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public."facturas" add constraint "facturas_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public."facturas" add constraint "facturas_orden_id_fkey" FOREIGN KEY (orden_id) REFERENCES ordenes(id);
alter table public."favoritos" add constraint "favoritos_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
alter table public."favoritos" add constraint "favoritos_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
alter table public."inventario_almacen" add constraint "inventario_almacen_almacen_id_fkey" FOREIGN KEY (almacen_id) REFERENCES almacenes(id) ON DELETE CASCADE;
alter table public."inventario_almacen" add constraint "inventario_almacen_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
alter table public."metas_vendedor" add constraint "metas_vendedor_vendedor_id_fkey" FOREIGN KEY (vendedor_id) REFERENCES usuarios(id);
alter table public."movimientos_bancarios" add constraint "movimientos_bancarios_banco_id_fkey" FOREIGN KEY (banco_id) REFERENCES bancos(id) ON DELETE CASCADE;
alter table public."movimientos_bancarios" add constraint "movimientos_bancarios_pago_id_fkey" FOREIGN KEY (pago_id) REFERENCES pagos(id) ON DELETE SET NULL;
alter table public."movimientos_inventario" add constraint "movimientos_inventario_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public."movimientos_inventario" add constraint "movimientos_inventario_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public."notificaciones" add constraint "notificaciones_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
alter table public."orden_items" add constraint "orden_items_orden_id_fkey" FOREIGN KEY (orden_id) REFERENCES ordenes(id) ON DELETE CASCADE;
alter table public."orden_items" add constraint "orden_items_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public."ordenes" add constraint "ordenes_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public."ordenes" add constraint "ordenes_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public."ordenes" add constraint "ordenes_vendedor_id_fkey" FOREIGN KEY (vendedor_id) REFERENCES usuarios(id);
alter table public."pago_cuentas" add constraint "pago_cuentas_cuenta_id_fkey" FOREIGN KEY (cuenta_id) REFERENCES cuentas_cobrar(id) ON DELETE CASCADE;
alter table public."pago_cuentas" add constraint "pago_cuentas_pago_id_fkey" FOREIGN KEY (pago_id) REFERENCES pagos(id) ON DELETE CASCADE;
alter table public."pago_facturas" add constraint "pago_facturas_created_by_fkey" FOREIGN KEY (created_by) REFERENCES usuarios(id);
alter table public."pago_facturas" add constraint "pago_facturas_factura_id_fkey" FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE RESTRICT;
alter table public."pago_facturas" add constraint "pago_facturas_pago_id_fkey" FOREIGN KEY (pago_id) REFERENCES pagos(id) ON DELETE CASCADE;
alter table public."pago_ordenes" add constraint "pago_ordenes_orden_id_fkey" FOREIGN KEY (orden_id) REFERENCES ordenes(id) ON DELETE CASCADE;
alter table public."pago_ordenes" add constraint "pago_ordenes_pago_id_fkey" FOREIGN KEY (pago_id) REFERENCES pagos(id) ON DELETE CASCADE;
alter table public."pagos" add constraint "pagos_banco_id_fkey" FOREIGN KEY (banco_id) REFERENCES bancos(id);
alter table public."pagos" add constraint "pagos_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public."pagos" add constraint "pagos_orden_id_fkey" FOREIGN KEY (orden_id) REFERENCES ordenes(id);
alter table public."pagos" add constraint "pagos_verificado_por_fkey" FOREIGN KEY (verificado_por) REFERENCES usuarios(id);
alter table public."permisos" add constraint "permisos_modulo_id_fkey" FOREIGN KEY (modulo_id) REFERENCES modulos(id) ON DELETE CASCADE;
alter table public."permisos" add constraint "permisos_rol_id_fkey" FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE;
alter table public."precios_lista" add constraint "precios_lista_lista_precios_id_fkey" FOREIGN KEY (lista_precios_id) REFERENCES listas_precios(id) ON DELETE CASCADE;
alter table public."precios_lista" add constraint "precios_lista_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
alter table public."producto_empaques" add constraint "producto_empaques_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
alter table public."producto_empaques" add constraint "producto_empaques_tipo_empaque_id_fkey" FOREIGN KEY (tipo_empaque_id) REFERENCES tipos_empaque(id) ON DELETE CASCADE;
alter table public."productos" add constraint "productos_categoria_id_fkey" FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL;
alter table public."productos" add constraint "productos_tipo_empaque_id_fkey" FOREIGN KEY (tipo_empaque_id) REFERENCES tipos_empaque(id);
alter table public."registros_clientes" add constraint "registros_clientes_revisado_por_fkey" FOREIGN KEY (revisado_por) REFERENCES usuarios(id);
alter table public."retencion_items" add constraint "retencion_items_factura_id_fkey" FOREIGN KEY (factura_id) REFERENCES facturas(id);
alter table public."retencion_items" add constraint "retencion_items_retencion_id_fkey" FOREIGN KEY (retencion_id) REFERENCES retenciones(id) ON DELETE CASCADE;
alter table public."retenciones" add constraint "retenciones_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public."retenciones" add constraint "retenciones_concepto_islr_id_fkey" FOREIGN KEY (concepto_islr_id) REFERENCES conceptos_retencion_islr(id);
alter table public."retenciones" add constraint "retenciones_declarado_por_fkey" FOREIGN KEY (declarado_por) REFERENCES usuarios(id);
alter table public."retenciones" add constraint "retenciones_revisado_por_fkey" FOREIGN KEY (revisado_por) REFERENCES usuarios(id);
alter table public."usuarios" add constraint "fk_usuarios_cliente" FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;
alter table public."usuarios" add constraint "usuarios_auth_id_fkey" FOREIGN KEY (auth_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."usuarios" add constraint "usuarios_rol_id_fkey" FOREIGN KEY (rol_id) REFERENCES roles(id);

-- ════════════════ ÍNDICES (los que no respaldan una restricción) ════════════════

CREATE INDEX almacenes_cliente_idx ON public.almacenes USING btree (cliente_id);
CREATE UNIQUE INDEX bancos_odoo_id_key ON public.bancos USING btree (odoo_id);
CREATE INDEX idx_carrito_usuario ON public.carrito USING btree (usuario_id);
CREATE UNIQUE INDEX categorias_odoo_id_key ON public.categorias USING btree (odoo_id);
CREATE UNIQUE INDEX clientes_odoo_id_key ON public.clientes USING btree (odoo_id);
CREATE INDEX idx_clientes_codigo ON public.clientes USING btree (codigo);
CREATE INDEX idx_clientes_lista_precios ON public.clientes USING btree (lista_precios_id);
CREATE INDEX idx_clientes_rif ON public.clientes USING btree (rif);
CREATE INDEX idx_clientes_vendedor ON public.clientes USING btree (vendedor_asignado_id);
CREATE INDEX cuentas_cobrar_cliente_idx ON public.cuentas_cobrar USING btree (cliente_id);
CREATE INDEX idx_cupones_activo ON public.cupones USING btree (activo);
CREATE INDEX idx_cupones_codigo ON public.cupones USING btree (codigo);
CREATE INDEX declaracion_consignacion_items_declaracion_idx ON public.declaracion_consignacion_items USING btree (declaracion_id);
CREATE INDEX declaraciones_consignacion_almacen_idx ON public.declaraciones_consignacion USING btree (almacen_id);
CREATE INDEX declaraciones_consignacion_cliente_idx ON public.declaraciones_consignacion USING btree (cliente_id);
CREATE INDEX declaraciones_consignacion_estado_idx ON public.declaraciones_consignacion USING btree (estado);
CREATE INDEX idx_entregas_estado ON public.entregas USING btree (estado);
CREATE INDEX idx_entregas_fecha ON public.entregas USING btree (fecha_asignacion DESC);
CREATE INDEX idx_entregas_orden ON public.entregas USING btree (orden_id);
CREATE INDEX idx_entregas_repartidor ON public.entregas USING btree (repartidor_id);
CREATE INDEX extracto_lineas_estado_idx ON public.extracto_lineas USING btree (estado);
CREATE INDEX extracto_lineas_extracto_idx ON public.extracto_lineas USING btree (extracto_id);
CREATE UNIQUE INDEX extracto_lineas_movimiento_uq ON public.extracto_lineas USING btree (movimiento_bancario_id) WHERE (movimiento_bancario_id IS NOT NULL);
CREATE INDEX factura_items_factura_id_idx ON public.factura_items USING btree (factura_id);
CREATE INDEX facturas_cliente_id_idx ON public.facturas USING btree (cliente_id);
CREATE INDEX facturas_deuda_idx ON public.facturas USING btree (cliente_id) INCLUDE (saldo_usd) WHERE (estado = 'posted'::text);
CREATE INDEX facturas_estado_pago_idx ON public.facturas USING btree (estado_pago);
CREATE INDEX facturas_orden_id_idx ON public.facturas USING btree (orden_id);
CREATE INDEX idx_favoritos_producto ON public.favoritos USING btree (producto_id);
CREATE INDEX idx_favoritos_usuario ON public.favoritos USING btree (usuario_id);
CREATE INDEX inventario_almacen_producto_idx ON public.inventario_almacen USING btree (producto_id);
CREATE INDEX idx_metas_periodo ON public.metas_vendedor USING btree (anio, mes);
CREATE INDEX idx_metas_vendedor ON public.metas_vendedor USING btree (vendedor_id);
CREATE INDEX movimientos_banco_idx ON public.movimientos_bancarios USING btree (banco_id);
CREATE INDEX idx_movimientos_fecha ON public.movimientos_inventario USING btree (created_at DESC);
CREATE INDEX idx_movimientos_producto ON public.movimientos_inventario USING btree (producto_id);
CREATE INDEX idx_notificaciones_fecha ON public.notificaciones USING btree (created_at DESC);
CREATE INDEX idx_notificaciones_leida ON public.notificaciones USING btree (leida);
CREATE INDEX idx_notificaciones_usuario ON public.notificaciones USING btree (usuario_id);
CREATE INDEX idx_orden_items_orden ON public.orden_items USING btree (orden_id);
CREATE INDEX idx_orden_items_producto ON public.orden_items USING btree (producto_id);
CREATE UNIQUE INDEX orden_items_odoo_id_key ON public.orden_items USING btree (odoo_id);
CREATE INDEX idx_ordenes_cliente ON public.ordenes USING btree (cliente_id);
CREATE INDEX idx_ordenes_estado ON public.ordenes USING btree (estado);
CREATE INDEX idx_ordenes_fecha ON public.ordenes USING btree (created_at DESC);
CREATE INDEX idx_ordenes_numero ON public.ordenes USING btree (numero);
CREATE INDEX idx_ordenes_vendedor ON public.ordenes USING btree (vendedor_id);
CREATE UNIQUE INDEX ordenes_odoo_id_key ON public.ordenes USING btree (odoo_id);
CREATE INDEX pago_facturas_factura_idx ON public.pago_facturas USING btree (factura_id);
CREATE INDEX pago_facturas_pago_idx ON public.pago_facturas USING btree (pago_id);
CREATE INDEX pago_ordenes_orden_idx ON public.pago_ordenes USING btree (orden_id);
CREATE INDEX idx_pagos_cliente ON public.pagos USING btree (cliente_id);
CREATE INDEX idx_pagos_estado ON public.pagos USING btree (estado);
CREATE INDEX idx_pagos_numero ON public.pagos USING btree (numero);
CREATE INDEX idx_pagos_orden ON public.pagos USING btree (orden_id);
CREATE UNIQUE INDEX pagos_odoo_id_key ON public.pagos USING btree (odoo_id);
CREATE INDEX idx_precios_lista_lista ON public.precios_lista USING btree (lista_precios_id);
CREATE INDEX idx_precios_lista_producto ON public.precios_lista USING btree (producto_id);
CREATE INDEX idx_productos_activo ON public.productos USING btree (activo);
CREATE INDEX idx_productos_categoria ON public.productos USING btree (categoria_id);
CREATE INDEX idx_productos_destacado ON public.productos USING btree (destacado);
CREATE INDEX idx_productos_sku ON public.productos USING btree (sku);
CREATE UNIQUE INDEX productos_odoo_id_key ON public.productos USING btree (odoo_id);
CREATE INDEX idx_registros_email ON public.registros_clientes USING btree (email);
CREATE INDEX idx_registros_estado ON public.registros_clientes USING btree (estado);
CREATE INDEX retencion_items_factura_idx ON public.retencion_items USING btree (factura_id);
CREATE INDEX retencion_items_retencion_idx ON public.retencion_items USING btree (retencion_id);
CREATE INDEX retenciones_cliente_idx ON public.retenciones USING btree (cliente_id);
CREATE INDEX retenciones_estado_idx ON public.retenciones USING btree (estado);
CREATE INDEX idx_usuarios_cliente_id ON public.usuarios USING btree (cliente_id);
CREATE INDEX idx_usuarios_email ON public.usuarios USING btree (email);
CREATE INDEX idx_usuarios_role ON public.usuarios USING btree (role);

-- ════════════════ VISTAS ════════════════

create or replace view public."v_anticipos" as
 SELECT id AS pago_id,
    numero,
    cliente_id,
    created_at,
    monto AS monto_usd,
    COALESCE(( SELECT sum(pf.monto_aplicado) AS sum
           FROM pago_facturas pf
          WHERE (pf.pago_id = p.id)), (0)::numeric) AS aplicado,
    round((monto - COALESCE(( SELECT sum(pf.monto_aplicado) AS sum
           FROM pago_facturas pf
          WHERE (pf.pago_id = p.id)), (0)::numeric)), 2) AS disponible
   FROM pagos p
  WHERE ((estado = 'verificado'::pago_estado) AND (odoo_id IS NULL));

-- ════════════════ FUNCIONES ════════════════

CREATE OR REPLACE FUNCTION public.actualizar_estado_entrega(p_entrega_id uuid, p_estado entrega_estado, p_receptor text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text, p_firma_url text DEFAULT NULL::text, p_foto_url text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ent record; v_mine boolean;
begin
  select * into v_ent from entregas where id = p_entrega_id;
  if not found then raise exception 'Entrega no encontrada'; end if;

  v_mine := exists (select 1 from usuarios where id = v_ent.repartidor_id and auth_id = auth.uid());
  if not (v_mine or public.is_admin()) then
    raise exception 'No autorizado para actualizar esta entrega';
  end if;

  update entregas set
    estado = p_estado,
    fecha_inicio_entrega = case when p_estado = 'en_camino' then coalesce(fecha_inicio_entrega, now()) else fecha_inicio_entrega end,
    fecha_entrega = case when p_estado = 'entregada' then now() else fecha_entrega end,
    receptor_nombre = coalesce(p_receptor, receptor_nombre),
    notas = coalesce(p_notas, notas),
    motivo_fallo = case when p_estado = 'fallida' then p_motivo else motivo_fallo end,
    firma_url = coalesce(p_firma_url, firma_url),
    foto_entrega_url = coalesce(p_foto_url, foto_entrega_url),
    updated_at = now()
  where id = p_entrega_id;

  if p_estado = 'en_camino' then
    update ordenes set estado = 'enviado' where id = v_ent.orden_id and estado in ('pendiente','confirmado','procesando');
  elsif p_estado = 'entregada' then
    update ordenes set estado = 'completado', fecha_entrega_real = now() where id = v_ent.orden_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_stock_orden()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Descontar (idempotente): primera vez que la orden llega a un estado de preparacion/despacho
  if not old.stock_descontado
     and new.estado in ('procesando','enviado','completado') then

    update productos p
      set stock_actual = p.stock_actual - oi.cantidad
    from orden_items oi
    where oi.orden_id = new.id and p.id = oi.producto_id;

    insert into movimientos_inventario
      (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, referencia_id, referencia_tipo)
    select oi.producto_id, 'salida', oi.cantidad,
           p.stock_actual + oi.cantidad, p.stock_actual,
           'Venta - Orden ' || new.numero, new.id, 'orden'
    from orden_items oi join productos p on p.id = oi.producto_id
    where oi.orden_id = new.id;

    new.stock_descontado := true;

  -- Reponer: la orden se cancela despues de haber descontado
  elsif old.stock_descontado
        and new.estado = 'cancelado' then

    update productos p
      set stock_actual = p.stock_actual + oi.cantidad
    from orden_items oi
    where oi.orden_id = new.id and p.id = oi.producto_id;

    insert into movimientos_inventario
      (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, referencia_id, referencia_tipo)
    select oi.producto_id, 'entrada', oi.cantidad,
           p.stock_actual - oi.cantidad, p.stock_actual,
           'Reposicion por cancelacion - Orden ' || new.numero, new.id, 'orden'
    from orden_items oi join productos p on p.id = oi.producto_id
    where oi.orden_id = new.id;

    new.stock_descontado := false;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.aplicar_anticipo(p_pago_id uuid, p_asignaciones jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p public.pagos%rowtype;
  v_asignado numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede aplicar anticipos';
  end if;
  select * into p from public.pagos where id = p_pago_id;
  if not found or p.estado <> 'verificado' then
    raise exception 'El pago debe existir y estar verificado';
  end if;

  v_asignado := public.aplicar_pago_a_facturas(p_pago_id, p_asignaciones);
  perform public.recalcular_credito(p.cliente_id);

  return jsonb_build_object('aplicado', v_asignado);
end;
$function$;

CREATE OR REPLACE FUNCTION public.aplicar_pago_a_facturas(p_pago_id uuid, p_asignaciones jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pago public.pagos%rowtype;
  v_ya_aplicado numeric;
  v_disponible numeric;
  v_total_asignado numeric := 0;
  r record;
begin
  select * into v_pago from public.pagos where id = p_pago_id;
  if not found then
    raise exception 'Pago % no existe', p_pago_id;
  end if;

  select coalesce(sum(monto_aplicado), 0) into v_ya_aplicado
  from public.pago_facturas where pago_id = p_pago_id;
  v_disponible := round(v_pago.monto - v_ya_aplicado, 2);

  -- Agrupa asignaciones por factura y descarta montos <= 0.
  for r in
    select (x->>'factura_id')::uuid as factura_id, round(sum((x->>'monto')::numeric), 2) as monto
    from jsonb_array_elements(coalesce(p_asignaciones, '[]'::jsonb)) x
    where (x->>'monto')::numeric > 0
    group by (x->>'factura_id')::uuid
  loop
    v_total_asignado := v_total_asignado + r.monto;
  end loop;

  if v_total_asignado <= 0 then
    return 0; -- nada que asignar (queda todo como anticipo)
  end if;

  if v_total_asignado > v_disponible + 0.01 then
    raise exception 'La asignación ($%) excede el monto disponible del pago ($%)', v_total_asignado, v_disponible;
  end if;

  for r in
    select (x->>'factura_id')::uuid as factura_id, round(sum((x->>'monto')::numeric), 2) as monto
    from jsonb_array_elements(coalesce(p_asignaciones, '[]'::jsonb)) x
    where (x->>'monto')::numeric > 0
    group by (x->>'factura_id')::uuid
  loop
    declare
      f public.facturas%rowtype;
    begin
      select * into f from public.facturas where id = r.factura_id;
      if not found then
        raise exception 'Factura % no existe', r.factura_id;
      end if;
      if f.cliente_id is distinct from v_pago.cliente_id then
        raise exception 'La factura % no pertenece al cliente del pago', f.numero;
      end if;
      if f.estado <> 'posted' or f.estado_pago = 'anulado' then
        raise exception 'La factura % no admite cobros (anulada o no vigente)', f.numero;
      end if;
      if f.tipo <> 'factura' then
        raise exception 'La factura % es una nota de crédito: no se cobra, se aplica aparte', f.numero;
      end if;
      if r.monto > f.saldo_usd + 0.01 then
        raise exception 'La factura % solo tiene saldo $%', f.numero, f.saldo_usd;
      end if;

      insert into public.pago_facturas (pago_id, factura_id, monto_aplicado, created_by)
      values (p_pago_id, r.factura_id, r.monto, (select id from public.usuarios where auth_id = auth.uid()))
      on conflict (pago_id, factura_id) do update
        set monto_aplicado = public.pago_facturas.monto_aplicado + excluded.monto_aplicado;
    end;
  end loop;

  return v_total_asignado;
end;
$function$;

CREATE OR REPLACE FUNCTION public.aplicar_sugerencia_ia(p_linea_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid;
  v_movimiento_id uuid;
  v_confianza numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede conciliar';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  select (sugerencia_ia->>'movimiento_bancario_id')::uuid, (sugerencia_ia->>'confianza')::numeric
    into v_movimiento_id, v_confianza
  from public.extracto_lineas where id = p_linea_id and estado = 'pendiente';

  if v_movimiento_id is null then
    raise exception 'Esta línea no tiene una sugerencia de IA aplicable';
  end if;
  if exists (select 1 from public.extracto_lineas where movimiento_bancario_id = v_movimiento_id) then
    raise exception 'Ese movimiento ya está conciliado con otra línea';
  end if;

  update public.extracto_lineas
  set estado = 'conciliado', movimiento_bancario_id = v_movimiento_id,
      metodo_match = 'ia', confianza = v_confianza, revisado_por = v_admin, revisado_en = now()
  where id = p_linea_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.aprobar_registro_cliente(p_registro_id uuid, p_admin_id uuid DEFAULT NULL::uuid, p_lista_precios_id uuid DEFAULT NULL::uuid, p_vendedor_id uuid DEFAULT NULL::uuid, p_limite_credito numeric DEFAULT 0, p_dias_credito integer DEFAULT 0)
 RETURNS TABLE(cliente_id uuid, email text, password_temporal text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_registro RECORD;
  v_cliente_id uuid;
  v_codigo text;
  v_lista_id uuid;
  v_auth_id uuid;
  v_pass text;
  v_admin uuid;
begin
  select * into v_registro from registros_clientes where id = p_registro_id;
  if v_registro is null then raise exception 'Registro no encontrado'; end if;
  if v_registro.estado <> 'pendiente' then raise exception 'El registro ya fue procesado'; end if;

  v_admin := coalesce(p_admin_id, (select id from usuarios where auth_id = auth.uid()));

  if p_lista_precios_id is null then
    select id into v_lista_id from listas_precios where es_default = true limit 1;
  else
    v_lista_id := p_lista_precios_id;
  end if;

  v_codigo := generar_codigo_cliente();

  insert into clientes (
    codigo, nombre_negocio, tipo_negocio, rif, email, telefono,
    direccion, direccion_entrega, ciudad, contribuyente_especial,
    lista_precios_id, vendedor_asignado_id,
    limite_credito, dias_credito, registro_origen_id
  ) values (
    v_codigo, v_registro.nombre_negocio, v_registro.tipo_negocio,
    v_registro.rif, v_registro.email, v_registro.telefono,
    v_registro.direccion, v_registro.direccion_entrega, v_registro.ciudad,
    v_registro.contribuyente_especial, v_lista_id, p_vendedor_id,
    p_limite_credito, p_dias_credito, p_registro_id
  ) returning id into v_cliente_id;

  v_pass := generar_password_temporal();
  v_auth_id := public.crear_auth_user(v_registro.email, v_pass);

  insert into usuarios (auth_id, email, nombre, apellido, telefono, role, cliente_id, activo)
  values (v_auth_id, v_registro.email, v_registro.nombre_contacto, v_registro.apellido_contacto,
          v_registro.telefono, 'cliente', v_cliente_id, true);

  update registros_clientes set
    estado = 'aprobado', revisado_por = v_admin, fecha_revision = now(), cliente_creado_id = v_cliente_id
  where id = p_registro_id;

  return query select v_cliente_id, v_registro.email::text, v_pass;
end;
$function$;

CREATE OR REPLACE FUNCTION public.asignar_entrega(p_orden_id uuid, p_repartidor_id uuid, p_prioridad text DEFAULT 'normal'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede asignar entregas'; end if;
  if exists (select 1 from entregas where orden_id = p_orden_id and estado <> 'fallida') then
    raise exception 'La orden ya tiene una entrega asignada';
  end if;
  insert into entregas (orden_id, repartidor_id, estado, prioridad, fecha_asignacion)
  values (p_orden_id, p_repartidor_id, 'asignada', coalesce(p_prioridad,'normal'), now())
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cerrar_mi_cuenta()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_uid uuid := auth.uid(); v_usuario_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select id into v_usuario_id from usuarios where auth_id = v_uid;

  if v_usuario_id is not null then
    delete from carrito where usuario_id = v_usuario_id;
    delete from favoritos where usuario_id = v_usuario_id;
    -- Bypass del guard (cierre de la propia cuenta), solo en esta transacci�n
    perform set_config('guds.bypass_guard', 'on', true);
    -- Desligar de auth y desactivar (se conserva la fila para el historial)
    update usuarios set activo = false, auth_id = null where id = v_usuario_id;
    perform set_config('guds.bypass_guard', 'off', true);
  end if;

  -- Revocar el acceso: eliminar la cuenta de autenticaci�n
  delete from auth.identities where user_id = v_uid;
  delete from auth.users where id = v_uid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.conciliar_extracto_automatico(p_extracto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_banco_id uuid;
  v_conciliadas int := 0;
  v_pendientes int := 0;
  r record;
  v_candidatos uuid[];
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede conciliar';
  end if;

  select banco_id into v_banco_id from public.extractos_bancarios where id = p_extracto_id;
  if v_banco_id is null then
    raise exception 'Extracto % no existe', p_extracto_id;
  end if;

  for r in
    select id, fecha, monto from public.extracto_lineas
    where extracto_id = p_extracto_id and estado = 'pendiente'
  loop
    select array_agg(m.id) into v_candidatos
    from public.movimientos_bancarios m
    where m.banco_id = v_banco_id
      and m.tipo = (case when r.monto >= 0 then 'entrada' else 'salida' end)
      and abs(abs(m.monto) - abs(r.monto)) <= 0.01
      and abs(m.fecha::date - r.fecha) <= 3
      and not exists (select 1 from public.extracto_lineas el2 where el2.movimiento_bancario_id = m.id);

    if v_candidatos is not null and array_length(v_candidatos, 1) = 1 then
      update public.extracto_lineas
      set estado = 'conciliado', movimiento_bancario_id = v_candidatos[1],
          metodo_match = 'automatico', confianza = 100, revisado_en = now()
      where id = r.id;
      v_conciliadas := v_conciliadas + 1;
    else
      v_pendientes := v_pendientes + 1;
    end if;
  end loop;

  return jsonb_build_object('conciliadas', v_conciliadas, 'pendientes', v_pendientes);
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_match_extracto(p_linea_id uuid, p_movimiento_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede conciliar';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  if not exists (select 1 from public.movimientos_bancarios where id = p_movimiento_id) then
    raise exception 'Movimiento % no existe', p_movimiento_id;
  end if;
  if exists (select 1 from public.extracto_lineas where movimiento_bancario_id = p_movimiento_id) then
    raise exception 'Ese movimiento ya está conciliado con otra línea';
  end if;

  update public.extracto_lineas
  set estado = 'conciliado', movimiento_bancario_id = p_movimiento_id,
      metodo_match = 'manual', revisado_por = v_admin, revisado_en = now()
  where id = p_linea_id and estado = 'pendiente';

  if not found then
    raise exception 'La línea no existe o ya fue procesada';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crear_auth_user(p_email text, p_password text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare v_id uuid := gen_random_uuid();
begin
  if exists (select 1 from auth.users where email = lower(p_email)) then
    raise exception 'Ya existe una cuenta con el email %', p_email;
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', lower(p_email),
    crypt(p_password, gen_salt('bf')), now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', v_id::text, 'email', lower(p_email), 'email_verified', true),
    now(), now()
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at
  ) values (
    gen_random_uuid(), v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', lower(p_email), 'email_verified', true),
    'email', now(), now(), now()
  );

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crear_extracto_bancario(p_banco_id uuid, p_nombre_archivo text, p_moneda text, p_lineas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid;
  v_extracto_id uuid;
  v_min date; v_max date; v_n int;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cargar extractos bancarios';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  if not exists (select 1 from public.bancos where id = p_banco_id) then
    raise exception 'Banco % no existe', p_banco_id;
  end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'El extracto no tiene líneas para cargar';
  end if;

  select min((x->>'fecha')::date), max((x->>'fecha')::date), count(*)
    into v_min, v_max, v_n
  from jsonb_array_elements(p_lineas) x;

  insert into public.extractos_bancarios (banco_id, nombre_archivo, moneda, fecha_desde, fecha_hasta, total_lineas, cargado_por)
  values (p_banco_id, p_nombre_archivo, coalesce(p_moneda, 'USD'), v_min, v_max, v_n, v_admin)
  returning id into v_extracto_id;

  insert into public.extracto_lineas (extracto_id, fecha, monto, referencia, descripcion)
  select v_extracto_id, (x->>'fecha')::date, (x->>'monto')::numeric, x->>'referencia', x->>'descripcion'
  from jsonb_array_elements(p_lineas) x;

  return v_extracto_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crear_orden_admin(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb)
 RETURNS TABLE(orden_id uuid, numero character varying, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario_id uuid; v_subtotal numeric := 0;
  v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar; v_limite numeric; v_utilizado numeric;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede crear ordenes aqui'; end if;
  if p_cliente_id is null then raise exception 'Falta el cliente'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La orden no tiene items'; end if;

  select id into v_usuario_id from usuarios where auth_id = auth.uid();

  -- precio efectivo por lista del cliente (ignora el precio pasado, para integridad)
  select coalesce(sum((it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, null, p_cliente_id)),0)
    into v_subtotal
  from jsonb_array_elements(p_items) it;

  select coalesce(max(case when clave='iva_porcentaje' then valor::numeric end),16),
         coalesce(max(case when clave='costo_envio' then valor::numeric end),50),
         coalesce(max(case when clave='envio_gratis_minimo' then valor::numeric end),500)
    into v_iva_pct, v_costo_envio, v_envio_gratis_min
  from configuracion where clave in ('iva_porcentaje','costo_envio','envio_gratis_minimo');

  v_impuesto := round(v_subtotal * (v_iva_pct/100.0), 2);
  v_envio := case when v_subtotal >= v_envio_gratis_min then 0 else v_costo_envio end;
  v_total := v_subtotal + v_impuesto + v_envio;

  if p_metodo_pago = 'credito' then
    select limite_credito, credito_utilizado into v_limite, v_utilizado from clientes where id = p_cliente_id;
    if coalesce(v_utilizado,0) + v_total > coalesce(v_limite,0) then
      raise exception 'Cr�dito insuficiente: disponible %, requerido %',
        coalesce(v_limite,0) - coalesce(v_utilizado,0), v_total;
    end if;
  end if;

  v_numero := generar_numero_orden();
  insert into ordenes (numero, cliente_id, usuario_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas)
  values (v_numero, p_cliente_id, v_usuario_id, v_subtotal, 0, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''))
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal)
  select v_orden_id, (it->>'producto_id')::uuid, (it->>'cantidad')::int,
         public.precio_efectivo((it->>'producto_id')::uuid, null, p_cliente_id), 0,
         (it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, null, p_cliente_id)
  from jsonb_array_elements(p_items) it;

  return query select v_orden_id, v_numero, v_total;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crear_orden_desde_carrito(p_metodo_pago pago_metodo, p_notas text DEFAULT ''::text, p_cupon_id uuid DEFAULT NULL::uuid, p_comprobante_url text DEFAULT NULL::text, p_referencia text DEFAULT NULL::text, p_banco_id uuid DEFAULT NULL::uuid, p_moneda text DEFAULT 'USD'::text, p_tasa numeric DEFAULT NULL::numeric)
 RETURNS TABLE(orden_id uuid, numero character varying, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_usuario_id uuid; v_cliente_id uuid;
  v_subtotal numeric := 0; v_descuento numeric := 0;
  v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_base numeric; v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar; v_cupon record; v_items integer;
  v_limite numeric; v_utilizado numeric; v_moneda text := upper(coalesce(p_moneda,'USD'));
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id, cliente_id into v_usuario_id, v_cliente_id from usuarios where auth_id = v_uid;
  if v_usuario_id is null then raise exception 'Usuario no encontrado'; end if;
  if v_cliente_id is null then raise exception 'El usuario no tiene un cliente asociado'; end if;

  select count(*) into v_items from carrito where usuario_id = v_usuario_id;
  if v_items = 0 then raise exception 'El carrito esta vacio'; end if;

  select coalesce(sum(public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id) * c.cantidad), 0)
    into v_subtotal from carrito c where c.usuario_id = v_usuario_id;

  if p_cupon_id is not null then
    select * into v_cupon from cupones
    where id = p_cupon_id and activo = true
      and (fecha_inicio is null or fecha_inicio <= current_date)
      and (fecha_fin is null or fecha_fin >= current_date)
      and (cliente_especifico_id is null or cliente_especifico_id = v_cliente_id);
    if not found then raise exception 'Cupón inválido o vencido'; end if;
    if v_cupon.usos_maximos is not null and v_cupon.usos_actuales >= v_cupon.usos_maximos then
      raise exception 'El cupón alcanzó su límite de usos'; end if;
    if v_subtotal < coalesce(v_cupon.minimo_compra, 0) then
      raise exception 'El cupón requiere una compra mínima de %', v_cupon.minimo_compra; end if;
    if v_cupon.solo_primera_compra and exists (
      select 1 from ordenes where cliente_id = v_cliente_id and estado <> 'cancelado') then
      raise exception 'El cupón es válido solo para la primera compra'; end if;
    v_descuento := case when v_cupon.tipo = 'porcentaje'
      then round(v_subtotal * (v_cupon.valor / 100.0), 2) else v_cupon.valor end;
    if v_cupon.maximo_descuento is not null then v_descuento := least(v_descuento, v_cupon.maximo_descuento); end if;
    v_descuento := least(v_descuento, v_subtotal);
  end if;

  select coalesce(max(case when clave='iva_porcentaje' then valor::numeric end),16),
         coalesce(max(case when clave='costo_envio' then valor::numeric end),50),
         coalesce(max(case when clave='envio_gratis_minimo' then valor::numeric end),500)
    into v_iva_pct, v_costo_envio, v_envio_gratis_min
  from configuracion where clave in ('iva_porcentaje','costo_envio','envio_gratis_minimo');

  v_base := v_subtotal - v_descuento;
  v_impuesto := round(v_base * (v_iva_pct/100.0), 2);
  v_envio := case when v_base >= v_envio_gratis_min then 0 else v_costo_envio end;
  v_total := v_base + v_impuesto + v_envio;

  if p_metodo_pago = 'credito' then
    select limite_credito, credito_utilizado into v_limite, v_utilizado from clientes where id = v_cliente_id;
    if coalesce(v_utilizado,0) + v_total > coalesce(v_limite,0) then
      raise exception 'Crédito insuficiente: disponible %, requerido %',
        coalesce(v_limite,0) - coalesce(v_utilizado,0), v_total; end if;
  end if;

  v_numero := generar_numero_orden();

  insert into ordenes (numero, cliente_id, usuario_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas, comprobante_url, referencia_pago)
  values (v_numero, v_cliente_id, v_usuario_id, v_subtotal, v_descuento, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''), p_comprobante_url, p_referencia)
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal)
  select v_orden_id, c.producto_id, c.cantidad,
         public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id), 0,
         public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id) * c.cantidad
  from carrito c where c.usuario_id = v_usuario_id;

  if p_cupon_id is not null then
    update cupones set usos_actuales = usos_actuales + 1 where id = p_cupon_id;
  end if;

  -- Pago 'pendiente' cuando el checkout llevó comprobante (entra a la cola admin),
  -- con el banco destino y la moneda que indicó el cliente.
  if p_comprobante_url is not null then
    insert into pagos (cliente_id, orden_id, monto, monto_moneda, moneda, tasa_cambio, banco_id, metodo, referencia, comprobante_url, estado)
    values (
      v_cliente_id, v_orden_id, v_total,
      case when v_moneda = 'BS' and coalesce(p_tasa,0) > 0 then round(v_total * p_tasa, 2) else v_total end,
      v_moneda,
      case when v_moneda = 'BS' then p_tasa else null end,
      p_banco_id, p_metodo_pago, p_referencia, p_comprobante_url, 'pendiente'
    );
  end if;

  delete from carrito where usuario_id = v_usuario_id;
  return query select v_orden_id, v_numero, v_total;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crear_orden_vendedor(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb)
 RETURNS TABLE(orden_id uuid, numero character varying, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario_id uuid; v_subtotal numeric := 0;
  v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar; v_limite numeric; v_utilizado numeric;
begin
  if not (public.es_vendedor_de(p_cliente_id) or public.is_admin()) then
    raise exception 'No autorizado: el cliente no está asignado a este vendedor';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La orden no tiene items'; end if;

  select id into v_usuario_id from usuarios where auth_id = auth.uid();

  select coalesce(sum(
           (it->>'cantidad')::int
           * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id)
         ),0)
    into v_subtotal from jsonb_array_elements(p_items) it;

  select coalesce(max(case when clave='iva_porcentaje' then valor::numeric end),16),
         coalesce(max(case when clave='costo_envio' then valor::numeric end),50),
         coalesce(max(case when clave='envio_gratis_minimo' then valor::numeric end),500)
    into v_iva_pct, v_costo_envio, v_envio_gratis_min
  from configuracion where clave in ('iva_porcentaje','costo_envio','envio_gratis_minimo');

  v_impuesto := round(v_subtotal * (v_iva_pct/100.0), 2);
  v_envio := case when v_subtotal >= v_envio_gratis_min then 0 else v_costo_envio end;
  v_total := v_subtotal + v_impuesto + v_envio;

  if p_metodo_pago = 'credito' then
    select limite_credito, credito_utilizado into v_limite, v_utilizado from clientes where id = p_cliente_id;
    if coalesce(v_utilizado,0) + v_total > coalesce(v_limite,0) then
      raise exception 'Crédito insuficiente: disponible %, requerido %', coalesce(v_limite,0)-coalesce(v_utilizado,0), v_total;
    end if;
  end if;

  v_numero := generar_numero_orden();
  insert into ordenes (numero, cliente_id, usuario_id, vendedor_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas)
  values (v_numero, p_cliente_id, v_usuario_id, v_usuario_id, v_subtotal, 0, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''))
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal)
  select v_orden_id, (it->>'producto_id')::uuid, (it->>'cantidad')::int,
         public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id), 0,
         (it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id)
  from jsonb_array_elements(p_items) it;

  return query select v_orden_id, v_numero, v_total;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crear_usuario_admin(p_email text, p_nombre text, p_apellido text, p_role user_role, p_telefono text DEFAULT NULL::text, p_cliente_id uuid DEFAULT NULL::uuid, p_password text DEFAULT NULL::text, p_rol_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(usuario_id uuid, password_temporal text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_auth_id uuid;
  v_pass text;
  v_uid uuid;
  v_rol_id uuid;
  v_nombre_rol text;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede crear usuarios';
  end if;

  v_pass := coalesce(nullif(trim(p_password), ''), generar_password_temporal());
  if length(v_pass) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres';
  end if;

  v_rol_id := p_rol_id;
  if v_rol_id is null then
    v_nombre_rol := case p_role::text
      when 'admin' then 'Administrador'
      when 'vendedor' then 'Vendedor'
      when 'delivery' then 'Delivery'
      else null
    end;
    if v_nombre_rol is not null then
      select id into v_rol_id from public.roles where nombre = v_nombre_rol limit 1;
    end if;
  end if;

  if p_role <> 'cliente'::user_role and v_rol_id is null then
    raise exception 'Debes seleccionar un rol para este usuario';
  end if;

  v_auth_id := public.crear_auth_user(p_email, v_pass);

  insert into usuarios (auth_id, email, nombre, apellido, telefono, role, cliente_id, activo, rol_id)
  values (v_auth_id, lower(p_email), p_nombre, p_apellido, p_telefono, p_role, p_cliente_id, true, v_rol_id)
  returning id into v_uid;

  return query select v_uid, v_pass;
end;
$function$;

CREATE OR REPLACE FUNCTION public.declarar_retencion(p_cliente_id uuid, p_tipo text, p_items jsonb, p_concepto_islr_id uuid DEFAULT NULL::uuid, p_comprobante_url text DEFAULT NULL::text, p_numero text DEFAULT NULL::text, p_fecha date DEFAULT CURRENT_DATE, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario public.usuarios%rowtype;
  v_es_admin boolean;
  v_retencion_id uuid;
  v_numero text;
  v_base numeric := 0;
  v_porcentaje numeric;
  v_estado text;
  v_cliente_nombre text;
  r record;
begin
  select * into v_usuario from public.usuarios where auth_id = auth.uid();
  if not found then
    raise exception 'Usuario no encontrado';
  end if;

  v_es_admin := public.is_admin();

  if not v_es_admin then
    if v_usuario.role::text = 'cliente' then
      if v_usuario.cliente_id is distinct from p_cliente_id then
        raise exception 'No tenés acceso a este cliente';
      end if;
    elsif v_usuario.role::text = 'vendedor' then
      if p_cliente_id not in (select public.mis_clientes_vendedor()) then
        raise exception 'No tenés acceso a este cliente';
      end if;
    else
      raise exception 'No autorizado';
    end if;
  end if;

  if p_tipo not in ('iva','islr') then
    raise exception 'Tipo de retención inválido: %', p_tipo;
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos una factura afectada';
  end if;

  if p_tipo = 'islr' then
    if p_concepto_islr_id is null then
      raise exception 'Elegí el concepto de retención ISLR';
    end if;
    select porcentaje into v_porcentaje from public.conceptos_retencion_islr where id = p_concepto_islr_id;
  end if;

  v_numero := coalesce(p_numero, 'RET-' || lpad(nextval('public.retencion_seq')::text, 6, '0'));
  v_estado := case when v_es_admin then 'aprobado' else 'pendiente' end;

  insert into public.retenciones (
    numero, tipo, cliente_id, concepto_islr_id, porcentaje, fecha, comprobante_url,
    estado, declarado_por, rol_declarante, notas,
    revisado_por, revisado_en
  ) values (
    v_numero, p_tipo, p_cliente_id, p_concepto_islr_id, v_porcentaje, coalesce(p_fecha, current_date), p_comprobante_url,
    v_estado, v_usuario.id, case when v_es_admin then 'admin' else v_usuario.role::text end, p_notas,
    case when v_es_admin then v_usuario.id else null end, case when v_es_admin then now() else null end
  ) returning id into v_retencion_id;

  for r in
    select (x->>'factura_id')::uuid as factura_id, round(sum((x->>'monto')::numeric), 2) as monto
    from jsonb_array_elements(p_items) x
    where (x->>'monto')::numeric > 0
    group by (x->>'factura_id')::uuid
  loop
    declare
      f public.facturas%rowtype;
    begin
      select * into f from public.facturas where id = r.factura_id;
      if not found then
        raise exception 'Factura % no existe', r.factura_id;
      end if;
      if f.cliente_id is distinct from p_cliente_id then
        raise exception 'La factura % no pertenece a este cliente', f.numero;
      end if;
      if f.estado <> 'posted' or f.estado_pago = 'anulado' or f.tipo <> 'factura' then
        raise exception 'La factura % no admite retenciones', f.numero;
      end if;
      if r.monto > f.saldo_usd + 0.01 then
        raise exception 'La factura % solo tiene saldo $%', f.numero, f.saldo_usd;
      end if;

      insert into public.retencion_items (retencion_id, factura_id, monto_aplicado)
      values (v_retencion_id, r.factura_id, r.monto);
      v_base := v_base + r.monto;
    end;
  end loop;

  update public.retenciones set base_imponible = v_base, total = v_base where id = v_retencion_id;

  if v_estado = 'pendiente' then
    select nombre_negocio into v_cliente_nombre from public.clientes where id = p_cliente_id;
    perform public.notif_admins(
      'Retención por revisar',
      coalesce(v_cliente_nombre, 'Cliente') || ' declaró una retención de ' || upper(p_tipo) || ' por ' || public.fmt_usd(v_base),
      'alerta', '/admin/retenciones'
    );
  end if;

  return v_retencion_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.declarar_venta_consignacion(p_almacen_id uuid, p_items jsonb, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario public.usuarios%rowtype;
  v_almacen public.almacenes%rowtype;
  v_declaracion_id uuid;
  v_numero text;
  v_subtotal numeric := 0;
  v_iva_pct numeric;
  v_impuesto numeric;
  v_total numeric;
  v_cliente_nombre text;
  r record;
begin
  select * into v_usuario from public.usuarios where auth_id = auth.uid();
  if not found then
    raise exception 'Usuario no encontrado';
  end if;

  select * into v_almacen from public.almacenes where id = p_almacen_id;
  if not found then
    raise exception 'Almacén % no existe', p_almacen_id;
  end if;
  if v_almacen.tipo <> 'consignacion' or not coalesce(v_almacen.activo, true) then
    raise exception 'El almacén % no es de consignación o está inactivo', v_almacen.nombre;
  end if;

  -- Autorización
  if public.is_admin() then
    null; -- admin puede declarar sobre cualquier almacén de consignación
  elsif v_usuario.role::text = 'cliente' then
    if v_almacen.cliente_id is distinct from v_usuario.cliente_id then
      raise exception 'No tenés acceso a este almacén';
    end if;
  elsif v_usuario.role::text = 'vendedor' then
    if v_almacen.cliente_id is null or v_almacen.cliente_id not in (select public.mis_clientes_vendedor()) then
      raise exception 'No tenés acceso a este almacén';
    end if;
  else
    raise exception 'No autorizado';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto vendido';
  end if;

  select coalesce(max(valor::numeric), 16) into v_iva_pct from public.configuracion where clave = 'iva_porcentaje';

  v_numero := 'DC-' || lpad(nextval('public.declaracion_consignacion_seq')::text, 6, '0');

  insert into public.declaraciones_consignacion (
    numero, almacen_id, cliente_id, declarado_por, rol_declarante, notas
  ) values (
    v_numero, p_almacen_id, v_almacen.cliente_id, v_usuario.id,
    case when public.is_admin() then 'admin' else v_usuario.role::text end,
    p_notas
  ) returning id into v_declaracion_id;

  for r in
    select (x->>'producto_id')::uuid as producto_id, (x->>'cantidad')::numeric as cantidad
    from jsonb_array_elements(p_items) x
  loop
    declare
      v_disponible numeric;
      v_precio numeric;
      v_nombre text;
      v_sku text;
      v_sub numeric;
    begin
      if r.cantidad is null or r.cantidad <= 0 then
        raise exception 'Cantidad inválida para un producto declarado';
      end if;

      select ia.cantidad into v_disponible
      from public.inventario_almacen ia
      where ia.almacen_id = p_almacen_id and ia.producto_id = r.producto_id;

      select p.nombre, p.sku into v_nombre, v_sku from public.productos p where p.id = r.producto_id;

      if v_disponible is null or r.cantidad > v_disponible then
        raise exception 'Stock insuficiente de %: disponible %', coalesce(v_nombre, 'producto'), coalesce(v_disponible, 0);
      end if;

      v_precio := public.precio_efectivo(r.producto_id, null, v_almacen.cliente_id);
      v_sub := round(r.cantidad * v_precio, 2);
      v_subtotal := v_subtotal + v_sub;

      insert into public.declaracion_consignacion_items (
        declaracion_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, subtotal
      ) values (
        v_declaracion_id, r.producto_id, v_nombre, v_sku, r.cantidad, v_precio, v_sub
      );
    end;
  end loop;

  v_impuesto := round(v_subtotal * (v_iva_pct / 100.0), 2);
  v_total := v_subtotal + v_impuesto;

  update public.declaraciones_consignacion
  set subtotal = v_subtotal, impuesto = v_impuesto, total = v_total
  where id = v_declaracion_id;

  select nombre_negocio into v_cliente_nombre from public.clientes where id = v_almacen.cliente_id;
  perform public.notif_admins(
    'Declaración de consignación por revisar',
    coalesce(v_cliente_nombre, 'Cliente') || ' declaró ventas por ' || public.fmt_usd(v_total),
    'alerta', '/admin/consignacion'
  );

  return v_declaracion_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.descartar_linea_extracto(p_linea_id uuid, p_notas text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede conciliar';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  update public.extracto_lineas
  set estado = 'descartado', revisado_por = v_admin, revisado_en = now(),
      descripcion = case when p_notas is not null then coalesce(descripcion,'') || ' | ' || p_notas else descripcion end
  where id = p_linea_id and estado = 'pendiente';

  if not found then
    raise exception 'La línea no existe o ya fue procesada';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.es_admin_total()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from usuarios u left join roles r on r.id = u.rol_id
    where u.auth_id = auth.uid() and u.role = 'admin' and coalesce(u.activo, true)
      and (u.rol_id is null or r.nombre = 'Administrador')
  );
$function$;

CREATE OR REPLACE FUNCTION public.es_vendedor_de(p_cliente_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from clientes c join usuarios u on u.id = c.vendedor_asignado_id
    where c.id = p_cliente_id and u.auth_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.facturar_orden(p_orden_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.ordenes%rowtype;
  v_factura_id uuid;
  v_numero text;
  v_dias_credito int;
begin
  if not public.puede('cuentas','crear') then
    raise exception 'No tiene permiso para facturar órdenes';
  end if;

  select * into o from public.ordenes where id = p_orden_id;
  if not found then
    raise exception 'Orden % no existe', p_orden_id;
  end if;
  if o.estado = 'cancelado' then
    raise exception 'No se puede facturar una orden cancelada';
  end if;
  if exists (
    select 1 from public.facturas
    where orden_id = p_orden_id and tipo = 'factura' and estado_pago <> 'anulado'
  ) then
    raise exception 'La orden % ya tiene una factura asociada', o.numero;
  end if;

  select coalesce(dias_credito, 0) into v_dias_credito from public.clientes where id = o.cliente_id;
  v_numero := 'F-' || lpad(nextval('public.factura_interna_seq')::text, 6, '0');

  insert into public.facturas (
    numero, tipo, cliente_id, orden_id, fecha_emision, fecha_vencimiento,
    moneda, subtotal, impuesto, total, total_usd, saldo_odoo_usd,
    estado_pago, estado, creada_en_guds
  ) values (
    v_numero, 'factura', o.cliente_id, o.id, current_date, current_date + v_dias_credito,
    'USD', coalesce(o.subtotal,0) - coalesce(o.descuento,0), coalesce(o.impuesto,0), o.total, o.total, o.total,
    'pendiente', 'posted', true
  ) returning id into v_factura_id;

  insert into public.factura_items (factura_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, descuento, subtotal, total)
  select v_factura_id, oi.producto_id, oi.nombre_producto, oi.sku_producto, oi.cantidad, oi.precio_unitario, oi.descuento, oi.subtotal,
         oi.subtotal -- orden_items no trae total con impuesto por línea; se deja igual al subtotal
  from public.orden_items oi
  where oi.orden_id = p_orden_id;

  return v_factura_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmt_usd(n numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select '$' || to_char(coalesce(n,0), 'FM999999990.00');
$function$;

CREATE OR REPLACE FUNCTION public.generar_codigo_cliente()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  nuevo_codigo TEXT;
  contador INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO contador FROM clientes;
  nuevo_codigo := 'CLI-' || LPAD(contador::TEXT, 5, '0');
  RETURN nuevo_codigo;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generar_numero_orden()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  nuevo_numero TEXT;
  contador INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO contador FROM ordenes;
  nuevo_numero := 'ORD-' || LPAD(contador::TEXT, 5, '0');
  RETURN nuevo_numero;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generar_numero_pago()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  nuevo_numero TEXT;
  contador INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO contador FROM pagos;
  nuevo_numero := 'PAG-' || LPAD(contador::TEXT, 5, '0');
  RETURN nuevo_numero;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generar_password_temporal()
 RETURNS text
 LANGUAGE sql
AS $function$
  select 'Gd' || substr(md5(random()::text), 1, 6) || upper(substr(md5(random()::text), 1, 3)) || '#7';
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.usuarios
    where auth_id = auth.uid() and role = 'admin' and coalesce(activo, true)
  );
$function$;

CREATE OR REPLACE FUNCTION public.liquidar_orden(p_orden_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_orden_id is null then return; end if;
  update ordenes o set pagado = (
    coalesce((select sum(monto) from pagos where orden_id = o.id and estado = 'verificado'), 0) >= o.total
  ) where o.id = p_orden_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mis_clientes_reparto()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.cliente_id from ordenes o join entregas e on e.orden_id = o.id
  join usuarios u on u.id = e.repartidor_id where u.auth_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.mis_clientes_vendedor()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id from clientes c join usuarios u on u.id = c.vendedor_asignado_id
  where u.auth_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.mis_ordenes_reparto()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.orden_id from entregas e join usuarios u on u.id = e.repartidor_id where u.auth_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.mis_permisos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_super boolean; v_result jsonb;
begin
  v_super := public.es_admin_total();
  if v_super then
    -- acceso total a todos los m�dulos
    select jsonb_build_object('es_admin_total', true, 'permisos',
      coalesce(jsonb_object_agg(m.codigo, jsonb_build_object('ver',true,'crear',true,'editar',true,'eliminar',true)), '{}'::jsonb))
    into v_result from modulos m;
  else
    select jsonb_build_object('es_admin_total', false, 'permisos',
      coalesce(jsonb_object_agg(m.codigo, jsonb_build_object(
        'ver',p.puede_ver,'crear',p.puede_crear,'editar',p.puede_editar,'eliminar',p.puede_eliminar)), '{}'::jsonb))
    into v_result
    from usuarios u
    join permisos p on p.rol_id = u.rol_id
    join modulos m on m.id = p.modulo_id
    where u.auth_id = auth.uid();
  end if;
  return coalesce(v_result, jsonb_build_object('es_admin_total', false, 'permisos', '{}'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.notif_admins(p_titulo text, p_mensaje text, p_tipo text, p_link text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into notificaciones (usuario_id, titulo, mensaje, tipo, link, leida)
  select id, p_titulo, p_mensaje, p_tipo, p_link, false
  from usuarios where role='admin' and activo;
$function$;

CREATE OR REPLACE FUNCTION public.notif_cliente(p_cliente_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into notificaciones (usuario_id, titulo, mensaje, tipo, link, leida)
  select id, p_titulo, p_mensaje, p_tipo, p_link, false
  from usuarios where cliente_id=p_cliente_id and role='cliente' and activo;
$function$;

CREATE OR REPLACE FUNCTION public.notif_crear(p_usuario_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into notificaciones (usuario_id, titulo, mensaje, tipo, link, leida)
  select p_usuario_id, p_titulo, p_mensaje, p_tipo, p_link, false
  where p_usuario_id is not null;
$function$;

CREATE OR REPLACE FUNCTION public.notif_vendedor(p_cliente_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into notificaciones (usuario_id, titulo, mensaje, tipo, link, leida)
  select c.vendedor_asignado_id, p_titulo, p_mensaje, p_tipo, p_link, false
  from clientes c
  where c.id=p_cliente_id and c.vendedor_asignado_id is not null;
$function$;

CREATE OR REPLACE FUNCTION public.obtener_precio_producto(p_producto_id uuid, p_cliente_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_precio DECIMAL;
  v_lista_id UUID;
BEGIN
  -- Obtener lista de precios del cliente
  SELECT lista_precios_id INTO v_lista_id FROM clientes WHERE id = p_cliente_id;
  
  -- Buscar precio en la lista específica
  SELECT precio INTO v_precio 
  FROM precios_lista 
  WHERE producto_id = p_producto_id AND lista_precios_id = v_lista_id;
  
  -- Si no hay precio específico, usar precio base
  IF v_precio IS NULL THEN
    SELECT 
      CASE WHEN en_oferta AND precio_oferta IS NOT NULL 
           THEN precio_oferta 
           ELSE precio_base 
      END INTO v_precio
    FROM productos WHERE id = p_producto_id;
  END IF;
  
  RETURN v_precio;
END;
$function$;

CREATE OR REPLACE FUNCTION public.precio_efectivo(p_producto_id uuid, p_tipo_empaque_id uuid DEFAULT NULL::uuid, p_cliente_id uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_precio numeric;
  v_lista uuid;
begin
  -- 1) Precio negociado de la lista del cliente
  if p_cliente_id is not null then
    select lista_precios_id into v_lista from clientes where id = p_cliente_id;
    if v_lista is not null then
      select precio into v_precio
      from precios_lista
      where producto_id = p_producto_id and lista_precios_id = v_lista;
      if v_precio is not null then return v_precio; end if;
    end if;
  end if;

  -- 2) Precio expl�cito del empaque
  if p_tipo_empaque_id is not null then
    select precio_empaque into v_precio
    from producto_empaques
    where producto_id = p_producto_id
      and tipo_empaque_id = p_tipo_empaque_id
      and precio_empaque is not null;
    if v_precio is not null then return v_precio; end if;
  end if;

  -- 3) Oferta  / 4) Precio base (P4: es el precio del empaque, sin �unidades)
  select case when en_oferta and precio_oferta is not null then precio_oferta else precio_base end
    into v_precio
  from productos where id = p_producto_id;

  return v_precio;
end;
$function$;

CREATE OR REPLACE FUNCTION public.puede(p_codigo text, p_accion text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.es_admin_total() or exists (
    select 1
    from usuarios u
    join permisos p on p.rol_id = u.rol_id
    join modulos m on m.id = p.modulo_id
    where u.auth_id = auth.uid() and coalesce(u.activo, true) and m.codigo = p_codigo
      and case p_accion
        when 'ver' then p.puede_ver
        when 'crear' then p.puede_crear
        when 'editar' then p.puede_editar
        when 'eliminar' then p.puede_eliminar
        else false end
  );
$function$;

CREATE OR REPLACE FUNCTION public.recalcular_credito(p_cliente_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_cliente_id is null then return; end if;
  update public.clientes set credito_utilizado = coalesce((
    select sum(saldo_usd) from public.facturas
    where cliente_id = p_cliente_id and estado = 'posted'
  ), 0)
  where id = p_cliente_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rechazar_registro_cliente(p_registro_id uuid, p_admin_id uuid, p_notas text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE registros_clientes SET
    estado = 'rechazado',
    revisado_por = p_admin_id,
    fecha_revision = NOW(),
    notas = p_notas
  WHERE id = p_registro_id AND estado = 'pendiente';
  
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_cobro_facturas(p_cliente_id uuid, p_banco_id uuid, p_monto_moneda numeric, p_moneda text, p_tasa numeric, p_metodo pago_metodo, p_referencia text, p_comprobante_url text, p_notas text, p_asignaciones jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid;
  v_monto_usd numeric;
  v_pago_id uuid;
  v_numero text;
  v_asignado numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede registrar cobros';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  if upper(coalesce(p_moneda,'USD')) in ('BS','VES') then
    if p_tasa is null or p_tasa <= 0 then
      raise exception 'Falta la tasa de cambio para un cobro en bolívares';
    end if;
    v_monto_usd := round(p_monto_moneda / p_tasa, 2);
  else
    v_monto_usd := round(p_monto_moneda, 2);
  end if;

  if v_monto_usd <= 0 then
    raise exception 'El monto del cobro debe ser mayor a 0';
  end if;

  v_numero := 'PAG-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random()*10000)::text, 4, '0');

  insert into public.pagos (
    numero, cliente_id, banco_id, metodo, monto, monto_moneda, moneda, tasa_cambio,
    referencia, comprobante_url, notas, estado, verificado_por, fecha_verificacion
  ) values (
    v_numero, p_cliente_id, p_banco_id, p_metodo, v_monto_usd, p_monto_moneda,
    coalesce(upper(p_moneda), 'USD'), p_tasa, p_referencia, p_comprobante_url, p_notas,
    'verificado', v_admin, now()
  ) returning id into v_pago_id;

  if p_banco_id is not null then
    insert into public.movimientos_bancarios (banco_id, tipo, monto, referencia, descripcion, pago_id)
    values (p_banco_id, 'entrada', coalesce(p_monto_moneda, v_monto_usd), p_referencia, 'Cobro registrado', v_pago_id);
  end if;

  v_asignado := public.aplicar_pago_a_facturas(v_pago_id, p_asignaciones);
  perform public.recalcular_credito(p_cliente_id);

  return jsonb_build_object(
    'pago_id', v_pago_id,
    'monto_usd', v_monto_usd,
    'facturas_afectadas', (select count(*) from public.pago_facturas where pago_id = v_pago_id),
    'saldo_a_favor', round(v_monto_usd - v_asignado, 2)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_pago(p_cliente_id uuid, p_orden_id uuid, p_banco_id uuid, p_metodo pago_metodo, p_monto_moneda numeric, p_moneda text DEFAULT 'USD'::text, p_tasa_cambio numeric DEFAULT NULL::numeric, p_referencia text DEFAULT NULL::text, p_comprobante_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_es_admin boolean := public.is_admin();
  v_autorizado boolean;
  v_monto_usd numeric;
  v_id uuid;
begin
  v_autorizado := v_es_admin
    or public.es_vendedor_de(p_cliente_id)
    or exists (select 1 from usuarios where auth_id = auth.uid() and cliente_id = p_cliente_id);
  if not v_autorizado then raise exception 'No autorizado para registrar este pago'; end if;
  if p_monto_moneda is null or p_monto_moneda <= 0 then raise exception 'Monto inválido'; end if;

  if p_moneda = 'BS' then
    if coalesce(p_tasa_cambio, 0) <= 0 then raise exception 'Falta la tasa de cambio para un pago en bolívares'; end if;
    v_monto_usd := round(p_monto_moneda / p_tasa_cambio, 2);
  else
    v_monto_usd := p_monto_moneda;
  end if;

  insert into pagos (cliente_id, orden_id, banco_id, metodo, monto, monto_moneda, moneda, tasa_cambio, referencia, comprobante_url, estado, verificado_por, fecha_verificacion)
  values (
    p_cliente_id, p_orden_id, p_banco_id, p_metodo, v_monto_usd, p_monto_moneda,
    coalesce(p_moneda,'USD'), case when p_moneda = 'BS' then p_tasa_cambio else null end, p_referencia, p_comprobante_url,
    (case when v_es_admin then 'verificado' else 'pendiente' end)::pago_estado,
    case when v_es_admin then (select id from usuarios where auth_id = auth.uid()) else null end,
    case when v_es_admin then now() else null end
  ) returning id into v_id;

  if v_es_admin then
    perform public.liquidar_orden(p_orden_id);
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_pago_vendedor(p_cliente_id uuid, p_orden_id uuid, p_monto numeric, p_metodo pago_metodo, p_referencia text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if not (public.es_vendedor_de(p_cliente_id) or public.is_admin()) then
    raise exception 'No autorizado: el cliente no est� asignado a este vendedor';
  end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Monto inv�lido'; end if;
  insert into pagos (cliente_id, orden_id, monto, metodo, referencia, estado)
  values (p_cliente_id, p_orden_id, p_monto, p_metodo, p_referencia, 'pendiente')
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revisar_declaracion_consignacion(p_declaracion_id uuid, p_aprobar boolean, p_notas text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid;
  d public.declaraciones_consignacion%rowtype;
  v_dias_credito int;
  v_numero_factura text;
  v_factura_id uuid;
  r record;
  v_disponible numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede revisar declaraciones';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  select * into d from public.declaraciones_consignacion where id = p_declaracion_id;
  if not found then
    raise exception 'Declaración % no existe', p_declaracion_id;
  end if;
  if d.estado <> 'pendiente' then
    raise exception 'La declaración ya fue %', d.estado;
  end if;

  if not p_aprobar then
    update public.declaraciones_consignacion
    set estado = 'rechazado', revisado_por = v_admin, revisado_en = now(), notas = coalesce(p_notas, notas)
    where id = p_declaracion_id;
    return jsonb_build_object('estado', 'rechazado');
  end if;

  -- Re-valida stock (pudo cambiar desde que se declaró) y descuenta.
  for r in select * from public.declaracion_consignacion_items where declaracion_id = p_declaracion_id loop
    select ia.cantidad into v_disponible from public.inventario_almacen ia
    where ia.almacen_id = d.almacen_id and ia.producto_id = r.producto_id;
    if v_disponible is null or r.cantidad > v_disponible then
      raise exception 'Stock insuficiente de %: disponible % (cambió desde que se declaró)', coalesce(r.nombre_producto, 'producto'), coalesce(v_disponible, 0);
    end if;
  end loop;

  update public.inventario_almacen ia
  set cantidad = ia.cantidad - item.cantidad
  from public.declaracion_consignacion_items item
  where item.declaracion_id = p_declaracion_id
    and ia.almacen_id = d.almacen_id and ia.producto_id = item.producto_id;

  select coalesce(dias_credito, 0) into v_dias_credito from public.clientes where id = d.cliente_id;
  v_numero_factura := 'F-' || lpad(nextval('public.factura_interna_seq')::text, 6, '0');

  insert into public.facturas (
    numero, tipo, cliente_id, orden_id, fecha_emision, fecha_vencimiento,
    moneda, subtotal, impuesto, total, total_usd, saldo_odoo_usd,
    estado_pago, estado, referencia, creada_en_guds
  ) values (
    v_numero_factura, 'factura', d.cliente_id, null, current_date, current_date + v_dias_credito,
    'USD', d.subtotal, d.impuesto, d.total, d.total, d.total,
    'pendiente', 'posted', d.numero, true
  ) returning id into v_factura_id;

  insert into public.factura_items (factura_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, subtotal, total)
  select v_factura_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, subtotal, subtotal
  from public.declaracion_consignacion_items
  where declaracion_id = p_declaracion_id;

  update public.declaraciones_consignacion
  set estado = 'aprobado', factura_id = v_factura_id, revisado_por = v_admin, revisado_en = now(), notas = coalesce(p_notas, notas)
  where id = p_declaracion_id;

  perform public.notif_cliente(d.cliente_id, 'Declaración de consignación aprobada',
    'Se generó la factura ' || v_numero_factura || ' por ' || public.fmt_usd(d.total), 'exito', '/portal/consignacion');
  perform public.notif_vendedor(d.cliente_id, 'Declaración de consignación aprobada',
    'Factura ' || v_numero_factura || ' · ' || public.fmt_usd(d.total), 'exito', '/vendedor/consignacion');

  return jsonb_build_object('factura_id', v_factura_id, 'numero', v_numero_factura);
end;
$function$;

CREATE OR REPLACE FUNCTION public.revisar_retencion(p_retencion_id uuid, p_aprobar boolean, p_notas text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid;
  ret public.retenciones%rowtype;
  r record;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede revisar retenciones';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  select * into ret from public.retenciones where id = p_retencion_id;
  if not found then
    raise exception 'Retención % no existe', p_retencion_id;
  end if;
  if ret.estado <> 'pendiente' then
    raise exception 'La retención ya fue %', ret.estado;
  end if;

  if not p_aprobar then
    update public.retenciones
    set estado = 'rechazado', revisado_por = v_admin, revisado_en = now(), notas = coalesce(p_notas, notas)
    where id = p_retencion_id;
    return jsonb_build_object('estado', 'rechazado');
  end if;

  for r in select ri.factura_id, ri.monto_aplicado, f.saldo_usd, f.numero
           from public.retencion_items ri join public.facturas f on f.id = ri.factura_id
           where ri.retencion_id = p_retencion_id
  loop
    if r.monto_aplicado > r.saldo_usd + 0.01 then
      raise exception 'La factura % ya no tiene saldo suficiente ($%) para esta retención', r.numero, r.saldo_usd;
    end if;
  end loop;

  update public.retenciones
  set estado = 'aprobado', revisado_por = v_admin, revisado_en = now(), notas = coalesce(p_notas, notas)
  where id = p_retencion_id;

  perform public.notif_cliente(ret.cliente_id, 'Retención aprobada',
    'Se aplicó tu retención ' || ret.numero || ' por ' || public.fmt_usd(ret.total), 'exito', '/portal/retenciones');
  perform public.notif_vendedor(ret.cliente_id, 'Retención aprobada',
    ret.numero || ' · ' || public.fmt_usd(ret.total), 'exito', '/vendedor/retenciones');

  return jsonb_build_object('estado', 'aprobado', 'total', ret.total);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_default_categoria()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.categoria_id IS NULL THEN
    NEW.categoria_id := (SELECT id FROM categorias WHERE nombre = 'Sin Categoría' LIMIT 1);
  END IF;
  IF NEW.tipo_empaque_id IS NULL THEN
    NEW.tipo_empaque_id := (SELECT id FROM tipos_empaque WHERE nombre = 'Unidad' LIMIT 1);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_numero_cxc()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
  begin
    if new.numero is null then new.numero := 'CxC-' || lpad(nextval('public.cuentas_cobrar_seq')::text, 6, '0'); end if;
    return new;
  end $function$;

CREATE OR REPLACE FUNCTION public.set_numero_orden()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.numero is null or new.numero = '' then
    new.numero := public.generar_numero_orden();
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.set_numero_pago()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.numero is null or new.numero = '' then
    new.numero := public.generar_numero_pago();
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.trg_entrega_asignada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_num text;
begin
  if NEW.repartidor_id is null then return NEW; end if;
  if TG_OP='UPDATE' and NEW.repartidor_id is not distinct from OLD.repartidor_id then return NEW; end if;
  select numero into v_num from ordenes where id=NEW.orden_id;
  perform notif_crear(NEW.repartidor_id, 'Nueva entrega asignada', 'Tienes el pedido '||coalesce(v_num,'')||' para entregar.', 'orden', '/delivery/entregas');
  return NEW;
end; $function$;

CREATE OR REPLACE FUNCTION public.trg_orden_creada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cli text;
begin
  select nombre_negocio into v_cli from clientes where id=NEW.cliente_id;
  perform notif_admins('Nueva orden '||NEW.numero, coalesce(v_cli,'Cliente')||' · '||fmt_usd(NEW.total), 'orden', '/admin/ordenes');
  perform notif_cliente(NEW.cliente_id, 'Pedido recibido', 'Tu pedido '||NEW.numero||' por '||fmt_usd(NEW.total)||' fue registrado.', 'orden', '/portal/pedidos');
  if NEW.vendedor_id is null then
    perform notif_vendedor(NEW.cliente_id, 'Tu cliente hizo un pedido', coalesce(v_cli,'Cliente')||': '||NEW.numero||' por '||fmt_usd(NEW.total), 'orden', '/vendedor/pedidos');
  end if;
  return NEW;
end; $function$;

CREATE OR REPLACE FUNCTION public.trg_orden_estado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cli text; v_lbl text; v_tipo text;
begin
  if NEW.estado is not distinct from OLD.estado then return NEW; end if;
  if NEW.estado::text not in ('confirmado','procesando','enviado','completado','cancelado') then return NEW; end if;
  select nombre_negocio into v_cli from clientes where id=NEW.cliente_id;
  v_lbl := case NEW.estado::text
    when 'confirmado' then 'confirmado'
    when 'procesando' then 'en preparación'
    when 'enviado' then 'en camino'
    when 'completado' then 'entregado'
    when 'cancelado' then 'cancelado'
    else NEW.estado::text end;
  v_tipo := case NEW.estado::text when 'cancelado' then 'alerta' when 'completado' then 'exito' else 'orden' end;
  perform notif_cliente(NEW.cliente_id, 'Pedido '||v_lbl, 'Tu pedido '||NEW.numero||' está '||v_lbl||'.', v_tipo, '/portal/pedidos');
  if NEW.estado::text='completado' then
    perform notif_admins('Pedido completado', NEW.numero||' de '||coalesce(v_cli,'cliente'), 'exito', '/admin/ordenes');
  elsif NEW.estado::text='cancelado' then
    perform notif_vendedor(NEW.cliente_id, 'Pedido cancelado', NEW.numero||' de '||coalesce(v_cli,'cliente'), 'alerta', '/vendedor/pedidos');
  end if;
  return NEW;
end; $function$;

CREATE OR REPLACE FUNCTION public.trg_pago_estado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cli text;
begin
  if NEW.estado is not distinct from OLD.estado then return NEW; end if;
  select nombre_negocio into v_cli from clientes where id=NEW.cliente_id;
  if NEW.estado::text='verificado' then
    perform notif_cliente(NEW.cliente_id, 'Pago verificado', 'Tu pago '||coalesce(NEW.numero,'')||' de '||fmt_usd(NEW.monto)||' fue verificado.', 'exito', '/portal/pagos');
    perform notif_vendedor(NEW.cliente_id, 'Pago verificado', coalesce(v_cli,'Cliente')||': '||fmt_usd(NEW.monto), 'exito', '/vendedor/pagos');
  elsif NEW.estado::text='rechazado' then
    perform notif_cliente(NEW.cliente_id, 'Pago rechazado', 'Tu pago '||coalesce(NEW.numero,'')||' de '||fmt_usd(NEW.monto)||' fue rechazado.', 'alerta', '/portal/pagos');
  end if;
  return NEW;
end; $function$;

CREATE OR REPLACE FUNCTION public.trg_pago_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cli text;
begin
  select nombre_negocio into v_cli from clientes where id=NEW.cliente_id;
  if NEW.estado::text='pendiente' then
    perform notif_admins('Pago por verificar', coalesce(v_cli,'Cliente')||' reportó '||fmt_usd(NEW.monto), 'alerta', '/admin/cuentas-por-cobrar');
  elsif NEW.estado::text='verificado' then
    perform notif_cliente(NEW.cliente_id, 'Pago verificado', 'Tu pago '||coalesce(NEW.numero,'')||' de '||fmt_usd(NEW.monto)||' fue verificado.', 'exito', '/portal/pagos');
    perform notif_vendedor(NEW.cliente_id, 'Pago verificado', coalesce(v_cli,'Cliente')||': '||fmt_usd(NEW.monto), 'exito', '/vendedor/pagos');
  end if;
  return NEW;
end; $function$;

CREATE OR REPLACE FUNCTION public.trg_recalc_factura_aplicado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_factura_id uuid := coalesce(new.factura_id, old.factura_id);
begin
  update public.facturas f
  set monto_aplicado_usd = coalesce((
    select round(sum(pf.monto_aplicado), 2)
    from public.pago_facturas pf
    join public.pagos p on p.id = pf.pago_id
    where pf.factura_id = f.id and p.estado = 'verificado'
  ), 0)
  where f.id = v_factura_id;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_recalc_factura_aplicado_por_pago()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.estado is distinct from old.estado then
    update public.facturas f
    set monto_aplicado_usd = coalesce((
      select round(sum(pf.monto_aplicado), 2)
      from public.pago_facturas pf
      join public.pagos p on p.id = pf.pago_id
      where pf.factura_id = f.id and p.estado = 'verificado'
    ), 0)
    where f.id in (select pf2.factura_id from public.pago_facturas pf2 where pf2.pago_id = new.id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_recalc_factura_retenido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_factura_id uuid := coalesce(new.factura_id, old.factura_id);
begin
  update public.facturas f
  set monto_retenido_usd = coalesce((
    select sum(ri.monto_aplicado)
    from public.retencion_items ri
    join public.retenciones r on r.id = ri.retencion_id
    where ri.factura_id = f.id and r.estado = 'aprobado' and r.odoo_id is null
  ), 0)
  where f.id = v_factura_id;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_recalc_factura_retenido_por_retencion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.estado is distinct from old.estado then
    update public.facturas f
    set monto_retenido_usd = coalesce((
      select sum(ri.monto_aplicado)
      from public.retencion_items ri
      join public.retenciones r on r.id = ri.retencion_id
      where ri.factura_id = f.id and r.estado = 'aprobado' and r.odoo_id is null
    ), 0)
    where f.id in (select ri2.factura_id from public.retencion_items ri2 where ri2.retencion_id = new.id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_recalcular_credito()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.recalcular_credito(coalesce(new.cliente_id, old.cliente_id));
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_registro_nuevo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform notif_admins('Nuevo registro de cliente', coalesce(NEW.nombre_negocio,'Un negocio')||' solicitó una cuenta.', 'alerta', '/admin/registros');
  return NEW;
end; $function$;

CREATE OR REPLACE FUNCTION public.trg_stock_bajo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.stock_minimo > 0 and NEW.stock_actual <= NEW.stock_minimo and OLD.stock_actual > NEW.stock_minimo then
    perform notif_admins('Stock bajo', NEW.nombre||': quedan '||NEW.stock_actual||' (mínimo '||NEW.stock_minimo||')', 'alerta', '/admin/inventario');
  end if;
  return NEW;
end; $function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_tasa_bcv(p_tasa numeric, p_fuente text DEFAULT 'BCV'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_now timestamptz := now();
begin
  if p_tasa is null or p_tasa <= 0 then
    raise exception 'Tasa BCV inválida: %', p_tasa;
  end if;

  insert into configuracion (clave, valor, tipo, descripcion, updated_at)
  values ('tasa_cambio', p_tasa::text, 'number', 'Tasa BCV Bs/USD', v_now)
  on conflict (clave) do update set valor = excluded.valor, updated_at = v_now;

  insert into configuracion (clave, valor, tipo, descripcion, updated_at)
  values ('tasa_cambio_actualizada', v_now::text, 'datetime', 'Última actualización de la tasa BCV', v_now)
  on conflict (clave) do update set valor = excluded.valor, updated_at = v_now;

  insert into configuracion (clave, valor, tipo, descripcion, updated_at)
  values ('tasa_cambio_fuente', coalesce(p_fuente, 'BCV'), 'text', 'Fuente de la tasa BCV', v_now)
  on conflict (clave) do update set valor = excluded.valor, updated_at = v_now;

  insert into public.tasa_bcv (tasa, fuente) values (p_tasa, p_fuente);

  return jsonb_build_object('ok', true, 'tasa', p_tasa, 'fuente', p_fuente, 'actualizada', v_now);
end;
$function$;

CREATE OR REPLACE FUNCTION public.usuarios_guard_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(current_setting('guds.bypass_guard', true), '') = 'on' then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.activo is distinct from old.activo
     or new.cliente_id is distinct from old.cliente_id then
    raise exception 'No autorizado para cambiar role/activo/cliente_id';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.verificar_pago(p_pago_id uuid, p_aprobar boolean, p_notas text DEFAULT NULL::text, p_banco_id uuid DEFAULT NULL::uuid, p_tasa numeric DEFAULT NULL::numeric, p_asignaciones jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid;
  p public.pagos%rowtype;
  v_banco uuid;
  v_asignado numeric := 0;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede verificar pagos';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  select * into p from public.pagos where id = p_pago_id;
  if not found then
    raise exception 'Pago % no existe', p_pago_id;
  end if;
  if p.estado <> 'pendiente' then
    raise exception 'El pago ya fue % ', p.estado;
  end if;

  if not p_aprobar then
    update public.pagos
    set estado = 'rechazado', verificado_por = v_admin, fecha_verificacion = now(),
        notas = coalesce(p_notas, notas)
    where id = p_pago_id;
    return jsonb_build_object('aplicado', 0, 'saldo_a_favor', 0);
  end if;

  v_banco := coalesce(p_banco_id, p.banco_id);

  update public.pagos
  set estado = 'verificado', verificado_por = v_admin, fecha_verificacion = now(),
      notas = coalesce(p_notas, notas), banco_id = v_banco,
      tasa_cambio = coalesce(p_tasa, tasa_cambio)
  where id = p_pago_id;

  if v_banco is not null then
    insert into public.movimientos_bancarios (banco_id, tipo, monto, referencia, descripcion, pago_id)
    values (v_banco, 'entrada', coalesce(p.monto_moneda, p.monto), p.referencia, 'Cobro verificado', p_pago_id);
  end if;

  v_asignado := public.aplicar_pago_a_facturas(p_pago_id, p_asignaciones);
  perform public.recalcular_credito(p.cliente_id);

  return jsonb_build_object('aplicado', v_asignado, 'saldo_a_favor', round(p.monto - v_asignado, 2));
end;
$function$;

CREATE OR REPLACE FUNCTION public.verificar_pago(p_pago_id uuid, p_aprobar boolean, p_notas text, p_banco_id uuid, p_tasa numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.verificar_pago(p_pago_id, p_aprobar, p_notas, p_banco_id, p_tasa, '[]'::jsonb);
end;
$function$;


-- ════════════════ TRIGGERS ════════════════

CREATE TRIGGER update_bancos_updated_at BEFORE UPDATE ON public.bancos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_clientes_updated_at BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_set_numero_cxc BEFORE INSERT ON public.cuentas_cobrar FOR EACH ROW EXECUTE FUNCTION set_numero_cxc();
CREATE TRIGGER update_declaraciones_consignacion_updated_at BEFORE UPDATE ON public.declaraciones_consignacion FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_notif_entrega_ins AFTER INSERT ON public.entregas FOR EACH ROW EXECUTE FUNCTION trg_entrega_asignada();
CREATE TRIGGER trg_notif_entrega_upd AFTER UPDATE OF repartidor_id ON public.entregas FOR EACH ROW EXECUTE FUNCTION trg_entrega_asignada();
CREATE TRIGGER update_entregas_updated_at BEFORE UPDATE ON public.entregas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_facturas_updated_at BEFORE UPDATE ON public.facturas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_notif_orden_creada AFTER INSERT ON public.ordenes FOR EACH ROW EXECUTE FUNCTION trg_orden_creada();
CREATE TRIGGER trg_notif_orden_estado AFTER UPDATE OF estado ON public.ordenes FOR EACH ROW EXECUTE FUNCTION trg_orden_estado();
CREATE TRIGGER trg_ordenes_credito AFTER INSERT OR UPDATE OF estado, pagado, total, metodo_pago ON public.ordenes FOR EACH ROW EXECUTE FUNCTION trg_recalcular_credito();
CREATE TRIGGER trg_set_numero_orden BEFORE INSERT ON public.ordenes FOR EACH ROW EXECUTE FUNCTION set_numero_orden();
CREATE TRIGGER trigger_actualizar_stock_orden BEFORE UPDATE ON public.ordenes FOR EACH ROW EXECUTE FUNCTION actualizar_stock_orden();
CREATE TRIGGER update_ordenes_updated_at BEFORE UPDATE ON public.ordenes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_pf_recalc AFTER INSERT OR DELETE OR UPDATE ON public.pago_facturas FOR EACH ROW EXECUTE FUNCTION trg_recalc_factura_aplicado();
CREATE TRIGGER trg_notif_pago_estado AFTER UPDATE OF estado ON public.pagos FOR EACH ROW EXECUTE FUNCTION trg_pago_estado();
CREATE TRIGGER trg_notif_pago_insert AFTER INSERT ON public.pagos FOR EACH ROW EXECUTE FUNCTION trg_pago_insert();
CREATE TRIGGER trg_pago_estado_recalc AFTER UPDATE ON public.pagos FOR EACH ROW EXECUTE FUNCTION trg_recalc_factura_aplicado_por_pago();
CREATE TRIGGER trg_set_numero_pago BEFORE INSERT ON public.pagos FOR EACH ROW EXECUTE FUNCTION set_numero_pago();
CREATE TRIGGER update_pagos_updated_at BEFORE UPDATE ON public.pagos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_notif_stock_bajo AFTER UPDATE OF stock_actual ON public.productos FOR EACH ROW EXECUTE FUNCTION trg_stock_bajo();
CREATE TRIGGER trigger_set_default_categoria BEFORE INSERT ON public.productos FOR EACH ROW EXECUTE FUNCTION set_default_categoria();
CREATE TRIGGER update_productos_updated_at BEFORE UPDATE ON public.productos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_notif_registro_nuevo AFTER INSERT ON public.registros_clientes FOR EACH ROW EXECUTE FUNCTION trg_registro_nuevo();
CREATE TRIGGER update_registros_updated_at BEFORE UPDATE ON public.registros_clientes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_ri_recalc AFTER INSERT OR DELETE OR UPDATE ON public.retencion_items FOR EACH ROW EXECUTE FUNCTION trg_recalc_factura_retenido();
CREATE TRIGGER trg_retencion_estado_recalc AFTER UPDATE ON public.retenciones FOR EACH ROW EXECUTE FUNCTION trg_recalc_factura_retenido_por_retencion();
CREATE TRIGGER update_retenciones_updated_at BEFORE UPDATE ON public.retenciones FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_tipos_empaque_updated_at BEFORE UPDATE ON public.tipos_empaque FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_usuarios_guard_role BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION usuarios_guard_role();
CREATE TRIGGER update_usuarios_updated_at BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════ RLS Y POLÍTICAS (public y storage) ════════════════

alter table public."almacenes" enable row level security;
alter table public."bancos" enable row level security;
alter table public."banners" enable row level security;
alter table public."carrito" enable row level security;
alter table public."categorias" enable row level security;
alter table public."clientes" enable row level security;
alter table public."conceptos_retencion_islr" enable row level security;
alter table public."configuracion" enable row level security;
alter table public."cuentas_cobrar" enable row level security;
alter table public."cupones" enable row level security;
alter table public."declaracion_consignacion_items" enable row level security;
alter table public."declaraciones_consignacion" enable row level security;
alter table public."entregas" enable row level security;
alter table public."extracto_lineas" enable row level security;
alter table public."extractos_bancarios" enable row level security;
alter table public."factura_items" enable row level security;
alter table public."facturas" enable row level security;
alter table public."favoritos" enable row level security;
alter table public."iconos" enable row level security;
alter table public."inventario_almacen" enable row level security;
alter table public."listas_precios" enable row level security;
alter table public."metas_vendedor" enable row level security;
alter table public."metodos_pago" enable row level security;
alter table public."modulos" enable row level security;
alter table public."movimientos_bancarios" enable row level security;
alter table public."movimientos_inventario" enable row level security;
alter table public."notificaciones" enable row level security;
alter table public."orden_items" enable row level security;
alter table public."ordenes" enable row level security;
alter table public."pago_cuentas" enable row level security;
alter table public."pago_facturas" enable row level security;
alter table public."pago_ordenes" enable row level security;
alter table public."pagos" enable row level security;
alter table public."permisos" enable row level security;
alter table public."precios_lista" enable row level security;
alter table public."producto_empaques" enable row level security;
alter table public."productos" enable row level security;
alter table public."registros_clientes" enable row level security;
alter table public."retencion_items" enable row level security;
alter table public."retenciones" enable row level security;
alter table public."roles" enable row level security;
alter table public."tasa_bcv" enable row level security;
alter table public."tipos_empaque" enable row level security;
alter table public."usuarios" enable row level security;
create policy "almacenes_auth_all" on public."almacenes" as permissive for all to authenticated
  using (true)
  with check (true);
create policy "almacenes_cliente_read" on public."almacenes" as permissive for select to authenticated
  using (((cliente_id IS NOT NULL) AND (cliente_id IN ( SELECT u.cliente_id
   FROM usuarios u
  WHERE (u.auth_id = auth.uid())))));
create policy "almacenes_perm_crear" on public."almacenes" as permissive for insert to authenticated
  with check (puede('inventario'::text, 'crear'::text));
create policy "almacenes_perm_editar" on public."almacenes" as permissive for update to authenticated
  using (puede('inventario'::text, 'editar'::text))
  with check (puede('inventario'::text, 'editar'::text));
create policy "almacenes_perm_eliminar" on public."almacenes" as permissive for delete to authenticated
  using (puede('inventario'::text, 'eliminar'::text));
create policy "almacenes_perm_ver" on public."almacenes" as permissive for select to authenticated
  using (puede('inventario'::text, 'ver'::text));
create policy "almacenes_vendedor_read" on public."almacenes" as permissive for select to authenticated
  using (((cliente_id IS NOT NULL) AND (cliente_id IN ( SELECT mis_clientes_vendedor() AS mis_clientes_vendedor))));
create policy "bancos_auth_read" on public."bancos" as permissive for select to authenticated
  using (true);
create policy "bancos_perm_crear" on public."bancos" as permissive for insert to authenticated
  with check (puede('bancos'::text, 'crear'::text));
create policy "bancos_perm_editar" on public."bancos" as permissive for update to authenticated
  using (puede('bancos'::text, 'editar'::text))
  with check (puede('bancos'::text, 'editar'::text));
create policy "bancos_perm_eliminar" on public."bancos" as permissive for delete to authenticated
  using (puede('bancos'::text, 'eliminar'::text));
create policy "banners_perm_crear" on public."banners" as permissive for insert to authenticated
  with check (puede('banners'::text, 'crear'::text));
create policy "banners_perm_editar" on public."banners" as permissive for update to authenticated
  using (puede('banners'::text, 'editar'::text))
  with check (puede('banners'::text, 'editar'::text));
create policy "banners_perm_eliminar" on public."banners" as permissive for delete to authenticated
  using (puede('banners'::text, 'eliminar'::text));
create policy "banners_perm_ver" on public."banners" as permissive for select to authenticated
  using (puede('banners'::text, 'ver'::text));
create policy "banners_public_read" on public."banners" as permissive for select to anon, authenticated
  using (true);
create policy "Usuarios manejan su carrito" on public."carrito" as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.auth_id = auth.uid()) AND (usuarios.id = carrito.usuario_id)))));
create policy "categorias_perm_crear" on public."categorias" as permissive for insert to authenticated
  with check (puede('categorias'::text, 'crear'::text));
create policy "categorias_perm_editar" on public."categorias" as permissive for update to authenticated
  using (puede('categorias'::text, 'editar'::text))
  with check (puede('categorias'::text, 'editar'::text));
create policy "categorias_perm_eliminar" on public."categorias" as permissive for delete to authenticated
  using (puede('categorias'::text, 'eliminar'::text));
create policy "categorias_perm_ver" on public."categorias" as permissive for select to authenticated
  using (puede('categorias'::text, 'ver'::text));
create policy "categorias_public_read" on public."categorias" as permissive for select to anon, authenticated
  using (true);
create policy "Clientes ven su propia info" on public."clientes" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.auth_id = auth.uid()) AND (usuarios.cliente_id = clientes.id)))));
create policy "Vendedores ven sus clientes asignados" on public."clientes" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.auth_id = auth.uid()) AND (usuarios.id = clientes.vendedor_asignado_id)))));
create policy "clientes_perm_crear" on public."clientes" as permissive for insert to authenticated
  with check (puede('clientes'::text, 'crear'::text));
create policy "clientes_perm_editar" on public."clientes" as permissive for update to authenticated
  using (puede('clientes'::text, 'editar'::text))
  with check (puede('clientes'::text, 'editar'::text));
create policy "clientes_perm_eliminar" on public."clientes" as permissive for delete to authenticated
  using (puede('clientes'::text, 'eliminar'::text));
create policy "clientes_perm_ver" on public."clientes" as permissive for select to authenticated
  using (puede('clientes'::text, 'ver'::text));
create policy "clientes_repartidor_read" on public."clientes" as permissive for select to authenticated
  using ((id IN ( SELECT mis_clientes_reparto() AS mis_clientes_reparto)));
create policy "conceptos_retencion_islr_perm_editar" on public."conceptos_retencion_islr" as permissive for update to authenticated
  using (puede('cuentas'::text, 'editar'::text))
  with check (puede('cuentas'::text, 'editar'::text));
create policy "conceptos_retencion_islr_read" on public."conceptos_retencion_islr" as permissive for select to authenticated
  using (true);
create policy "configuracion_perm_crear" on public."configuracion" as permissive for insert to authenticated
  with check (puede('configuracion'::text, 'crear'::text));
create policy "configuracion_perm_editar" on public."configuracion" as permissive for update to authenticated
  using (puede('configuracion'::text, 'editar'::text))
  with check (puede('configuracion'::text, 'editar'::text));
create policy "configuracion_perm_eliminar" on public."configuracion" as permissive for delete to authenticated
  using (puede('configuracion'::text, 'eliminar'::text));
create policy "configuracion_perm_ver" on public."configuracion" as permissive for select to authenticated
  using (puede('configuracion'::text, 'ver'::text));
create policy "configuracion_public_read" on public."configuracion" as permissive for select to anon, authenticated
  using (true);
create policy "cuentas_cobrar_auth" on public."cuentas_cobrar" as permissive for all to authenticated
  using (true)
  with check (true);
create policy "cupones_auth_read" on public."cupones" as permissive for select to authenticated
  using (true);
create policy "cupones_perm_crear" on public."cupones" as permissive for insert to authenticated
  with check (puede('cupones'::text, 'crear'::text));
create policy "cupones_perm_editar" on public."cupones" as permissive for update to authenticated
  using (puede('cupones'::text, 'editar'::text))
  with check (puede('cupones'::text, 'editar'::text));
create policy "cupones_perm_eliminar" on public."cupones" as permissive for delete to authenticated
  using (puede('cupones'::text, 'eliminar'::text));
create policy "cupones_perm_ver" on public."cupones" as permissive for select to authenticated
  using (puede('cupones'::text, 'ver'::text));
create policy "declaracion_consignacion_items_cliente_read" on public."declaracion_consignacion_items" as permissive for select to authenticated
  using ((declaracion_id IN ( SELECT d.id
   FROM declaraciones_consignacion d
  WHERE (d.cliente_id IN ( SELECT u.cliente_id
           FROM usuarios u
          WHERE (u.auth_id = auth.uid()))))));
create policy "declaracion_consignacion_items_perm_editar" on public."declaracion_consignacion_items" as permissive for update to authenticated
  using (puede('inventario'::text, 'editar'::text))
  with check (puede('inventario'::text, 'editar'::text));
create policy "declaracion_consignacion_items_perm_eliminar" on public."declaracion_consignacion_items" as permissive for delete to authenticated
  using (puede('inventario'::text, 'eliminar'::text));
create policy "declaracion_consignacion_items_perm_ver" on public."declaracion_consignacion_items" as permissive for select to authenticated
  using (puede('inventario'::text, 'ver'::text));
create policy "declaracion_consignacion_items_vendedor_read" on public."declaracion_consignacion_items" as permissive for select to authenticated
  using ((declaracion_id IN ( SELECT d.id
   FROM declaraciones_consignacion d
  WHERE (d.cliente_id IN ( SELECT mis_clientes_vendedor() AS mis_clientes_vendedor)))));
create policy "declaraciones_consignacion_cliente_read" on public."declaraciones_consignacion" as permissive for select to authenticated
  using ((cliente_id IN ( SELECT u.cliente_id
   FROM usuarios u
  WHERE (u.auth_id = auth.uid()))));
create policy "declaraciones_consignacion_perm_editar" on public."declaraciones_consignacion" as permissive for update to authenticated
  using (puede('inventario'::text, 'editar'::text))
  with check (puede('inventario'::text, 'editar'::text));
create policy "declaraciones_consignacion_perm_eliminar" on public."declaraciones_consignacion" as permissive for delete to authenticated
  using (puede('inventario'::text, 'eliminar'::text));
create policy "declaraciones_consignacion_perm_ver" on public."declaraciones_consignacion" as permissive for select to authenticated
  using (puede('inventario'::text, 'ver'::text));
create policy "declaraciones_consignacion_vendedor_read" on public."declaraciones_consignacion" as permissive for select to authenticated
  using ((cliente_id IN ( SELECT mis_clientes_vendedor() AS mis_clientes_vendedor)));
create policy "entregas_perm_crear" on public."entregas" as permissive for insert to authenticated
  with check (puede('delivery'::text, 'crear'::text));
create policy "entregas_perm_editar" on public."entregas" as permissive for update to authenticated
  using (puede('delivery'::text, 'editar'::text))
  with check (puede('delivery'::text, 'editar'::text));
create policy "entregas_perm_eliminar" on public."entregas" as permissive for delete to authenticated
  using (puede('delivery'::text, 'eliminar'::text));
create policy "entregas_perm_ver" on public."entregas" as permissive for select to authenticated
  using (puede('delivery'::text, 'ver'::text));
create policy "entregas_repartidor_read" on public."entregas" as permissive for select to authenticated
  using ((repartidor_id IN ( SELECT usuarios.id
   FROM usuarios
  WHERE (usuarios.auth_id = auth.uid()))));
create policy "entregas_repartidor_update" on public."entregas" as permissive for update to authenticated
  using ((repartidor_id IN ( SELECT usuarios.id
   FROM usuarios
  WHERE (usuarios.auth_id = auth.uid()))));
create policy "extracto_lineas_perm_editar" on public."extracto_lineas" as permissive for update to authenticated
  using (puede('bancos'::text, 'editar'::text))
  with check (puede('bancos'::text, 'editar'::text));
create policy "extracto_lineas_perm_eliminar" on public."extracto_lineas" as permissive for delete to authenticated
  using (puede('bancos'::text, 'eliminar'::text));
create policy "extracto_lineas_perm_ver" on public."extracto_lineas" as permissive for select to authenticated
  using (puede('bancos'::text, 'ver'::text));
create policy "extractos_bancarios_perm_crear" on public."extractos_bancarios" as permissive for insert to authenticated
  with check (puede('bancos'::text, 'crear'::text));
create policy "extractos_bancarios_perm_eliminar" on public."extractos_bancarios" as permissive for delete to authenticated
  using (puede('bancos'::text, 'eliminar'::text));
create policy "extractos_bancarios_perm_ver" on public."extractos_bancarios" as permissive for select to authenticated
  using (puede('bancos'::text, 'ver'::text));
create policy "factura_items_cliente_read" on public."factura_items" as permissive for select to authenticated
  using ((factura_id IN ( SELECT f.id
   FROM (facturas f
     JOIN usuarios u ON ((u.cliente_id = f.cliente_id)))
  WHERE (u.auth_id = auth.uid()))));
create policy "factura_items_perm_crear" on public."factura_items" as permissive for insert to authenticated
  with check (puede('cuentas'::text, 'crear'::text));
create policy "factura_items_perm_editar" on public."factura_items" as permissive for update to authenticated
  using (puede('cuentas'::text, 'editar'::text))
  with check (puede('cuentas'::text, 'editar'::text));
create policy "factura_items_perm_eliminar" on public."factura_items" as permissive for delete to authenticated
  using (puede('cuentas'::text, 'eliminar'::text));
create policy "factura_items_perm_ver" on public."factura_items" as permissive for select to authenticated
  using (puede('cuentas'::text, 'ver'::text));
create policy "factura_items_vendedor_read" on public."factura_items" as permissive for select to authenticated
  using ((factura_id IN ( SELECT f.id
   FROM facturas f
  WHERE (f.cliente_id IN ( SELECT mis_clientes_vendedor() AS mis_clientes_vendedor)))));
create policy "facturas_cliente_read" on public."facturas" as permissive for select to authenticated
  using ((cliente_id IN ( SELECT usuarios.cliente_id
   FROM usuarios
  WHERE (usuarios.auth_id = auth.uid()))));
create policy "facturas_perm_crear" on public."facturas" as permissive for insert to authenticated
  with check (puede('cuentas'::text, 'crear'::text));
create policy "facturas_perm_editar" on public."facturas" as permissive for update to authenticated
  using (puede('cuentas'::text, 'editar'::text))
  with check (puede('cuentas'::text, 'editar'::text));
create policy "facturas_perm_eliminar" on public."facturas" as permissive for delete to authenticated
  using (puede('cuentas'::text, 'eliminar'::text));
create policy "facturas_perm_ver" on public."facturas" as permissive for select to authenticated
  using (puede('cuentas'::text, 'ver'::text));
create policy "facturas_vendedor_read" on public."facturas" as permissive for select to authenticated
  using ((cliente_id IN ( SELECT mis_clientes_vendedor() AS mis_clientes_vendedor)));
create policy "Usuarios manejan sus favoritos" on public."favoritos" as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.auth_id = auth.uid()) AND (usuarios.id = favoritos.usuario_id)))));
create policy "Iconos visibles para todos" on public."iconos" as permissive for select to public
  using (true);
create policy "iconos_perm_crear" on public."iconos" as permissive for insert to authenticated
  with check (puede('configuracion'::text, 'crear'::text));
create policy "iconos_perm_editar" on public."iconos" as permissive for update to authenticated
  using (puede('configuracion'::text, 'editar'::text))
  with check (puede('configuracion'::text, 'editar'::text));
create policy "iconos_perm_eliminar" on public."iconos" as permissive for delete to authenticated
  using (puede('configuracion'::text, 'eliminar'::text));
create policy "iconos_perm_ver" on public."iconos" as permissive for select to authenticated
  using (puede('configuracion'::text, 'ver'::text));
create policy "iconos_public_read" on public."iconos" as permissive for select to anon, authenticated
  using (true);
create policy "inventario_almacen_cliente_read" on public."inventario_almacen" as permissive for select to authenticated
  using ((almacen_id IN ( SELECT a.id
   FROM almacenes a
  WHERE (a.cliente_id IN ( SELECT u.cliente_id
           FROM usuarios u
          WHERE (u.auth_id = auth.uid()))))));
create policy "inventario_almacen_perm_crear" on public."inventario_almacen" as permissive for insert to authenticated
  with check (puede('inventario'::text, 'crear'::text));
create policy "inventario_almacen_perm_editar" on public."inventario_almacen" as permissive for update to authenticated
  using (puede('inventario'::text, 'editar'::text))
  with check (puede('inventario'::text, 'editar'::text));
create policy "inventario_almacen_perm_eliminar" on public."inventario_almacen" as permissive for delete to authenticated
  using (puede('inventario'::text, 'eliminar'::text));
create policy "inventario_almacen_perm_ver" on public."inventario_almacen" as permissive for select to authenticated
  using (puede('inventario'::text, 'ver'::text));
create policy "inventario_almacen_vendedor_read" on public."inventario_almacen" as permissive for select to authenticated
  using ((almacen_id IN ( SELECT a.id
   FROM almacenes a
  WHERE (a.cliente_id IN ( SELECT mis_clientes_vendedor() AS mis_clientes_vendedor)))));
create policy "inventario_auth_all" on public."inventario_almacen" as permissive for all to authenticated
  using (true)
  with check (true);
create policy "listas_precios_auth_read" on public."listas_precios" as permissive for select to authenticated
  using (true);
create policy "listas_precios_perm_crear" on public."listas_precios" as permissive for insert to authenticated
  with check (puede('precios'::text, 'crear'::text));
create policy "listas_precios_perm_editar" on public."listas_precios" as permissive for update to authenticated
  using (puede('precios'::text, 'editar'::text))
  with check (puede('precios'::text, 'editar'::text));
create policy "listas_precios_perm_eliminar" on public."listas_precios" as permissive for delete to authenticated
  using (puede('precios'::text, 'eliminar'::text));
create policy "listas_precios_perm_ver" on public."listas_precios" as permissive for select to authenticated
  using (puede('precios'::text, 'ver'::text));
create policy "metas_admin_all" on public."metas_vendedor" as permissive for all to authenticated
  using (es_admin_total())
  with check (es_admin_total());
create policy "metas_vendedor_own" on public."metas_vendedor" as permissive for select to authenticated
  using ((vendedor_id IN ( SELECT usuarios.id
   FROM usuarios
  WHERE (usuarios.auth_id = auth.uid()))));
create policy "Todos pueden ver metodos de pago activos" on public."metodos_pago" as permissive for select to public
  using (((activo = true) OR (auth.uid() IN ( SELECT usuarios.auth_id
   FROM usuarios
  WHERE (usuarios.role = 'admin'::user_role)))));
create policy "metodos_pago_perm_crear" on public."metodos_pago" as permissive for insert to authenticated
  with check (puede('configuracion'::text, 'crear'::text));
create policy "metodos_pago_perm_editar" on public."metodos_pago" as permissive for update to authenticated
  using (puede('configuracion'::text, 'editar'::text))
  with check (puede('configuracion'::text, 'editar'::text));
create policy "metodos_pago_perm_eliminar" on public."metodos_pago" as permissive for delete to authenticated
  using (puede('configuracion'::text, 'eliminar'::text));
create policy "metodos_pago_perm_ver" on public."metodos_pago" as permissive for select to authenticated
  using (puede('configuracion'::text, 'ver'::text));
create policy "modulos_auth_read" on public."modulos" as permissive for select to authenticated
  using (true);
create policy "modulos_perm_crear" on public."modulos" as permissive for insert to authenticated
  with check (puede('roles'::text, 'crear'::text));
create policy "modulos_perm_editar" on public."modulos" as permissive for update to authenticated
  using (puede('roles'::text, 'editar'::text))
  with check (puede('roles'::text, 'editar'::text));
create policy "modulos_perm_eliminar" on public."modulos" as permissive for delete to authenticated
  using (puede('roles'::text, 'eliminar'::text));
create policy "modulos_perm_ver" on public."modulos" as permissive for select to authenticated
  using (puede('roles'::text, 'ver'::text));
create policy "movimientos_auth" on public."movimientos_bancarios" as permissive for all to authenticated
  using (true)
  with check (true);
create policy "movimientos_inventario_perm_crear" on public."movimientos_inventario" as permissive for insert to authenticated
  with check (puede('inventario'::text, 'crear'::text));
create policy "movimientos_inventario_perm_editar" on public."movimientos_inventario" as permissive for update to authenticated
  using (puede('inventario'::text, 'editar'::text))
  with check (puede('inventario'::text, 'editar'::text));
create policy "movimientos_inventario_perm_eliminar" on public."movimientos_inventario" as permissive for delete to authenticated
  using (puede('inventario'::text, 'eliminar'::text));
create policy "movimientos_inventario_perm_ver" on public."movimientos_inventario" as permissive for select to authenticated
  using (puede('inventario'::text, 'ver'::text));
create policy "Usuarios ven sus notificaciones" on public."notificaciones" as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.auth_id = auth.uid()) AND (usuarios.id = notificaciones.usuario_id)))));
create policy "Clientes ven items de sus órdenes" on public."orden_items" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM (ordenes o
     JOIN usuarios u ON ((u.cliente_id = o.cliente_id)))
  WHERE ((o.id = orden_items.orden_id) AND (u.auth_id = auth.uid())))));
create policy "Vendedores ven items de órdenes de sus clientes" on public."orden_items" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM ((ordenes o
     JOIN clientes c ON ((c.id = o.cliente_id)))
     JOIN usuarios u ON ((u.id = c.vendedor_asignado_id)))
  WHERE ((o.id = orden_items.orden_id) AND (u.auth_id = auth.uid())))));
create policy "orden_items_cliente_read" on public."orden_items" as permissive for select to authenticated
  using ((orden_id IN ( SELECT o.id
   FROM (ordenes o
     JOIN usuarios u ON ((u.cliente_id = o.cliente_id)))
  WHERE (u.auth_id = auth.uid()))));
create policy "orden_items_perm_crear" on public."orden_items" as permissive for insert to authenticated
  with check (puede('ordenes'::text, 'crear'::text));
create policy "orden_items_perm_editar" on public."orden_items" as permissive for update to authenticated
  using (puede('ordenes'::text, 'editar'::text))
  with check (puede('ordenes'::text, 'editar'::text));
create policy "orden_items_perm_eliminar" on public."orden_items" as permissive for delete to authenticated
  using (puede('ordenes'::text, 'eliminar'::text));
create policy "orden_items_perm_ver" on public."orden_items" as permissive for select to authenticated
  using (puede('ordenes'::text, 'ver'::text));
create policy "orden_items_repartidor_read" on public."orden_items" as permissive for select to authenticated
  using ((orden_id IN ( SELECT mis_ordenes_reparto() AS mis_ordenes_reparto)));
create policy "Clientes pueden crear órdenes" on public."ordenes" as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.auth_id = auth.uid()) AND (u.cliente_id = ordenes.cliente_id)))));
create policy "Clientes ven sus órdenes" on public."ordenes" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM (usuarios u
     JOIN clientes c ON ((c.id = u.cliente_id)))
  WHERE ((u.auth_id = auth.uid()) AND (c.id = ordenes.cliente_id)))));
create policy "Vendedores ven órdenes de sus clientes" on public."ordenes" as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.auth_id = auth.uid()) AND (usuarios.id = ordenes.vendedor_id)))));
create policy "ordenes_cliente_read" on public."ordenes" as permissive for select to authenticated
  using ((cliente_id IN ( SELECT usuarios.cliente_id
   FROM usuarios
  WHERE (usuarios.auth_id = auth.uid()))));
create policy "ordenes_perm_crear" on public."ordenes" as permissive for insert to authenticated
  with check (puede('ordenes'::text, 'crear'::text));
create policy "ordenes_perm_editar" on public."ordenes" as permissive for update to authenticated
  using (puede('ordenes'::text, 'editar'::text))
  with check (puede('ordenes'::text, 'editar'::text));
create policy "ordenes_perm_eliminar" on public."ordenes" as permissive for delete to authenticated
  using (puede('ordenes'::text, 'eliminar'::text));
create policy "ordenes_perm_ver" on public."ordenes" as permissive for select to authenticated
  using (puede('ordenes'::text, 'ver'::text));
create policy "ordenes_repartidor_read" on public."ordenes" as permissive for select to authenticated
  using ((id IN ( SELECT mis_ordenes_reparto() AS mis_ordenes_reparto)));
create policy "ordenes_vendedor_read" on public."ordenes" as permissive for select to authenticated
  using ((cliente_id IN ( SELECT c.id
   FROM (clientes c
     JOIN usuarios u ON ((u.id = c.vendedor_asignado_id)))
  WHERE (u.auth_id = auth.uid()))));
create policy "pago_cuentas_auth" on public."pago_cuentas" as permissive for all to authenticated
  using (true)
  with check (true);
create policy "pago_facturas_cliente_read" on public."pago_facturas" as permissive for select to authenticated
  using ((factura_id IN ( SELECT f.id
   FROM (facturas f
     JOIN usuarios u ON ((u.cliente_id = f.cliente_id)))
  WHERE (u.auth_id = auth.uid()))));
create policy "pago_facturas_perm_crear" on public."pago_facturas" as permissive for insert to authenticated
  with check (puede('cuentas'::text, 'crear'::text));
create policy "pago_facturas_perm_editar" on public."pago_facturas" as permissive for update to authenticated
  using (puede('cuentas'::text, 'editar'::text))
  with check (puede('cuentas'::text, 'editar'::text));
create policy "pago_facturas_perm_eliminar" on public."pago_facturas" as permissive for delete to authenticated
  using (puede('cuentas'::text, 'eliminar'::text));
create policy "pago_facturas_perm_ver" on public."pago_facturas" as permissive for select to authenticated
  using (puede('cuentas'::text, 'ver'::text));
create policy "pago_facturas_vendedor_read" on public."pago_facturas" as permissive for select to authenticated
  using ((factura_id IN ( SELECT f.id
   FROM facturas f
  WHERE (f.cliente_id IN ( SELECT mis_clientes_vendedor() AS mis_clientes_vendedor)))));
create policy "pago_ordenes_auth" on public."pago_ordenes" as permissive for all to authenticated
  using (true)
  with check (true);
create policy "Clientes pueden registrar pagos" on public."pagos" as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.auth_id = auth.uid()) AND (u.cliente_id = pagos.cliente_id)))));
create policy "Clientes ven sus pagos" on public."pagos" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.auth_id = auth.uid()) AND (u.cliente_id = pagos.cliente_id)))));
create policy "pagos_perm_crear" on public."pagos" as permissive for insert to authenticated
  with check (puede('cuentas'::text, 'crear'::text));
create policy "pagos_perm_editar" on public."pagos" as permissive for update to authenticated
  using (puede('cuentas'::text, 'editar'::text))
  with check (puede('cuentas'::text, 'editar'::text));
create policy "pagos_perm_eliminar" on public."pagos" as permissive for delete to authenticated
  using (puede('cuentas'::text, 'eliminar'::text));
create policy "pagos_perm_ver" on public."pagos" as permissive for select to authenticated
  using (puede('cuentas'::text, 'ver'::text));
create policy "pagos_vendedor_read" on public."pagos" as permissive for select to authenticated
  using ((cliente_id IN ( SELECT mis_clientes_vendedor() AS mis_clientes_vendedor)));
create policy "permisos_auth_read" on public."permisos" as permissive for select to authenticated
  using (true);
create policy "permisos_perm_crear" on public."permisos" as permissive for insert to authenticated
  with check (puede('roles'::text, 'crear'::text));
create policy "permisos_perm_editar" on public."permisos" as permissive for update to authenticated
  using (puede('roles'::text, 'editar'::text))
  with check (puede('roles'::text, 'editar'::text));
create policy "permisos_perm_eliminar" on public."permisos" as permissive for delete to authenticated
  using (puede('roles'::text, 'eliminar'::text));
create policy "permisos_perm_ver" on public."permisos" as permissive for select to authenticated
  using (puede('roles'::text, 'ver'::text));
create policy "precios_lista_auth_read" on public."precios_lista" as permissive for select to authenticated
  using (true);
create policy "precios_lista_perm_crear" on public."precios_lista" as permissive for insert to authenticated
  with check (puede('precios'::text, 'crear'::text));
create policy "precios_lista_perm_editar" on public."precios_lista" as permissive for update to authenticated
  using (puede('precios'::text, 'editar'::text))
  with check (puede('precios'::text, 'editar'::text));
create policy "precios_lista_perm_eliminar" on public."precios_lista" as permissive for delete to authenticated
  using (puede('precios'::text, 'eliminar'::text));
create policy "precios_lista_perm_ver" on public."precios_lista" as permissive for select to authenticated
  using (puede('precios'::text, 'ver'::text));
create policy "Escritura de producto_empaques" on public."producto_empaques" as permissive for all to public
  using (true);
create policy "Lectura pública de producto_empaques" on public."producto_empaques" as permissive for select to public
  using (true);
create policy "producto_empaques_perm_crear" on public."producto_empaques" as permissive for insert to authenticated
  with check (puede('productos'::text, 'crear'::text));
create policy "producto_empaques_perm_editar" on public."producto_empaques" as permissive for update to authenticated
  using (puede('productos'::text, 'editar'::text))
  with check (puede('productos'::text, 'editar'::text));
create policy "producto_empaques_perm_eliminar" on public."producto_empaques" as permissive for delete to authenticated
  using (puede('productos'::text, 'eliminar'::text));
create policy "producto_empaques_perm_ver" on public."producto_empaques" as permissive for select to authenticated
  using (puede('productos'::text, 'ver'::text));
create policy "producto_empaques_public_read" on public."producto_empaques" as permissive for select to anon, authenticated
  using (true);
create policy "Usuarios autenticados ven productos activos" on public."productos" as permissive for select to authenticated
  using ((activo = true));
create policy "productos_perm_crear" on public."productos" as permissive for insert to authenticated
  with check (puede('productos'::text, 'crear'::text));
create policy "productos_perm_editar" on public."productos" as permissive for update to authenticated
  using (puede('productos'::text, 'editar'::text))
  with check (puede('productos'::text, 'editar'::text));
create policy "productos_perm_eliminar" on public."productos" as permissive for delete to authenticated
  using (puede('productos'::text, 'eliminar'::text));
create policy "productos_perm_ver" on public."productos" as permissive for select to authenticated
  using (puede('productos'::text, 'ver'::text));
create policy "productos_public_read" on public."productos" as permissive for select to anon, authenticated
  using ((activo = true));
create policy "registros_anon_insert" on public."registros_clientes" as permissive for insert to anon
  with check (true);
create policy "registros_clientes_perm_crear" on public."registros_clientes" as permissive for insert to authenticated
  with check (puede('registros'::text, 'crear'::text));
create policy "registros_clientes_perm_editar" on public."registros_clientes" as permissive for update to authenticated
  using (puede('registros'::text, 'editar'::text))
  with check (puede('registros'::text, 'editar'::text));
create policy "registros_clientes_perm_eliminar" on public."registros_clientes" as permissive for delete to authenticated
  using (puede('registros'::text, 'eliminar'::text));
create policy "registros_clientes_perm_ver" on public."registros_clientes" as permissive for select to authenticated
  using (puede('registros'::text, 'ver'::text));
create policy "retencion_items_cliente_read" on public."retencion_items" as permissive for select to authenticated
  using ((retencion_id IN ( SELECT r.id
   FROM retenciones r
  WHERE (r.cliente_id IN ( SELECT u.cliente_id
           FROM usuarios u
          WHERE (u.auth_id = auth.uid()))))));
create policy "retencion_items_perm_editar" on public."retencion_items" as permissive for update to authenticated
  using (puede('cuentas'::text, 'editar'::text))
  with check (puede('cuentas'::text, 'editar'::text));
create policy "retencion_items_perm_eliminar" on public."retencion_items" as permissive for delete to authenticated
  using (puede('cuentas'::text, 'eliminar'::text));
create policy "retencion_items_perm_ver" on public."retencion_items" as permissive for select to authenticated
  using (puede('cuentas'::text, 'ver'::text));
create policy "retencion_items_vendedor_read" on public."retencion_items" as permissive for select to authenticated
  using ((retencion_id IN ( SELECT r.id
   FROM retenciones r
  WHERE (r.cliente_id IN ( SELECT mis_clientes_vendedor() AS mis_clientes_vendedor)))));
create policy "retenciones_cliente_read" on public."retenciones" as permissive for select to authenticated
  using ((cliente_id IN ( SELECT u.cliente_id
   FROM usuarios u
  WHERE (u.auth_id = auth.uid()))));
create policy "retenciones_perm_editar" on public."retenciones" as permissive for update to authenticated
  using (puede('cuentas'::text, 'editar'::text))
  with check (puede('cuentas'::text, 'editar'::text));
create policy "retenciones_perm_eliminar" on public."retenciones" as permissive for delete to authenticated
  using (puede('cuentas'::text, 'eliminar'::text));
create policy "retenciones_perm_ver" on public."retenciones" as permissive for select to authenticated
  using (puede('cuentas'::text, 'ver'::text));
create policy "retenciones_vendedor_read" on public."retenciones" as permissive for select to authenticated
  using ((cliente_id IN ( SELECT mis_clientes_vendedor() AS mis_clientes_vendedor)));
create policy "roles_auth_read" on public."roles" as permissive for select to authenticated
  using (true);
create policy "roles_perm_crear" on public."roles" as permissive for insert to authenticated
  with check (puede('roles'::text, 'crear'::text));
create policy "roles_perm_editar" on public."roles" as permissive for update to authenticated
  using (puede('roles'::text, 'editar'::text))
  with check (puede('roles'::text, 'editar'::text));
create policy "roles_perm_eliminar" on public."roles" as permissive for delete to authenticated
  using (puede('roles'::text, 'eliminar'::text));
create policy "roles_perm_ver" on public."roles" as permissive for select to authenticated
  using (puede('roles'::text, 'ver'::text));
create policy "tasa_bcv_read" on public."tasa_bcv" as permissive for select to authenticated
  using (true);
create policy "tipos_empaque_perm_crear" on public."tipos_empaque" as permissive for insert to authenticated
  with check (puede('productos'::text, 'crear'::text));
create policy "tipos_empaque_perm_editar" on public."tipos_empaque" as permissive for update to authenticated
  using (puede('productos'::text, 'editar'::text))
  with check (puede('productos'::text, 'editar'::text));
create policy "tipos_empaque_perm_eliminar" on public."tipos_empaque" as permissive for delete to authenticated
  using (puede('productos'::text, 'eliminar'::text));
create policy "tipos_empaque_perm_ver" on public."tipos_empaque" as permissive for select to authenticated
  using (puede('productos'::text, 'ver'::text));
create policy "tipos_empaque_public_read" on public."tipos_empaque" as permissive for select to anon, authenticated
  using (true);
create policy "usuarios_insert_own" on public."usuarios" as permissive for insert to authenticated
  with check (((auth_id = auth.uid()) AND (role = 'cliente'::user_role)));
create policy "usuarios_perm_crear" on public."usuarios" as permissive for insert to authenticated
  with check (puede('usuarios'::text, 'crear'::text));
create policy "usuarios_perm_editar" on public."usuarios" as permissive for update to authenticated
  using (puede('usuarios'::text, 'editar'::text))
  with check (puede('usuarios'::text, 'editar'::text));
create policy "usuarios_perm_eliminar" on public."usuarios" as permissive for delete to authenticated
  using (puede('usuarios'::text, 'eliminar'::text));
create policy "usuarios_perm_ver" on public."usuarios" as permissive for select to authenticated
  using (puede('usuarios'::text, 'ver'::text));
create policy "usuarios_select_own" on public."usuarios" as permissive for select to authenticated
  using ((auth_id = auth.uid()));
create policy "usuarios_update_own" on public."usuarios" as permissive for update to authenticated
  using ((auth_id = auth.uid()))
  with check ((auth_id = auth.uid()));
create policy "Authenticated users can delete images" on storage."objects" as permissive for delete to authenticated
  using ((bucket_id = 'imagenes'::text));
create policy "Authenticated users can update images" on storage."objects" as permissive for update to authenticated
  using ((bucket_id = 'imagenes'::text))
  with check ((bucket_id = 'imagenes'::text));
create policy "Authenticated users can upload images" on storage."objects" as permissive for insert to authenticated
  with check ((bucket_id = 'imagenes'::text));
create policy "Public read access for imagenes" on storage."objects" as permissive for select to public
  using ((bucket_id = 'imagenes'::text));
create policy "admin_read_documentos" on storage."objects" as permissive for select to authenticated
  using (((bucket_id = 'documentos'::text) AND is_admin()));
create policy "authenticated_upload_comprobante" on storage."objects" as permissive for insert to authenticated
  with check (((bucket_id = 'documentos'::text) AND ((storage.foldername(name))[1] = 'comprobantes'::text)));
create policy "registro_anon_upload_documento" on storage."objects" as permissive for insert to anon
  with check (((bucket_id = 'documentos'::text) AND ((storage.foldername(name))[1] = 'registros'::text)));

-- ════════════════ GRANTS (tablas y funciones, roles de Supabase) ════════════════

grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."almacenes" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."almacenes" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."almacenes" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."bancos" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."bancos" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."bancos" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."banners" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."banners" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."banners" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."carrito" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."carrito" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."carrito" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."categorias" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."categorias" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."categorias" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."clientes" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."clientes" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."clientes" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."conceptos_retencion_islr" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."conceptos_retencion_islr" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."conceptos_retencion_islr" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."configuracion" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."configuracion" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."configuracion" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."cuentas_cobrar" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."cuentas_cobrar" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."cuentas_cobrar" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."cupones" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."cupones" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."cupones" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."declaracion_consignacion_items" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."declaracion_consignacion_items" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."declaracion_consignacion_items" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."declaraciones_consignacion" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."declaraciones_consignacion" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."declaraciones_consignacion" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."entregas" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."entregas" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."entregas" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."extracto_lineas" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."extracto_lineas" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."extracto_lineas" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."extractos_bancarios" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."extractos_bancarios" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."extractos_bancarios" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."factura_items" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."factura_items" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."factura_items" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."facturas" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."facturas" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."facturas" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."favoritos" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."favoritos" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."favoritos" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."iconos" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."iconos" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."iconos" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."inventario_almacen" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."inventario_almacen" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."inventario_almacen" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."listas_precios" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."listas_precios" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."listas_precios" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."metas_vendedor" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."metas_vendedor" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."metas_vendedor" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."metodos_pago" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."metodos_pago" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."metodos_pago" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."modulos" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."modulos" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."modulos" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."movimientos_bancarios" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."movimientos_bancarios" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."movimientos_bancarios" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."movimientos_inventario" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."movimientos_inventario" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."movimientos_inventario" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."notificaciones" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."notificaciones" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."notificaciones" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."orden_items" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."orden_items" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."orden_items" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."ordenes" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."ordenes" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."ordenes" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."pago_cuentas" to anon;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."pago_cuentas" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."pago_cuentas" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."pago_facturas" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."pago_facturas" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."pago_facturas" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."pago_ordenes" to anon;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."pago_ordenes" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."pago_ordenes" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."pagos" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."pagos" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."pagos" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."permisos" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."permisos" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."permisos" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."precios_lista" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."precios_lista" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."precios_lista" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."producto_empaques" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."producto_empaques" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."producto_empaques" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."productos" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."productos" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."productos" to service_role;
grant INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE on public."registros_clientes" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."registros_clientes" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."registros_clientes" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."retencion_items" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."retencion_items" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."retencion_items" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."retenciones" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."retenciones" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."retenciones" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."roles" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."roles" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."roles" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."tasa_bcv" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."tasa_bcv" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."tasa_bcv" to service_role;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public."tipos_empaque" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."tipos_empaque" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."tipos_empaque" to service_role;
grant REFERENCES, TRIGGER, TRUNCATE on public."usuarios" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."usuarios" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."usuarios" to service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."v_anticipos" to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."v_anticipos" to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."v_anticipos" to service_role;
grant execute on function public.actualizar_estado_entrega(p_entrega_id uuid, p_estado entrega_estado, p_receptor text, p_notas text, p_motivo text, p_firma_url text, p_foto_url text) to anon;
grant execute on function public.actualizar_estado_entrega(p_entrega_id uuid, p_estado entrega_estado, p_receptor text, p_notas text, p_motivo text, p_firma_url text, p_foto_url text) to authenticated;
grant execute on function public.actualizar_estado_entrega(p_entrega_id uuid, p_estado entrega_estado, p_receptor text, p_notas text, p_motivo text, p_firma_url text, p_foto_url text) to service_role;
grant execute on function public.actualizar_stock_orden() to anon;
grant execute on function public.actualizar_stock_orden() to authenticated;
grant execute on function public.actualizar_stock_orden() to service_role;
grant execute on function public.aplicar_anticipo(p_pago_id uuid, p_asignaciones jsonb) to anon;
grant execute on function public.aplicar_anticipo(p_pago_id uuid, p_asignaciones jsonb) to authenticated;
grant execute on function public.aplicar_anticipo(p_pago_id uuid, p_asignaciones jsonb) to service_role;
grant execute on function public.aplicar_pago_a_facturas(p_pago_id uuid, p_asignaciones jsonb) to anon;
grant execute on function public.aplicar_pago_a_facturas(p_pago_id uuid, p_asignaciones jsonb) to authenticated;
grant execute on function public.aplicar_pago_a_facturas(p_pago_id uuid, p_asignaciones jsonb) to service_role;
grant execute on function public.aplicar_sugerencia_ia(p_linea_id uuid) to anon;
grant execute on function public.aplicar_sugerencia_ia(p_linea_id uuid) to authenticated;
grant execute on function public.aplicar_sugerencia_ia(p_linea_id uuid) to service_role;
grant execute on function public.aprobar_registro_cliente(p_registro_id uuid, p_admin_id uuid, p_lista_precios_id uuid, p_vendedor_id uuid, p_limite_credito numeric, p_dias_credito integer) to anon;
grant execute on function public.aprobar_registro_cliente(p_registro_id uuid, p_admin_id uuid, p_lista_precios_id uuid, p_vendedor_id uuid, p_limite_credito numeric, p_dias_credito integer) to authenticated;
grant execute on function public.aprobar_registro_cliente(p_registro_id uuid, p_admin_id uuid, p_lista_precios_id uuid, p_vendedor_id uuid, p_limite_credito numeric, p_dias_credito integer) to service_role;
grant execute on function public.asignar_entrega(p_orden_id uuid, p_repartidor_id uuid, p_prioridad text) to anon;
grant execute on function public.asignar_entrega(p_orden_id uuid, p_repartidor_id uuid, p_prioridad text) to authenticated;
grant execute on function public.asignar_entrega(p_orden_id uuid, p_repartidor_id uuid, p_prioridad text) to service_role;
grant execute on function public.cerrar_mi_cuenta() to anon;
grant execute on function public.cerrar_mi_cuenta() to authenticated;
grant execute on function public.cerrar_mi_cuenta() to service_role;
grant execute on function public.conciliar_extracto_automatico(p_extracto_id uuid) to anon;
grant execute on function public.conciliar_extracto_automatico(p_extracto_id uuid) to authenticated;
grant execute on function public.conciliar_extracto_automatico(p_extracto_id uuid) to service_role;
grant execute on function public.confirmar_match_extracto(p_linea_id uuid, p_movimiento_id uuid) to anon;
grant execute on function public.confirmar_match_extracto(p_linea_id uuid, p_movimiento_id uuid) to authenticated;
grant execute on function public.confirmar_match_extracto(p_linea_id uuid, p_movimiento_id uuid) to service_role;
grant execute on function public.crear_auth_user(p_email text, p_password text) to anon;
grant execute on function public.crear_auth_user(p_email text, p_password text) to authenticated;
grant execute on function public.crear_auth_user(p_email text, p_password text) to service_role;
grant execute on function public.crear_extracto_bancario(p_banco_id uuid, p_nombre_archivo text, p_moneda text, p_lineas jsonb) to anon;
grant execute on function public.crear_extracto_bancario(p_banco_id uuid, p_nombre_archivo text, p_moneda text, p_lineas jsonb) to authenticated;
grant execute on function public.crear_extracto_bancario(p_banco_id uuid, p_nombre_archivo text, p_moneda text, p_lineas jsonb) to service_role;
grant execute on function public.crear_orden_admin(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb) to anon;
grant execute on function public.crear_orden_admin(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb) to authenticated;
grant execute on function public.crear_orden_admin(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb) to service_role;
grant execute on function public.crear_orden_desde_carrito(p_metodo_pago pago_metodo, p_notas text, p_cupon_id uuid, p_comprobante_url text, p_referencia text, p_banco_id uuid, p_moneda text, p_tasa numeric) to anon;
grant execute on function public.crear_orden_desde_carrito(p_metodo_pago pago_metodo, p_notas text, p_cupon_id uuid, p_comprobante_url text, p_referencia text, p_banco_id uuid, p_moneda text, p_tasa numeric) to authenticated;
grant execute on function public.crear_orden_desde_carrito(p_metodo_pago pago_metodo, p_notas text, p_cupon_id uuid, p_comprobante_url text, p_referencia text, p_banco_id uuid, p_moneda text, p_tasa numeric) to service_role;
grant execute on function public.crear_orden_vendedor(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb) to anon;
grant execute on function public.crear_orden_vendedor(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb) to authenticated;
grant execute on function public.crear_orden_vendedor(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb) to service_role;
grant execute on function public.crear_usuario_admin(p_email text, p_nombre text, p_apellido text, p_role user_role, p_telefono text, p_cliente_id uuid, p_password text, p_rol_id uuid) to anon;
grant execute on function public.crear_usuario_admin(p_email text, p_nombre text, p_apellido text, p_role user_role, p_telefono text, p_cliente_id uuid, p_password text, p_rol_id uuid) to authenticated;
grant execute on function public.crear_usuario_admin(p_email text, p_nombre text, p_apellido text, p_role user_role, p_telefono text, p_cliente_id uuid, p_password text, p_rol_id uuid) to service_role;
grant execute on function public.declarar_retencion(p_cliente_id uuid, p_tipo text, p_items jsonb, p_concepto_islr_id uuid, p_comprobante_url text, p_numero text, p_fecha date, p_notas text) to anon;
grant execute on function public.declarar_retencion(p_cliente_id uuid, p_tipo text, p_items jsonb, p_concepto_islr_id uuid, p_comprobante_url text, p_numero text, p_fecha date, p_notas text) to authenticated;
grant execute on function public.declarar_retencion(p_cliente_id uuid, p_tipo text, p_items jsonb, p_concepto_islr_id uuid, p_comprobante_url text, p_numero text, p_fecha date, p_notas text) to service_role;
grant execute on function public.declarar_venta_consignacion(p_almacen_id uuid, p_items jsonb, p_notas text) to anon;
grant execute on function public.declarar_venta_consignacion(p_almacen_id uuid, p_items jsonb, p_notas text) to authenticated;
grant execute on function public.declarar_venta_consignacion(p_almacen_id uuid, p_items jsonb, p_notas text) to service_role;
grant execute on function public.descartar_linea_extracto(p_linea_id uuid, p_notas text) to anon;
grant execute on function public.descartar_linea_extracto(p_linea_id uuid, p_notas text) to authenticated;
grant execute on function public.descartar_linea_extracto(p_linea_id uuid, p_notas text) to service_role;
grant execute on function public.es_admin_total() to anon;
grant execute on function public.es_admin_total() to authenticated;
grant execute on function public.es_admin_total() to service_role;
grant execute on function public.es_vendedor_de(p_cliente_id uuid) to anon;
grant execute on function public.es_vendedor_de(p_cliente_id uuid) to authenticated;
grant execute on function public.es_vendedor_de(p_cliente_id uuid) to service_role;
grant execute on function public.facturar_orden(p_orden_id uuid) to anon;
grant execute on function public.facturar_orden(p_orden_id uuid) to authenticated;
grant execute on function public.facturar_orden(p_orden_id uuid) to service_role;
grant execute on function public.fmt_usd(n numeric) to anon;
grant execute on function public.fmt_usd(n numeric) to authenticated;
grant execute on function public.fmt_usd(n numeric) to service_role;
grant execute on function public.generar_codigo_cliente() to anon;
grant execute on function public.generar_codigo_cliente() to authenticated;
grant execute on function public.generar_codigo_cliente() to service_role;
grant execute on function public.generar_numero_orden() to anon;
grant execute on function public.generar_numero_orden() to authenticated;
grant execute on function public.generar_numero_orden() to service_role;
grant execute on function public.generar_numero_pago() to anon;
grant execute on function public.generar_numero_pago() to authenticated;
grant execute on function public.generar_numero_pago() to service_role;
grant execute on function public.generar_password_temporal() to anon;
grant execute on function public.generar_password_temporal() to authenticated;
grant execute on function public.generar_password_temporal() to service_role;
grant execute on function public.is_admin() to anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin() to service_role;
grant execute on function public.liquidar_orden(p_orden_id uuid) to anon;
grant execute on function public.liquidar_orden(p_orden_id uuid) to authenticated;
grant execute on function public.liquidar_orden(p_orden_id uuid) to service_role;
grant execute on function public.mis_clientes_reparto() to anon;
grant execute on function public.mis_clientes_reparto() to authenticated;
grant execute on function public.mis_clientes_reparto() to service_role;
grant execute on function public.mis_clientes_vendedor() to anon;
grant execute on function public.mis_clientes_vendedor() to authenticated;
grant execute on function public.mis_clientes_vendedor() to service_role;
grant execute on function public.mis_ordenes_reparto() to anon;
grant execute on function public.mis_ordenes_reparto() to authenticated;
grant execute on function public.mis_ordenes_reparto() to service_role;
grant execute on function public.mis_permisos() to anon;
grant execute on function public.mis_permisos() to authenticated;
grant execute on function public.mis_permisos() to service_role;
grant execute on function public.notif_admins(p_titulo text, p_mensaje text, p_tipo text, p_link text) to anon;
grant execute on function public.notif_admins(p_titulo text, p_mensaje text, p_tipo text, p_link text) to authenticated;
grant execute on function public.notif_admins(p_titulo text, p_mensaje text, p_tipo text, p_link text) to service_role;
grant execute on function public.notif_cliente(p_cliente_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text) to anon;
grant execute on function public.notif_cliente(p_cliente_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text) to authenticated;
grant execute on function public.notif_cliente(p_cliente_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text) to service_role;
grant execute on function public.notif_crear(p_usuario_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text) to anon;
grant execute on function public.notif_crear(p_usuario_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text) to authenticated;
grant execute on function public.notif_crear(p_usuario_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text) to service_role;
grant execute on function public.notif_vendedor(p_cliente_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text) to anon;
grant execute on function public.notif_vendedor(p_cliente_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text) to authenticated;
grant execute on function public.notif_vendedor(p_cliente_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text) to service_role;
grant execute on function public.obtener_precio_producto(p_producto_id uuid, p_cliente_id uuid) to anon;
grant execute on function public.obtener_precio_producto(p_producto_id uuid, p_cliente_id uuid) to authenticated;
grant execute on function public.obtener_precio_producto(p_producto_id uuid, p_cliente_id uuid) to service_role;
grant execute on function public.precio_efectivo(p_producto_id uuid, p_tipo_empaque_id uuid, p_cliente_id uuid) to anon;
grant execute on function public.precio_efectivo(p_producto_id uuid, p_tipo_empaque_id uuid, p_cliente_id uuid) to authenticated;
grant execute on function public.precio_efectivo(p_producto_id uuid, p_tipo_empaque_id uuid, p_cliente_id uuid) to service_role;
grant execute on function public.puede(p_codigo text, p_accion text) to anon;
grant execute on function public.puede(p_codigo text, p_accion text) to authenticated;
grant execute on function public.puede(p_codigo text, p_accion text) to service_role;
grant execute on function public.recalcular_credito(p_cliente_id uuid) to anon;
grant execute on function public.recalcular_credito(p_cliente_id uuid) to authenticated;
grant execute on function public.recalcular_credito(p_cliente_id uuid) to service_role;
grant execute on function public.rechazar_registro_cliente(p_registro_id uuid, p_admin_id uuid, p_notas text) to anon;
grant execute on function public.rechazar_registro_cliente(p_registro_id uuid, p_admin_id uuid, p_notas text) to authenticated;
grant execute on function public.rechazar_registro_cliente(p_registro_id uuid, p_admin_id uuid, p_notas text) to service_role;
grant execute on function public.registrar_cobro_facturas(p_cliente_id uuid, p_banco_id uuid, p_monto_moneda numeric, p_moneda text, p_tasa numeric, p_metodo pago_metodo, p_referencia text, p_comprobante_url text, p_notas text, p_asignaciones jsonb) to anon;
grant execute on function public.registrar_cobro_facturas(p_cliente_id uuid, p_banco_id uuid, p_monto_moneda numeric, p_moneda text, p_tasa numeric, p_metodo pago_metodo, p_referencia text, p_comprobante_url text, p_notas text, p_asignaciones jsonb) to authenticated;
grant execute on function public.registrar_cobro_facturas(p_cliente_id uuid, p_banco_id uuid, p_monto_moneda numeric, p_moneda text, p_tasa numeric, p_metodo pago_metodo, p_referencia text, p_comprobante_url text, p_notas text, p_asignaciones jsonb) to service_role;
grant execute on function public.registrar_pago(p_cliente_id uuid, p_orden_id uuid, p_banco_id uuid, p_metodo pago_metodo, p_monto_moneda numeric, p_moneda text, p_tasa_cambio numeric, p_referencia text, p_comprobante_url text) to anon;
grant execute on function public.registrar_pago(p_cliente_id uuid, p_orden_id uuid, p_banco_id uuid, p_metodo pago_metodo, p_monto_moneda numeric, p_moneda text, p_tasa_cambio numeric, p_referencia text, p_comprobante_url text) to authenticated;
grant execute on function public.registrar_pago(p_cliente_id uuid, p_orden_id uuid, p_banco_id uuid, p_metodo pago_metodo, p_monto_moneda numeric, p_moneda text, p_tasa_cambio numeric, p_referencia text, p_comprobante_url text) to service_role;
grant execute on function public.registrar_pago_vendedor(p_cliente_id uuid, p_orden_id uuid, p_monto numeric, p_metodo pago_metodo, p_referencia text) to anon;
grant execute on function public.registrar_pago_vendedor(p_cliente_id uuid, p_orden_id uuid, p_monto numeric, p_metodo pago_metodo, p_referencia text) to authenticated;
grant execute on function public.registrar_pago_vendedor(p_cliente_id uuid, p_orden_id uuid, p_monto numeric, p_metodo pago_metodo, p_referencia text) to service_role;
grant execute on function public.revisar_declaracion_consignacion(p_declaracion_id uuid, p_aprobar boolean, p_notas text) to anon;
grant execute on function public.revisar_declaracion_consignacion(p_declaracion_id uuid, p_aprobar boolean, p_notas text) to authenticated;
grant execute on function public.revisar_declaracion_consignacion(p_declaracion_id uuid, p_aprobar boolean, p_notas text) to service_role;
grant execute on function public.revisar_retencion(p_retencion_id uuid, p_aprobar boolean, p_notas text) to anon;
grant execute on function public.revisar_retencion(p_retencion_id uuid, p_aprobar boolean, p_notas text) to authenticated;
grant execute on function public.revisar_retencion(p_retencion_id uuid, p_aprobar boolean, p_notas text) to service_role;
grant execute on function public.set_default_categoria() to anon;
grant execute on function public.set_default_categoria() to authenticated;
grant execute on function public.set_default_categoria() to service_role;
grant execute on function public.set_numero_cxc() to anon;
grant execute on function public.set_numero_cxc() to authenticated;
grant execute on function public.set_numero_cxc() to service_role;
grant execute on function public.set_numero_orden() to anon;
grant execute on function public.set_numero_orden() to authenticated;
grant execute on function public.set_numero_orden() to service_role;
grant execute on function public.set_numero_pago() to anon;
grant execute on function public.set_numero_pago() to authenticated;
grant execute on function public.set_numero_pago() to service_role;
grant execute on function public.trg_entrega_asignada() to anon;
grant execute on function public.trg_entrega_asignada() to authenticated;
grant execute on function public.trg_entrega_asignada() to service_role;
grant execute on function public.trg_orden_creada() to anon;
grant execute on function public.trg_orden_creada() to authenticated;
grant execute on function public.trg_orden_creada() to service_role;
grant execute on function public.trg_orden_estado() to anon;
grant execute on function public.trg_orden_estado() to authenticated;
grant execute on function public.trg_orden_estado() to service_role;
grant execute on function public.trg_pago_estado() to anon;
grant execute on function public.trg_pago_estado() to authenticated;
grant execute on function public.trg_pago_estado() to service_role;
grant execute on function public.trg_pago_insert() to anon;
grant execute on function public.trg_pago_insert() to authenticated;
grant execute on function public.trg_pago_insert() to service_role;
grant execute on function public.trg_recalc_factura_aplicado() to anon;
grant execute on function public.trg_recalc_factura_aplicado() to authenticated;
grant execute on function public.trg_recalc_factura_aplicado() to service_role;
grant execute on function public.trg_recalc_factura_aplicado_por_pago() to anon;
grant execute on function public.trg_recalc_factura_aplicado_por_pago() to authenticated;
grant execute on function public.trg_recalc_factura_aplicado_por_pago() to service_role;
grant execute on function public.trg_recalc_factura_retenido() to anon;
grant execute on function public.trg_recalc_factura_retenido() to authenticated;
grant execute on function public.trg_recalc_factura_retenido() to service_role;
grant execute on function public.trg_recalc_factura_retenido_por_retencion() to anon;
grant execute on function public.trg_recalc_factura_retenido_por_retencion() to authenticated;
grant execute on function public.trg_recalc_factura_retenido_por_retencion() to service_role;
grant execute on function public.trg_recalcular_credito() to anon;
grant execute on function public.trg_recalcular_credito() to authenticated;
grant execute on function public.trg_recalcular_credito() to service_role;
grant execute on function public.trg_registro_nuevo() to anon;
grant execute on function public.trg_registro_nuevo() to authenticated;
grant execute on function public.trg_registro_nuevo() to service_role;
grant execute on function public.trg_stock_bajo() to anon;
grant execute on function public.trg_stock_bajo() to authenticated;
grant execute on function public.trg_stock_bajo() to service_role;
grant execute on function public.update_updated_at() to anon;
grant execute on function public.update_updated_at() to authenticated;
grant execute on function public.update_updated_at() to service_role;
grant execute on function public.upsert_tasa_bcv(p_tasa numeric, p_fuente text) to service_role;
grant execute on function public.usuarios_guard_role() to anon;
grant execute on function public.usuarios_guard_role() to authenticated;
grant execute on function public.usuarios_guard_role() to service_role;
grant execute on function public.verificar_pago(p_pago_id uuid, p_aprobar boolean, p_notas text, p_banco_id uuid, p_tasa numeric, p_asignaciones jsonb) to anon;
grant execute on function public.verificar_pago(p_pago_id uuid, p_aprobar boolean, p_notas text, p_banco_id uuid, p_tasa numeric) to anon;
grant execute on function public.verificar_pago(p_pago_id uuid, p_aprobar boolean, p_notas text, p_banco_id uuid, p_tasa numeric) to authenticated;
grant execute on function public.verificar_pago(p_pago_id uuid, p_aprobar boolean, p_notas text, p_banco_id uuid, p_tasa numeric, p_asignaciones jsonb) to authenticated;
grant execute on function public.verificar_pago(p_pago_id uuid, p_aprobar boolean, p_notas text, p_banco_id uuid, p_tasa numeric) to service_role;
grant execute on function public.verificar_pago(p_pago_id uuid, p_aprobar boolean, p_notas text, p_banco_id uuid, p_tasa numeric, p_asignaciones jsonb) to service_role;

-- ════════════════ STORAGE BUCKETS ════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('documentos', 'documentos', false, 5242880, '{"application/pdf","image/jpeg","image/png"}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('imagenes', 'imagenes', true, 2097152, '{"image/jpeg","image/png","image/gif","image/webp"}') on conflict (id) do nothing;

-- ════════════════ REALTIME (publicación supabase_realtime) ════════════════

alter publication supabase_realtime add table public."banners";
alter publication supabase_realtime add table public."categorias";
alter publication supabase_realtime add table public."configuracion";
alter publication supabase_realtime add table public."notificaciones";
alter publication supabase_realtime add table public."productos";

-- ════════════════ CRON ════════════════

select cron.schedule('actualizar-tasa-bcv-diario', '0 12 * * *', $cron$
    select net.http_post(
      url     := 'https://oyyxkbwtyxdpzsgarmim.supabase.co/functions/v1/actualizar-tasa-bcv',
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_J8477Ia3F9Ro3S7NQQlwrw_BDOYElbV'),
      body    := '{}'::jsonb
    );
  $cron$);
