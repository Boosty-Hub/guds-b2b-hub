begin;

-- Fase 14a: conciliación bancaria — cargar el extracto real del banco y cruzarlo contra
-- movimientos_bancarios (lo que el sistema ya registró al aprobar cobros/pagos).

create table public.extractos_bancarios (
  id uuid primary key default gen_random_uuid(),
  banco_id uuid not null references public.bancos(id),
  nombre_archivo text not null,
  moneda text not null default 'USD',
  fecha_desde date,
  fecha_hasta date,
  total_lineas int not null default 0,
  cargado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

comment on table public.extractos_bancarios is 'Lote de un extracto bancario cargado (CSV/XLSX) para conciliar contra movimientos_bancarios.';

create table public.extracto_lineas (
  id uuid primary key default gen_random_uuid(),
  extracto_id uuid not null references public.extractos_bancarios(id) on delete cascade,
  fecha date not null,
  monto numeric not null,               -- con signo: + entrada, - salida
  referencia text,
  descripcion text,
  estado text not null default 'pendiente' check (estado in ('pendiente','conciliado','descartado')),
  movimiento_bancario_id uuid references public.movimientos_bancarios(id),
  metodo_match text check (metodo_match in ('automatico','ia','manual')),
  confianza numeric,
  sugerencia_ia jsonb,                  -- {movimiento_bancario_id, confianza, motivo} — no aplica el estado por sí sola
  revisado_por uuid references public.usuarios(id),
  revisado_en timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.extracto_lineas is 'Cada fila del extracto bancario cargado. estado=conciliado solo cuando quedó ligada a un movimiento_bancario_id real (automático, sugerido por IA y aprobado, o manual).';
comment on column public.extracto_lineas.sugerencia_ia is 'Propuesta de match generada por IA (Fase 14, edge function conciliar-ia-sugerir). Solo se aplica al estado si el admin la aprueba explícitamente.';

create index extracto_lineas_extracto_idx on public.extracto_lineas(extracto_id);
create index extracto_lineas_estado_idx on public.extracto_lineas(estado);
create unique index extracto_lineas_movimiento_uq on public.extracto_lineas(movimiento_bancario_id) where movimiento_bancario_id is not null;

alter table public.extractos_bancarios enable row level security;
alter table public.extracto_lineas enable row level security;

-- Solo admin, vía el mismo módulo de permisos que ya gatea Bancos.
create policy extractos_bancarios_perm_ver on public.extractos_bancarios
  for select to authenticated using (public.puede('bancos','ver'));
create policy extractos_bancarios_perm_crear on public.extractos_bancarios
  for insert to authenticated with check (public.puede('bancos','crear'));
create policy extractos_bancarios_perm_eliminar on public.extractos_bancarios
  for delete to authenticated using (public.puede('bancos','eliminar'));

create policy extracto_lineas_perm_ver on public.extracto_lineas
  for select to authenticated using (public.puede('bancos','ver'));
create policy extracto_lineas_perm_editar on public.extracto_lineas
  for update to authenticated using (public.puede('bancos','editar')) with check (public.puede('bancos','editar'));
create policy extracto_lineas_perm_eliminar on public.extracto_lineas
  for delete to authenticated using (public.puede('bancos','eliminar'));

-- Nota: sin política de INSERT en extracto_lineas ni en extractos_bancarios más allá de la de
-- arriba para el header — la carga masiva de líneas pasa por crear_extracto_bancario()
-- (security definer, Fase 14b) para poder validar/normalizar antes de escribir.

commit;
