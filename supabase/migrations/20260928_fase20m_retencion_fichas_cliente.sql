-- ════════════════════════════════════════════════════════════════════════
-- Fase 20m · Retenciones desde el portal del cliente (F6)
--   declarar_retencion exigía que la ficha fuera la del perfil del usuario (usuarios.cliente_id): un cliente con ficha en
--   GUDS y en Quirutec no podía declarar en la empresa que no es la de su perfil. Ahora acepta cualquier ficha del
--   usuario (clientes_del_usuario, mismo RIF), como el resto del portal; la guardia de empresa sigue impidiendo mezclar.
--   Mensajes en tuteo (sin voseo). El resto de la función no cambia.
-- ════════════════════════════════════════════════════════════════════════
begin;

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
      -- Un cliente con ficha en las dos empresas declara sobre la ficha de la empresa activa (antes solo la de su perfil)
      if not (p_cliente_id = any (public.clientes_del_usuario())) then
        raise exception 'No tienes acceso a este cliente';
      end if;
    elsif v_usuario.role::text = 'vendedor' then
      if p_cliente_id not in (select public.mis_clientes_vendedor()) then
        raise exception 'No tienes acceso a este cliente';
      end if;
    else
      raise exception 'No autorizado';
    end if;
  end if;

  if p_tipo not in ('iva','islr') then
    raise exception 'Tipo de retención inválido: %', p_tipo;
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos una factura afectada';
  end if;

  if p_tipo = 'islr' then
    if p_concepto_islr_id is null then
      raise exception 'Elige el concepto de retención ISLR';
    end if;
    select porcentaje into v_porcentaje from public.conceptos_retencion_islr where id = p_concepto_islr_id;
  end if;

  v_numero := coalesce(p_numero, public.siguiente_numero(public.empresa_activa_requerida(), 'RET', 6));
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

revoke all on function public.declarar_retencion(uuid, text, jsonb, uuid, text, text, date, text) from public, anon;
grant execute on function public.declarar_retencion(uuid, text, jsonb, uuid, text, text, date, text) to authenticated;

commit;
