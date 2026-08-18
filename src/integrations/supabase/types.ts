export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      almacenes: {
        Row: {
          activo: boolean | null
          cliente_id: string | null
          codigo: string | null
          created_at: string | null
          id: string
          nombre: string
          odoo_id: number | null
          tipo: string
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          cliente_id?: string | null
          codigo?: string | null
          created_at?: string | null
          id?: string
          nombre: string
          odoo_id?: number | null
          tipo?: string
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          cliente_id?: string | null
          codigo?: string | null
          created_at?: string | null
          id?: string
          nombre?: string
          odoo_id?: number | null
          tipo?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "almacenes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      bancos: {
        Row: {
          activo: boolean
          created_at: string | null
          documento: string | null
          id: string
          metodo_pago: Database["public"]["Enums"]["pago_metodo"]
          metodos: string[] | null
          moneda: string
          nombre: string
          numero_cuenta: string | null
          odoo_id: number | null
          titular: string | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string | null
          documento?: string | null
          id?: string
          metodo_pago: Database["public"]["Enums"]["pago_metodo"]
          metodos?: string[] | null
          moneda?: string
          nombre: string
          numero_cuenta?: string | null
          odoo_id?: number | null
          titular?: string | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string | null
          documento?: string | null
          id?: string
          metodo_pago?: Database["public"]["Enums"]["pago_metodo"]
          metodos?: string[] | null
          moneda?: string
          nombre?: string
          numero_cuenta?: string | null
          odoo_id?: number | null
          titular?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      banners: {
        Row: {
          activo: boolean | null
          color_fondo: string
          color_texto: string | null
          created_at: string | null
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
          imagen_url: string | null
          link: string | null
          orden: number | null
          subtitulo: string | null
          titulo: string
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          color_fondo: string
          color_texto?: string | null
          created_at?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          imagen_url?: string | null
          link?: string | null
          orden?: number | null
          subtitulo?: string | null
          titulo: string
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          color_fondo?: string
          color_texto?: string | null
          created_at?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          imagen_url?: string | null
          link?: string | null
          orden?: number | null
          subtitulo?: string | null
          titulo?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      carrito: {
        Row: {
          cantidad: number
          created_at: string | null
          id: string
          precio_unitario: number | null
          producto_id: string
          tipo_empaque_id: string | null
          updated_at: string | null
          usuario_id: string
        }
        Insert: {
          cantidad?: number
          created_at?: string | null
          id?: string
          precio_unitario?: number | null
          producto_id: string
          tipo_empaque_id?: string | null
          updated_at?: string | null
          usuario_id: string
        }
        Update: {
          cantidad?: number
          created_at?: string | null
          id?: string
          precio_unitario?: number | null
          producto_id?: string
          tipo_empaque_id?: string | null
          updated_at?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrito_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrito_tipo_empaque_id_fkey"
            columns: ["tipo_empaque_id"]
            isOneToOne: false
            referencedRelation: "tipos_empaque"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrito_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias: {
        Row: {
          activo: boolean | null
          color: string | null
          created_at: string | null
          icono: string | null
          id: string
          nombre: string
          odoo_id: number | null
          orden: number | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          color?: string | null
          created_at?: string | null
          icono?: string | null
          id?: string
          nombre: string
          odoo_id?: number | null
          orden?: number | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          color?: string | null
          created_at?: string | null
          icono?: string | null
          id?: string
          nombre?: string
          odoo_id?: number | null
          orden?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      clientes: {
        Row: {
          activo: boolean | null
          cedula: string | null
          celular: string | null
          ciudad: string | null
          codigo: string
          condicion_pago: string | null
          contribuyente_especial: boolean
          created_at: string | null
          credito_utilizado: number | null
          dias_credito: number | null
          direccion: string | null
          direccion_entrega: string | null
          email: string | null
          es_empresa: boolean | null
          estado: string | null
          fecha_registro_odoo: string | null
          id: string
          latitud: number | null
          licencia_actividad: string | null
          limite_credito: number | null
          lista_precios_id: string | null
          longitud: number | null
          nombre_negocio: string
          notas: string | null
          odoo_id: number | null
          registro_origen_id: string | null
          retiene_islr: boolean
          retiene_iva: boolean
          rif: string
          sitio_web: string | null
          telefono: string | null
          tipo_negocio: string
          tipo_residencia: string | null
          updated_at: string | null
          vendedor_asignado_id: string | null
          vendedor_odoo: string | null
        }
        Insert: {
          activo?: boolean | null
          cedula?: string | null
          celular?: string | null
          ciudad?: string | null
          codigo: string
          condicion_pago?: string | null
          contribuyente_especial?: boolean
          created_at?: string | null
          credito_utilizado?: number | null
          dias_credito?: number | null
          direccion?: string | null
          direccion_entrega?: string | null
          email?: string | null
          es_empresa?: boolean | null
          estado?: string | null
          fecha_registro_odoo?: string | null
          id?: string
          latitud?: number | null
          licencia_actividad?: string | null
          limite_credito?: number | null
          lista_precios_id?: string | null
          longitud?: number | null
          nombre_negocio: string
          notas?: string | null
          odoo_id?: number | null
          registro_origen_id?: string | null
          retiene_islr?: boolean
          retiene_iva?: boolean
          rif: string
          sitio_web?: string | null
          telefono?: string | null
          tipo_negocio: string
          tipo_residencia?: string | null
          updated_at?: string | null
          vendedor_asignado_id?: string | null
          vendedor_odoo?: string | null
        }
        Update: {
          activo?: boolean | null
          cedula?: string | null
          celular?: string | null
          ciudad?: string | null
          codigo?: string
          condicion_pago?: string | null
          contribuyente_especial?: boolean
          created_at?: string | null
          credito_utilizado?: number | null
          dias_credito?: number | null
          direccion?: string | null
          direccion_entrega?: string | null
          email?: string | null
          es_empresa?: boolean | null
          estado?: string | null
          fecha_registro_odoo?: string | null
          id?: string
          latitud?: number | null
          licencia_actividad?: string | null
          limite_credito?: number | null
          lista_precios_id?: string | null
          longitud?: number | null
          nombre_negocio?: string
          notas?: string | null
          odoo_id?: number | null
          registro_origen_id?: string | null
          retiene_islr?: boolean
          retiene_iva?: boolean
          rif?: string
          sitio_web?: string | null
          telefono?: string | null
          tipo_negocio?: string
          tipo_residencia?: string | null
          updated_at?: string | null
          vendedor_asignado_id?: string | null
          vendedor_odoo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_lista_precios_id_fkey"
            columns: ["lista_precios_id"]
            isOneToOne: false
            referencedRelation: "listas_precios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_registro_origen_id_fkey"
            columns: ["registro_origen_id"]
            isOneToOne: false
            referencedRelation: "registros_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_vendedor_asignado_id_fkey"
            columns: ["vendedor_asignado_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      conceptos_retencion_islr: {
        Row: {
          activo: boolean
          codigo: string | null
          concepto: string
          created_at: string
          id: string
          porcentaje: number
        }
        Insert: {
          activo?: boolean
          codigo?: string | null
          concepto: string
          created_at?: string
          id?: string
          porcentaje: number
        }
        Update: {
          activo?: boolean
          codigo?: string | null
          concepto?: string
          created_at?: string
          id?: string
          porcentaje?: number
        }
        Relationships: []
      }
      configuracion: {
        Row: {
          clave: string
          created_at: string | null
          descripcion: string | null
          id: string
          tipo: string | null
          updated_at: string | null
          valor: string | null
        }
        Insert: {
          clave: string
          created_at?: string | null
          descripcion?: string | null
          id?: string
          tipo?: string | null
          updated_at?: string | null
          valor?: string | null
        }
        Update: {
          clave?: string
          created_at?: string | null
          descripcion?: string | null
          id?: string
          tipo?: string | null
          updated_at?: string | null
          valor?: string | null
        }
        Relationships: []
      }
      cuentas_cobrar: {
        Row: {
          cliente_id: string
          concepto: string
          created_at: string | null
          estado_pago: string
          fecha: string
          id: string
          monto: number
          monto_pagado: number
          notas: string | null
          numero: string | null
          origen: string | null
          updated_at: string | null
        }
        Insert: {
          cliente_id: string
          concepto: string
          created_at?: string | null
          estado_pago?: string
          fecha?: string
          id?: string
          monto: number
          monto_pagado?: number
          notas?: string | null
          numero?: string | null
          origen?: string | null
          updated_at?: string | null
        }
        Update: {
          cliente_id?: string
          concepto?: string
          created_at?: string | null
          estado_pago?: string
          fecha?: string
          id?: string
          monto?: number
          monto_pagado?: number
          notas?: string | null
          numero?: string | null
          origen?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cuentas_cobrar_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      cupones: {
        Row: {
          activo: boolean | null
          cliente_especifico_id: string | null
          codigo: string
          created_at: string | null
          descripcion: string | null
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
          maximo_descuento: number | null
          minimo_compra: number | null
          solo_primera_compra: boolean | null
          tipo: string
          updated_at: string | null
          usos_actuales: number | null
          usos_maximos: number | null
          usos_por_cliente: number | null
          valor: number
        }
        Insert: {
          activo?: boolean | null
          cliente_especifico_id?: string | null
          codigo: string
          created_at?: string | null
          descripcion?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          maximo_descuento?: number | null
          minimo_compra?: number | null
          solo_primera_compra?: boolean | null
          tipo: string
          updated_at?: string | null
          usos_actuales?: number | null
          usos_maximos?: number | null
          usos_por_cliente?: number | null
          valor: number
        }
        Update: {
          activo?: boolean | null
          cliente_especifico_id?: string | null
          codigo?: string
          created_at?: string | null
          descripcion?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          maximo_descuento?: number | null
          minimo_compra?: number | null
          solo_primera_compra?: boolean | null
          tipo?: string
          updated_at?: string | null
          usos_actuales?: number | null
          usos_maximos?: number | null
          usos_por_cliente?: number | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "cupones_cliente_especifico_id_fkey"
            columns: ["cliente_especifico_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      declaracion_consignacion_items: {
        Row: {
          cantidad: number
          created_at: string
          declaracion_id: string
          id: string
          nombre_producto: string | null
          precio_unitario: number
          producto_id: string | null
          sku_producto: string | null
          subtotal: number
        }
        Insert: {
          cantidad: number
          created_at?: string
          declaracion_id: string
          id?: string
          nombre_producto?: string | null
          precio_unitario?: number
          producto_id?: string | null
          sku_producto?: string | null
          subtotal?: number
        }
        Update: {
          cantidad?: number
          created_at?: string
          declaracion_id?: string
          id?: string
          nombre_producto?: string | null
          precio_unitario?: number
          producto_id?: string | null
          sku_producto?: string | null
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "declaracion_consignacion_items_declaracion_id_fkey"
            columns: ["declaracion_id"]
            isOneToOne: false
            referencedRelation: "declaraciones_consignacion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declaracion_consignacion_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      declaraciones_consignacion: {
        Row: {
          almacen_id: string
          cliente_id: string
          created_at: string
          declarado_por: string | null
          estado: string
          factura_id: string | null
          fecha: string
          id: string
          impuesto: number
          notas: string | null
          numero: string
          revisado_en: string | null
          revisado_por: string | null
          rol_declarante: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          almacen_id: string
          cliente_id: string
          created_at?: string
          declarado_por?: string | null
          estado?: string
          factura_id?: string | null
          fecha?: string
          id?: string
          impuesto?: number
          notas?: string | null
          numero: string
          revisado_en?: string | null
          revisado_por?: string | null
          rol_declarante: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          almacen_id?: string
          cliente_id?: string
          created_at?: string
          declarado_por?: string | null
          estado?: string
          factura_id?: string | null
          fecha?: string
          id?: string
          impuesto?: number
          notas?: string | null
          numero?: string
          revisado_en?: string | null
          revisado_por?: string | null
          rol_declarante?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "declaraciones_consignacion_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declaraciones_consignacion_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declaraciones_consignacion_declarado_por_fkey"
            columns: ["declarado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declaraciones_consignacion_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declaraciones_consignacion_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      entregas: {
        Row: {
          created_at: string | null
          distancia_km: number | null
          estado: Database["public"]["Enums"]["entrega_estado"] | null
          fecha_asignacion: string | null
          fecha_entrega: string | null
          fecha_inicio_entrega: string | null
          firma_url: string | null
          foto_entrega_url: string | null
          id: string
          motivo_fallo: string | null
          notas: string | null
          orden_id: string
          orden_ruta: number | null
          prioridad: string | null
          receptor_nombre: string | null
          repartidor_id: string | null
          tiempo_estimado_min: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          distancia_km?: number | null
          estado?: Database["public"]["Enums"]["entrega_estado"] | null
          fecha_asignacion?: string | null
          fecha_entrega?: string | null
          fecha_inicio_entrega?: string | null
          firma_url?: string | null
          foto_entrega_url?: string | null
          id?: string
          motivo_fallo?: string | null
          notas?: string | null
          orden_id: string
          orden_ruta?: number | null
          prioridad?: string | null
          receptor_nombre?: string | null
          repartidor_id?: string | null
          tiempo_estimado_min?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          distancia_km?: number | null
          estado?: Database["public"]["Enums"]["entrega_estado"] | null
          fecha_asignacion?: string | null
          fecha_entrega?: string | null
          fecha_inicio_entrega?: string | null
          firma_url?: string | null
          foto_entrega_url?: string | null
          id?: string
          motivo_fallo?: string | null
          notas?: string | null
          orden_id?: string
          orden_ruta?: number | null
          prioridad?: string | null
          receptor_nombre?: string | null
          repartidor_id?: string | null
          tiempo_estimado_min?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entregas_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_repartidor_id_fkey"
            columns: ["repartidor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      factura_items: {
        Row: {
          cantidad: number
          created_at: string | null
          descuento: number
          factura_id: string
          id: string
          nombre_producto: string | null
          odoo_id: number | null
          precio_unitario: number
          producto_id: string | null
          sku_producto: string | null
          subtotal: number
          total: number
        }
        Insert: {
          cantidad?: number
          created_at?: string | null
          descuento?: number
          factura_id: string
          id?: string
          nombre_producto?: string | null
          odoo_id?: number | null
          precio_unitario?: number
          producto_id?: string | null
          sku_producto?: string | null
          subtotal?: number
          total?: number
        }
        Update: {
          cantidad?: number
          created_at?: string | null
          descuento?: number
          factura_id?: string
          id?: string
          nombre_producto?: string | null
          odoo_id?: number | null
          precio_unitario?: number
          producto_id?: string | null
          sku_producto?: string | null
          subtotal?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "factura_items_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factura_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      facturas: {
        Row: {
          cliente_id: string | null
          creada_en_guds: boolean
          created_at: string | null
          estado: string
          estado_cobro: string | null
          estado_pago: string
          fecha_emision: string | null
          fecha_vencimiento: string | null
          id: string
          impuesto: number
          moneda: string
          monto_aplicado_usd: number
          monto_pagado: number
          monto_retenido_usd: number
          notas: string | null
          nro_control: string | null
          numero: string
          odoo_id: number | null
          odoo_sync_at: string | null
          orden_id: string | null
          referencia: string | null
          saldo_odoo_usd: number
          saldo_pendiente: number
          saldo_usd: number | null
          subtotal: number
          tasa_cambio: number | null
          tipo: string
          total: number
          total_usd: number
          updated_at: string | null
          vendedor_odoo: string | null
        }
        Insert: {
          cliente_id?: string | null
          creada_en_guds?: boolean
          created_at?: string | null
          estado?: string
          estado_cobro?: string | null
          estado_pago?: string
          fecha_emision?: string | null
          fecha_vencimiento?: string | null
          id?: string
          impuesto?: number
          moneda?: string
          monto_aplicado_usd?: number
          monto_pagado?: number
          monto_retenido_usd?: number
          notas?: string | null
          nro_control?: string | null
          numero: string
          odoo_id?: number | null
          odoo_sync_at?: string | null
          orden_id?: string | null
          referencia?: string | null
          saldo_odoo_usd?: number
          saldo_pendiente?: number
          saldo_usd?: number | null
          subtotal?: number
          tasa_cambio?: number | null
          tipo?: string
          total?: number
          total_usd?: number
          updated_at?: string | null
          vendedor_odoo?: string | null
        }
        Update: {
          cliente_id?: string | null
          creada_en_guds?: boolean
          created_at?: string | null
          estado?: string
          estado_cobro?: string | null
          estado_pago?: string
          fecha_emision?: string | null
          fecha_vencimiento?: string | null
          id?: string
          impuesto?: number
          moneda?: string
          monto_aplicado_usd?: number
          monto_pagado?: number
          monto_retenido_usd?: number
          notas?: string | null
          nro_control?: string | null
          numero?: string
          odoo_id?: number | null
          odoo_sync_at?: string | null
          orden_id?: string | null
          referencia?: string | null
          saldo_odoo_usd?: number
          saldo_pendiente?: number
          saldo_usd?: number | null
          subtotal?: number
          tasa_cambio?: number | null
          tipo?: string
          total?: number
          total_usd?: number
          updated_at?: string | null
          vendedor_odoo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facturas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes"
            referencedColumns: ["id"]
          },
        ]
      }
      favoritos: {
        Row: {
          created_at: string | null
          id: string
          producto_id: string
          usuario_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          producto_id: string
          usuario_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          producto_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favoritos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favoritos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      iconos: {
        Row: {
          activo: boolean | null
          categoria: string
          created_at: string | null
          emoji: string
          id: string
          nombre: string
          orden: number | null
        }
        Insert: {
          activo?: boolean | null
          categoria?: string
          created_at?: string | null
          emoji: string
          id?: string
          nombre: string
          orden?: number | null
        }
        Update: {
          activo?: boolean | null
          categoria?: string
          created_at?: string | null
          emoji?: string
          id?: string
          nombre?: string
          orden?: number | null
        }
        Relationships: []
      }
      inventario_almacen: {
        Row: {
          almacen_id: string
          cantidad: number
          id: string
          producto_id: string
          updated_at: string | null
        }
        Insert: {
          almacen_id: string
          cantidad?: number
          id?: string
          producto_id: string
          updated_at?: string | null
        }
        Update: {
          almacen_id?: string
          cantidad?: number
          id?: string
          producto_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventario_almacen_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventario_almacen_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      listas_precios: {
        Row: {
          activo: boolean | null
          created_at: string | null
          descripcion: string | null
          es_default: boolean | null
          id: string
          nombre: string
          porcentaje_descuento: number | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          created_at?: string | null
          descripcion?: string | null
          es_default?: boolean | null
          id?: string
          nombre: string
          porcentaje_descuento?: number | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          created_at?: string | null
          descripcion?: string | null
          es_default?: boolean | null
          id?: string
          nombre?: string
          porcentaje_descuento?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      metas_vendedor: {
        Row: {
          anio: number
          comision_ganada: number | null
          comision_porcentaje: number | null
          created_at: string | null
          id: string
          mes: number
          meta_ventas: number
          updated_at: string | null
          vendedor_id: string
          ventas_actuales: number | null
        }
        Insert: {
          anio: number
          comision_ganada?: number | null
          comision_porcentaje?: number | null
          created_at?: string | null
          id?: string
          mes: number
          meta_ventas: number
          updated_at?: string | null
          vendedor_id: string
          ventas_actuales?: number | null
        }
        Update: {
          anio?: number
          comision_ganada?: number | null
          comision_porcentaje?: number | null
          created_at?: string | null
          id?: string
          mes?: number
          meta_ventas?: number
          updated_at?: string | null
          vendedor_id?: string
          ventas_actuales?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "metas_vendedor_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      metodos_pago: {
        Row: {
          activo: boolean | null
          created_at: string | null
          datos_bancarios: Json | null
          descripcion: string | null
          disponible_portal_cliente: boolean | null
          disponible_portal_vendedor: boolean | null
          icono: string | null
          id: string
          instrucciones: string | null
          nombre: string
          orden: number | null
          requiere_comprobante: boolean | null
          tipo: string
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          created_at?: string | null
          datos_bancarios?: Json | null
          descripcion?: string | null
          disponible_portal_cliente?: boolean | null
          disponible_portal_vendedor?: boolean | null
          icono?: string | null
          id?: string
          instrucciones?: string | null
          nombre: string
          orden?: number | null
          requiere_comprobante?: boolean | null
          tipo?: string
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          created_at?: string | null
          datos_bancarios?: Json | null
          descripcion?: string | null
          disponible_portal_cliente?: boolean | null
          disponible_portal_vendedor?: boolean | null
          icono?: string | null
          id?: string
          instrucciones?: string | null
          nombre?: string
          orden?: number | null
          requiere_comprobante?: boolean | null
          tipo?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      modulos: {
        Row: {
          activo: boolean | null
          codigo: string
          descripcion: string | null
          icono: string | null
          id: string
          nombre: string
          orden: number | null
        }
        Insert: {
          activo?: boolean | null
          codigo: string
          descripcion?: string | null
          icono?: string | null
          id?: string
          nombre: string
          orden?: number | null
        }
        Update: {
          activo?: boolean | null
          codigo?: string
          descripcion?: string | null
          icono?: string | null
          id?: string
          nombre?: string
          orden?: number | null
        }
        Relationships: []
      }
      movimientos_bancarios: {
        Row: {
          banco_id: string
          created_at: string | null
          descripcion: string | null
          fecha: string
          id: string
          monto: number
          pago_id: string | null
          referencia: string | null
          tipo: string
        }
        Insert: {
          banco_id: string
          created_at?: string | null
          descripcion?: string | null
          fecha?: string
          id?: string
          monto: number
          pago_id?: string | null
          referencia?: string | null
          tipo?: string
        }
        Update: {
          banco_id?: string
          created_at?: string | null
          descripcion?: string | null
          fecha?: string
          id?: string
          monto?: number
          pago_id?: string | null
          referencia?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_bancarios_banco_id_fkey"
            columns: ["banco_id"]
            isOneToOne: false
            referencedRelation: "bancos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_bancarios_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "pagos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_bancarios_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "v_anticipos"
            referencedColumns: ["pago_id"]
          },
        ]
      }
      movimientos_inventario: {
        Row: {
          cantidad: number
          created_at: string | null
          id: string
          motivo: string | null
          producto_id: string
          referencia_id: string | null
          referencia_tipo: string | null
          stock_anterior: number
          stock_nuevo: number
          tipo: string
          usuario_id: string | null
        }
        Insert: {
          cantidad: number
          created_at?: string | null
          id?: string
          motivo?: string | null
          producto_id: string
          referencia_id?: string | null
          referencia_tipo?: string | null
          stock_anterior: number
          stock_nuevo: number
          tipo: string
          usuario_id?: string | null
        }
        Update: {
          cantidad?: number
          created_at?: string | null
          id?: string
          motivo?: string | null
          producto_id?: string
          referencia_id?: string | null
          referencia_tipo?: string | null
          stock_anterior?: number
          stock_nuevo?: number
          tipo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_inventario_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_inventario_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      notificaciones: {
        Row: {
          created_at: string | null
          data: Json | null
          id: string
          leida: boolean | null
          link: string | null
          mensaje: string | null
          tipo: string | null
          titulo: string
          usuario_id: string
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          id?: string
          leida?: boolean | null
          link?: string | null
          mensaje?: string | null
          tipo?: string | null
          titulo: string
          usuario_id: string
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          id?: string
          leida?: boolean | null
          link?: string | null
          mensaje?: string | null
          tipo?: string | null
          titulo?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificaciones_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      orden_items: {
        Row: {
          cantidad: number
          created_at: string | null
          descuento: number | null
          id: string
          nombre_producto: string | null
          odoo_id: number | null
          orden_id: string
          precio_unitario: number
          producto_id: string | null
          sku_producto: string | null
          subtotal: number
        }
        Insert: {
          cantidad: number
          created_at?: string | null
          descuento?: number | null
          id?: string
          nombre_producto?: string | null
          odoo_id?: number | null
          orden_id: string
          precio_unitario: number
          producto_id?: string | null
          sku_producto?: string | null
          subtotal: number
        }
        Update: {
          cantidad?: number
          created_at?: string | null
          descuento?: number | null
          id?: string
          nombre_producto?: string | null
          odoo_id?: number | null
          orden_id?: string
          precio_unitario?: number
          producto_id?: string | null
          sku_producto?: string | null
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "orden_items_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orden_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      ordenes: {
        Row: {
          ciudad_entrega: string | null
          cliente_id: string
          comprobante_url: string | null
          created_at: string | null
          descuento: number | null
          direccion_entrega: string | null
          envio: number | null
          estado: Database["public"]["Enums"]["orden_estado"] | null
          estado_odoo: string | null
          estado_pago: string
          fecha_entrega_estimada: string | null
          fecha_entrega_real: string | null
          fecha_pedido: string | null
          id: string
          impuesto: number | null
          metodo_pago: Database["public"]["Enums"]["pago_metodo"] | null
          moneda_original: string | null
          monto_pagado: number
          notas: string | null
          numero: string
          odoo_id: number | null
          pagado: boolean | null
          referencia_pago: string | null
          stock_descontado: boolean
          subtotal: number
          total: number
          updated_at: string | null
          usuario_id: string | null
          vendedor_id: string | null
          vendedor_odoo: string | null
        }
        Insert: {
          ciudad_entrega?: string | null
          cliente_id: string
          comprobante_url?: string | null
          created_at?: string | null
          descuento?: number | null
          direccion_entrega?: string | null
          envio?: number | null
          estado?: Database["public"]["Enums"]["orden_estado"] | null
          estado_odoo?: string | null
          estado_pago?: string
          fecha_entrega_estimada?: string | null
          fecha_entrega_real?: string | null
          fecha_pedido?: string | null
          id?: string
          impuesto?: number | null
          metodo_pago?: Database["public"]["Enums"]["pago_metodo"] | null
          moneda_original?: string | null
          monto_pagado?: number
          notas?: string | null
          numero: string
          odoo_id?: number | null
          pagado?: boolean | null
          referencia_pago?: string | null
          stock_descontado?: boolean
          subtotal?: number
          total?: number
          updated_at?: string | null
          usuario_id?: string | null
          vendedor_id?: string | null
          vendedor_odoo?: string | null
        }
        Update: {
          ciudad_entrega?: string | null
          cliente_id?: string
          comprobante_url?: string | null
          created_at?: string | null
          descuento?: number | null
          direccion_entrega?: string | null
          envio?: number | null
          estado?: Database["public"]["Enums"]["orden_estado"] | null
          estado_odoo?: string | null
          estado_pago?: string
          fecha_entrega_estimada?: string | null
          fecha_entrega_real?: string | null
          fecha_pedido?: string | null
          id?: string
          impuesto?: number | null
          metodo_pago?: Database["public"]["Enums"]["pago_metodo"] | null
          moneda_original?: string | null
          monto_pagado?: number
          notas?: string | null
          numero?: string
          odoo_id?: number | null
          pagado?: boolean | null
          referencia_pago?: string | null
          stock_descontado?: boolean
          subtotal?: number
          total?: number
          updated_at?: string | null
          usuario_id?: string | null
          vendedor_id?: string | null
          vendedor_odoo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      pago_cuentas: {
        Row: {
          created_at: string | null
          cuenta_id: string
          id: string
          monto_aplicado: number
          pago_id: string
        }
        Insert: {
          created_at?: string | null
          cuenta_id: string
          id?: string
          monto_aplicado: number
          pago_id: string
        }
        Update: {
          created_at?: string | null
          cuenta_id?: string
          id?: string
          monto_aplicado?: number
          pago_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pago_cuentas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas_cobrar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pago_cuentas_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "pagos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pago_cuentas_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "v_anticipos"
            referencedColumns: ["pago_id"]
          },
        ]
      }
      pago_facturas: {
        Row: {
          created_at: string
          created_by: string | null
          factura_id: string
          id: string
          monto_aplicado: number
          pago_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          factura_id: string
          id?: string
          monto_aplicado: number
          pago_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          factura_id?: string
          id?: string
          monto_aplicado?: number
          pago_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pago_facturas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pago_facturas_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pago_facturas_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "pagos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pago_facturas_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "v_anticipos"
            referencedColumns: ["pago_id"]
          },
        ]
      }
      pago_ordenes: {
        Row: {
          created_at: string | null
          id: string
          monto_aplicado: number
          orden_id: string
          pago_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          monto_aplicado: number
          orden_id: string
          pago_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          monto_aplicado?: number
          orden_id?: string
          pago_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pago_ordenes_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pago_ordenes_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "pagos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pago_ordenes_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "v_anticipos"
            referencedColumns: ["pago_id"]
          },
        ]
      }
      pagos: {
        Row: {
          banco: string | null
          banco_id: string | null
          cliente_id: string
          comprobante_url: string | null
          created_at: string | null
          estado: Database["public"]["Enums"]["pago_estado"] | null
          fecha_verificacion: string | null
          id: string
          metodo: Database["public"]["Enums"]["pago_metodo"]
          moneda: string
          monto: number
          monto_moneda: number | null
          notas: string | null
          numero: string
          odoo_id: number | null
          orden_id: string | null
          referencia: string | null
          tasa_cambio: number | null
          updated_at: string | null
          verificado_por: string | null
        }
        Insert: {
          banco?: string | null
          banco_id?: string | null
          cliente_id: string
          comprobante_url?: string | null
          created_at?: string | null
          estado?: Database["public"]["Enums"]["pago_estado"] | null
          fecha_verificacion?: string | null
          id?: string
          metodo: Database["public"]["Enums"]["pago_metodo"]
          moneda?: string
          monto: number
          monto_moneda?: number | null
          notas?: string | null
          numero: string
          odoo_id?: number | null
          orden_id?: string | null
          referencia?: string | null
          tasa_cambio?: number | null
          updated_at?: string | null
          verificado_por?: string | null
        }
        Update: {
          banco?: string | null
          banco_id?: string | null
          cliente_id?: string
          comprobante_url?: string | null
          created_at?: string | null
          estado?: Database["public"]["Enums"]["pago_estado"] | null
          fecha_verificacion?: string | null
          id?: string
          metodo?: Database["public"]["Enums"]["pago_metodo"]
          moneda?: string
          monto?: number
          monto_moneda?: number | null
          notas?: string | null
          numero?: string
          odoo_id?: number | null
          orden_id?: string | null
          referencia?: string | null
          tasa_cambio?: number | null
          updated_at?: string | null
          verificado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pagos_banco_id_fkey"
            columns: ["banco_id"]
            isOneToOne: false
            referencedRelation: "bancos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_verificado_por_fkey"
            columns: ["verificado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      permisos: {
        Row: {
          created_at: string | null
          id: string
          modulo_id: string
          puede_crear: boolean | null
          puede_editar: boolean | null
          puede_eliminar: boolean | null
          puede_ver: boolean | null
          rol_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          modulo_id: string
          puede_crear?: boolean | null
          puede_editar?: boolean | null
          puede_eliminar?: boolean | null
          puede_ver?: boolean | null
          rol_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          modulo_id?: string
          puede_crear?: boolean | null
          puede_editar?: boolean | null
          puede_eliminar?: boolean | null
          puede_ver?: boolean | null
          rol_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permisos_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "modulos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permisos_rol_id_fkey"
            columns: ["rol_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      precios_lista: {
        Row: {
          created_at: string | null
          id: string
          lista_precios_id: string
          precio: number
          producto_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          lista_precios_id: string
          precio: number
          producto_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          lista_precios_id?: string
          precio?: number
          producto_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "precios_lista_lista_precios_id_fkey"
            columns: ["lista_precios_id"]
            isOneToOne: false
            referencedRelation: "listas_precios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "precios_lista_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      producto_empaques: {
        Row: {
          activo: boolean | null
          created_at: string | null
          id: string
          precio_empaque: number | null
          producto_id: string
          tipo_empaque_id: string
        }
        Insert: {
          activo?: boolean | null
          created_at?: string | null
          id?: string
          precio_empaque?: number | null
          producto_id: string
          tipo_empaque_id: string
        }
        Update: {
          activo?: boolean | null
          created_at?: string | null
          id?: string
          precio_empaque?: number | null
          producto_id?: string
          tipo_empaque_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "producto_empaques_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_empaques_tipo_empaque_id_fkey"
            columns: ["tipo_empaque_id"]
            isOneToOne: false
            referencedRelation: "tipos_empaque"
            referencedColumns: ["id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean | null
          categoria_id: string | null
          costo: number | null
          created_at: string | null
          descripcion: string | null
          destacado: boolean | null
          en_oferta: boolean | null
          id: string
          imagen_emoji: string | null
          imagen_url: string | null
          imagenes: Json
          nombre: string
          odoo_id: number | null
          porcentaje_descuento: number | null
          precio_base: number
          precio_oferta: number | null
          sku: string
          stock_actual: number | null
          stock_maximo: number | null
          stock_minimo: number | null
          tipo_empaque_id: string | null
          unidad: string
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          categoria_id?: string | null
          costo?: number | null
          created_at?: string | null
          descripcion?: string | null
          destacado?: boolean | null
          en_oferta?: boolean | null
          id?: string
          imagen_emoji?: string | null
          imagen_url?: string | null
          imagenes?: Json
          nombre: string
          odoo_id?: number | null
          porcentaje_descuento?: number | null
          precio_base: number
          precio_oferta?: number | null
          sku: string
          stock_actual?: number | null
          stock_maximo?: number | null
          stock_minimo?: number | null
          tipo_empaque_id?: string | null
          unidad: string
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          categoria_id?: string | null
          costo?: number | null
          created_at?: string | null
          descripcion?: string | null
          destacado?: boolean | null
          en_oferta?: boolean | null
          id?: string
          imagen_emoji?: string | null
          imagen_url?: string | null
          imagenes?: Json
          nombre?: string
          odoo_id?: number | null
          porcentaje_descuento?: number | null
          precio_base?: number
          precio_oferta?: number | null
          sku?: string
          stock_actual?: number | null
          stock_maximo?: number | null
          stock_minimo?: number | null
          tipo_empaque_id?: string | null
          unidad?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_tipo_empaque_id_fkey"
            columns: ["tipo_empaque_id"]
            isOneToOne: false
            referencedRelation: "tipos_empaque"
            referencedColumns: ["id"]
          },
        ]
      }
      registros_clientes: {
        Row: {
          apellido_contacto: string | null
          ciudad: string
          cliente_creado_id: string | null
          contribuyente_especial: boolean
          created_at: string | null
          direccion: string
          direccion_entrega: string | null
          email: string
          estado: Database["public"]["Enums"]["registro_estado"] | null
          fecha_revision: string | null
          id: string
          nombre_contacto: string
          nombre_negocio: string
          notas: string | null
          revisado_por: string | null
          rif: string
          rif_documento_path: string | null
          telefono: string
          tipo_negocio: string
          updated_at: string | null
        }
        Insert: {
          apellido_contacto?: string | null
          ciudad: string
          cliente_creado_id?: string | null
          contribuyente_especial?: boolean
          created_at?: string | null
          direccion: string
          direccion_entrega?: string | null
          email: string
          estado?: Database["public"]["Enums"]["registro_estado"] | null
          fecha_revision?: string | null
          id?: string
          nombre_contacto: string
          nombre_negocio: string
          notas?: string | null
          revisado_por?: string | null
          rif: string
          rif_documento_path?: string | null
          telefono: string
          tipo_negocio: string
          updated_at?: string | null
        }
        Update: {
          apellido_contacto?: string | null
          ciudad?: string
          cliente_creado_id?: string | null
          contribuyente_especial?: boolean
          created_at?: string | null
          direccion?: string
          direccion_entrega?: string | null
          email?: string
          estado?: Database["public"]["Enums"]["registro_estado"] | null
          fecha_revision?: string | null
          id?: string
          nombre_contacto?: string
          nombre_negocio?: string
          notas?: string | null
          revisado_por?: string | null
          rif?: string
          rif_documento_path?: string | null
          telefono?: string
          tipo_negocio?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registros_clientes_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      retencion_items: {
        Row: {
          created_at: string
          factura_id: string
          id: string
          monto_aplicado: number
          odoo_id: number | null
          retencion_id: string
        }
        Insert: {
          created_at?: string
          factura_id: string
          id?: string
          monto_aplicado: number
          odoo_id?: number | null
          retencion_id: string
        }
        Update: {
          created_at?: string
          factura_id?: string
          id?: string
          monto_aplicado?: number
          odoo_id?: number | null
          retencion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retencion_items_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retencion_items_retencion_id_fkey"
            columns: ["retencion_id"]
            isOneToOne: false
            referencedRelation: "retenciones"
            referencedColumns: ["id"]
          },
        ]
      }
      retenciones: {
        Row: {
          base_imponible: number
          cliente_id: string
          comprobante_url: string | null
          concepto_islr_id: string | null
          created_at: string
          declarado_por: string | null
          estado: string
          fecha: string
          id: string
          notas: string | null
          numero: string
          odoo_id: number | null
          porcentaje: number | null
          revisado_en: string | null
          revisado_por: string | null
          rol_declarante: string
          tipo: string
          total: number
          updated_at: string
        }
        Insert: {
          base_imponible?: number
          cliente_id: string
          comprobante_url?: string | null
          concepto_islr_id?: string | null
          created_at?: string
          declarado_por?: string | null
          estado?: string
          fecha?: string
          id?: string
          notas?: string | null
          numero: string
          odoo_id?: number | null
          porcentaje?: number | null
          revisado_en?: string | null
          revisado_por?: string | null
          rol_declarante: string
          tipo: string
          total?: number
          updated_at?: string
        }
        Update: {
          base_imponible?: number
          cliente_id?: string
          comprobante_url?: string | null
          concepto_islr_id?: string | null
          created_at?: string
          declarado_por?: string | null
          estado?: string
          fecha?: string
          id?: string
          notas?: string | null
          numero?: string
          odoo_id?: number | null
          porcentaje?: number | null
          revisado_en?: string | null
          revisado_por?: string | null
          rol_declarante?: string
          tipo?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retenciones_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retenciones_concepto_islr_id_fkey"
            columns: ["concepto_islr_id"]
            isOneToOne: false
            referencedRelation: "conceptos_retencion_islr"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retenciones_declarado_por_fkey"
            columns: ["declarado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retenciones_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          activo: boolean | null
          color: string | null
          created_at: string | null
          descripcion: string | null
          es_sistema: boolean | null
          id: string
          nombre: string
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          color?: string | null
          created_at?: string | null
          descripcion?: string | null
          es_sistema?: boolean | null
          id?: string
          nombre: string
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          color?: string | null
          created_at?: string | null
          descripcion?: string | null
          es_sistema?: boolean | null
          id?: string
          nombre?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      tasa_bcv: {
        Row: {
          created_at: string
          fecha: string
          fuente: string | null
          id: string
          tasa: number
        }
        Insert: {
          created_at?: string
          fecha?: string
          fuente?: string | null
          id?: string
          tasa: number
        }
        Update: {
          created_at?: string
          fecha?: string
          fuente?: string | null
          id?: string
          tasa?: number
        }
        Relationships: []
      }
      tipos_empaque: {
        Row: {
          activo: boolean | null
          created_at: string | null
          descripcion: string | null
          id: string
          nombre: string
          orden: number | null
          unidades: number
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          created_at?: string | null
          descripcion?: string | null
          id?: string
          nombre: string
          orden?: number | null
          unidades?: number
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          created_at?: string | null
          descripcion?: string | null
          id?: string
          nombre?: string
          orden?: number | null
          unidades?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      usuarios: {
        Row: {
          activo: boolean | null
          apellido: string | null
          auth_id: string | null
          avatar_url: string | null
          cliente_id: string | null
          created_at: string | null
          email: string
          id: string
          nombre: string
          rol_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          telefono: string | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          apellido?: string | null
          auth_id?: string | null
          avatar_url?: string | null
          cliente_id?: string | null
          created_at?: string | null
          email: string
          id?: string
          nombre: string
          rol_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          telefono?: string | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          apellido?: string | null
          auth_id?: string | null
          avatar_url?: string | null
          cliente_id?: string | null
          created_at?: string | null
          email?: string
          id?: string
          nombre?: string
          rol_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          telefono?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_usuarios_cliente"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usuarios_rol_id_fkey"
            columns: ["rol_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_anticipos: {
        Row: {
          aplicado: number | null
          cliente_id: string | null
          created_at: string | null
          disponible: number | null
          monto_usd: number | null
          numero: string | null
          pago_id: string | null
        }
        Insert: {
          aplicado?: never
          cliente_id?: string | null
          created_at?: string | null
          disponible?: never
          monto_usd?: number | null
          numero?: string | null
          pago_id?: string | null
        }
        Update: {
          aplicado?: never
          cliente_id?: string | null
          created_at?: string | null
          disponible?: never
          monto_usd?: number | null
          numero?: string | null
          pago_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pagos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      actualizar_estado_entrega: {
        Args: {
          p_entrega_id: string
          p_estado: Database["public"]["Enums"]["entrega_estado"]
          p_firma_url?: string
          p_foto_url?: string
          p_motivo?: string
          p_notas?: string
          p_receptor?: string
        }
        Returns: undefined
      }
      aplicar_anticipo: {
        Args: { p_asignaciones: Json; p_pago_id: string }
        Returns: Json
      }
      aplicar_pago_a_facturas: {
        Args: { p_asignaciones: Json; p_pago_id: string }
        Returns: number
      }
      aprobar_registro_cliente: {
        Args: {
          p_admin_id?: string
          p_dias_credito?: number
          p_limite_credito?: number
          p_lista_precios_id?: string
          p_registro_id: string
          p_vendedor_id?: string
        }
        Returns: {
          cliente_id: string
          email: string
          password_temporal: string
        }[]
      }
      asignar_entrega: {
        Args: {
          p_orden_id: string
          p_prioridad?: string
          p_repartidor_id: string
        }
        Returns: string
      }
      cerrar_mi_cuenta: { Args: never; Returns: undefined }
      crear_auth_user: {
        Args: { p_email: string; p_password: string }
        Returns: string
      }
      crear_orden_admin: {
        Args: {
          p_cliente_id: string
          p_items: Json
          p_metodo_pago: Database["public"]["Enums"]["pago_metodo"]
          p_notas: string
        }
        Returns: {
          numero: string
          orden_id: string
          total: number
        }[]
      }
      crear_orden_desde_carrito: {
        Args: {
          p_banco_id?: string
          p_comprobante_url?: string
          p_cupon_id?: string
          p_metodo_pago: Database["public"]["Enums"]["pago_metodo"]
          p_moneda?: string
          p_notas?: string
          p_referencia?: string
          p_tasa?: number
        }
        Returns: {
          numero: string
          orden_id: string
          total: number
        }[]
      }
      crear_orden_vendedor: {
        Args: {
          p_cliente_id: string
          p_items: Json
          p_metodo_pago: Database["public"]["Enums"]["pago_metodo"]
          p_notas: string
        }
        Returns: {
          numero: string
          orden_id: string
          total: number
        }[]
      }
      crear_usuario_admin: {
        Args: {
          p_apellido: string
          p_cliente_id?: string
          p_email: string
          p_nombre: string
          p_password?: string
          p_role: Database["public"]["Enums"]["user_role"]
          p_telefono?: string
        }
        Returns: {
          password_temporal: string
          usuario_id: string
        }[]
      }
      declarar_retencion: {
        Args: {
          p_cliente_id: string
          p_comprobante_url?: string
          p_concepto_islr_id?: string
          p_fecha?: string
          p_items: Json
          p_notas?: string
          p_numero?: string
          p_tipo: string
        }
        Returns: string
      }
      declarar_venta_consignacion: {
        Args: { p_almacen_id: string; p_items: Json; p_notas?: string }
        Returns: string
      }
      es_admin_total: { Args: never; Returns: boolean }
      es_vendedor_de: { Args: { p_cliente_id: string }; Returns: boolean }
      facturar_orden: { Args: { p_orden_id: string }; Returns: string }
      fmt_usd: { Args: { n: number }; Returns: string }
      generar_codigo_cliente: { Args: never; Returns: string }
      generar_numero_orden: { Args: never; Returns: string }
      generar_numero_pago: { Args: never; Returns: string }
      generar_password_temporal: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      liquidar_orden: { Args: { p_orden_id: string }; Returns: undefined }
      mis_clientes_reparto: { Args: never; Returns: string[] }
      mis_clientes_vendedor: { Args: never; Returns: string[] }
      mis_ordenes_reparto: { Args: never; Returns: string[] }
      mis_permisos: { Args: never; Returns: Json }
      notif_admins: {
        Args: {
          p_link: string
          p_mensaje: string
          p_tipo: string
          p_titulo: string
        }
        Returns: undefined
      }
      notif_cliente: {
        Args: {
          p_cliente_id: string
          p_link: string
          p_mensaje: string
          p_tipo: string
          p_titulo: string
        }
        Returns: undefined
      }
      notif_crear: {
        Args: {
          p_link: string
          p_mensaje: string
          p_tipo: string
          p_titulo: string
          p_usuario_id: string
        }
        Returns: undefined
      }
      notif_vendedor: {
        Args: {
          p_cliente_id: string
          p_link: string
          p_mensaje: string
          p_tipo: string
          p_titulo: string
        }
        Returns: undefined
      }
      obtener_precio_producto: {
        Args: { p_cliente_id: string; p_producto_id: string }
        Returns: number
      }
      precio_efectivo: {
        Args: {
          p_cliente_id?: string
          p_producto_id: string
          p_tipo_empaque_id?: string
        }
        Returns: number
      }
      puede: { Args: { p_accion: string; p_codigo: string }; Returns: boolean }
      recalcular_credito: { Args: { p_cliente_id: string }; Returns: undefined }
      rechazar_registro_cliente: {
        Args: { p_admin_id: string; p_notas?: string; p_registro_id: string }
        Returns: boolean
      }
      registrar_cobro_facturas: {
        Args: {
          p_asignaciones?: Json
          p_banco_id: string
          p_cliente_id: string
          p_comprobante_url: string
          p_metodo: Database["public"]["Enums"]["pago_metodo"]
          p_moneda: string
          p_monto_moneda: number
          p_notas: string
          p_referencia: string
          p_tasa: number
        }
        Returns: Json
      }
      registrar_pago: {
        Args: {
          p_banco_id: string
          p_cliente_id: string
          p_comprobante_url?: string
          p_metodo: Database["public"]["Enums"]["pago_metodo"]
          p_moneda?: string
          p_monto_moneda: number
          p_orden_id: string
          p_referencia?: string
          p_tasa_cambio?: number
        }
        Returns: string
      }
      registrar_pago_vendedor: {
        Args: {
          p_cliente_id: string
          p_metodo: Database["public"]["Enums"]["pago_metodo"]
          p_monto: number
          p_orden_id: string
          p_referencia?: string
        }
        Returns: string
      }
      revisar_declaracion_consignacion: {
        Args: { p_aprobar: boolean; p_declaracion_id: string; p_notas?: string }
        Returns: Json
      }
      revisar_retencion: {
        Args: { p_aprobar: boolean; p_notas?: string; p_retencion_id: string }
        Returns: Json
      }
      upsert_tasa_bcv: {
        Args: { p_fuente?: string; p_tasa: number }
        Returns: Json
      }
      verificar_pago:
        | {
            Args: {
              p_aprobar: boolean
              p_asignaciones?: Json
              p_banco_id?: string
              p_notas?: string
              p_pago_id: string
              p_tasa?: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_aprobar: boolean
              p_banco_id: string
              p_notas: string
              p_pago_id: string
              p_tasa: number
            }
            Returns: undefined
          }
    }
    Enums: {
      entrega_estado: "asignada" | "en_camino" | "entregada" | "fallida"
      orden_estado:
        | "pendiente"
        | "confirmado"
        | "procesando"
        | "enviado"
        | "completado"
        | "cancelado"
      pago_estado: "pendiente" | "verificado" | "rechazado"
      pago_metodo:
        | "transferencia"
        | "efectivo"
        | "credito"
        | "pago_movil"
        | "tarjeta"
      registro_estado: "pendiente" | "aprobado" | "rechazado"
      user_role: "admin" | "cliente" | "vendedor" | "delivery"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      entrega_estado: ["asignada", "en_camino", "entregada", "fallida"],
      orden_estado: [
        "pendiente",
        "confirmado",
        "procesando",
        "enviado",
        "completado",
        "cancelado",
      ],
      pago_estado: ["pendiente", "verificado", "rechazado"],
      pago_metodo: [
        "transferencia",
        "efectivo",
        "credito",
        "pago_movil",
        "tarjeta",
      ],
      registro_estado: ["pendiente", "aprobado", "rechazado"],
      user_role: ["admin", "cliente", "vendedor", "delivery"],
    },
  },
} as const
