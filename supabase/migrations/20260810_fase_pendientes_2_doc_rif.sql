-- Pendientes de lanzamiento — Fase 2 (adjuntar documento RIF en el registro)
-- Item 2: el cliente debe poder adjuntar el documento del RIF al solicitar
-- su registro. Va a un bucket PRIVADO (a diferencia de `imagenes`, que es
-- público) porque es PII: solo admins pueden leerlo, vía signed URL.
begin;

alter table public.registros_clientes
  add column if not exists rif_documento_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 5242880, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

-- anon solo puede insertar bajo registros/ (formulario de registro es pre-auth)
-- y nunca puede leer: el documento solo se ve desde el panel admin.
create policy "registro_anon_upload_documento"
  on storage.objects for insert to anon
  with check (bucket_id = 'documentos' and (storage.foldername(name))[1] = 'registros');

create policy "admin_read_documentos"
  on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and public.is_admin());

commit;
