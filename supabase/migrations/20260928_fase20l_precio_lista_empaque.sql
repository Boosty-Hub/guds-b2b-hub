-- ════════════════════════════════════════════════════════════════════════
-- Fase 20l · precio_efectivo: el precio de una lista negociada (precios_lista) es por unidad; un empaque vale unidades × precio
--   (flanco del agente del catálogo: hoy no hay filas, pero una caja se habría cobrado al precio de una unidad)
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.precio_efectivo(p_producto_id uuid, p_tipo_empaque_id uuid DEFAULT NULL::uuid, p_cliente_id uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_precio numeric;
  v_lista uuid;
  v_moneda text;
  v_unidades numeric := 1;
  v_base numeric;
  v_categoria uuid;
  r record;
begin
  select case when en_oferta and precio_oferta is not null then precio_oferta else precio_base end, categoria_id
    into v_base, v_categoria from productos where id = p_producto_id;
  if p_tipo_empaque_id is not null then
    select greatest(coalesce(te.unidades, 1), 1) into v_unidades from tipos_empaque te where te.id = p_tipo_empaque_id;
  end if;

  if p_cliente_id is not null then
    select c.lista_precios_id, l.moneda into v_lista, v_moneda from clientes c left join listas_precios l on l.id = c.lista_precios_id where c.id = p_cliente_id;
    if v_lista is not null then
      -- 1) Precio negociado de la lista en GUDS
      select precio into v_precio from precios_lista where producto_id = p_producto_id and lista_precios_id = v_lista;
      -- El precio de la lista es por unidad (como Odoo): un empaque vale unidades × precio
      if v_precio is not null then return round(v_precio * coalesce(v_unidades, 1), 4); end if;
      -- 2) Regla de la lista de Odoo (solo listas en USD): producto > categoría > global, cantidad mínima ≤ 1, vigente
      if coalesce(v_moneda, 'USD') = 'USD' then
        select * into r from reglas_precio g
        where g.lista_precios_id = v_lista and g.activo and g.cantidad_minima <= 1
          and (g.fecha_inicio is null or g.fecha_inicio <= now()) and (g.fecha_fin is null or g.fecha_fin >= now())
          and (g.aplicado_en = 'global' or (g.aplicado_en = 'producto' and g.producto_id = p_producto_id)
               or (g.aplicado_en = 'categoria' and g.categoria_id = v_categoria))
        order by case g.aplicado_en when 'producto' then 0 when 'categoria' then 1 else 2 end, g.cantidad_minima desc
        limit 1;
        if found then
          v_precio := case r.tipo_calculo
            when 'fijo' then r.precio_fijo
            when 'porcentaje' then v_base * (1 - coalesce(r.descuento_pct, 0) / 100.0)
            else v_base * (1 - coalesce(r.descuento_pct, 0) / 100.0) + coalesce(r.recargo, 0) end;
          if v_precio is not null then return round(v_precio * coalesce(v_unidades, 1), 4); end if;
        end if;
      end if;
    end if;
  end if;

  -- 3) Precio explícito del empaque
  if p_tipo_empaque_id is not null then
    select precio_empaque into v_precio from producto_empaques
    where producto_id = p_producto_id and tipo_empaque_id = p_tipo_empaque_id and precio_empaque is not null;
    if v_precio is not null then return v_precio; end if;
  end if;

  -- 4) Oferta / precio base: son por unidad (como en Odoo); un empaque sin precio propio vale unidades × precio
  return round(v_base * coalesce(v_unidades, 1), 4);
end $function$
;

commit;
