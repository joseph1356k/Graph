-- Cierra el bucket `web` de Storage a los anónimos.
-- Aplicada al proyecto vivo miracle-app (zyvfamlhlmztliexvmej) vía MCP el 2026-08-02.
--
-- Estado que se corrige: tres políticas permitían a CUALQUIERA con la clave
-- pública listar (web_public_read), subir (web_anon_write) y sobrescribir
-- (web_anon_update) archivos del bucket. El advisor de Supabase solo marcaba el
-- listado; la revisión encontró que la escritura anónima también estaba abierta,
-- que es lo grave: con el repositorio público, cualquiera podía subir o
-- reemplazar archivos servidos desde un bucket del proyecto.
--
-- Verificado antes de cerrar: ningún código de la web ni del backend usa este
-- bucket (Graph usa `windows` para releases y `teach-videos` para videos), así
-- que nada se rompe. El bucket sigue siendo public: las URLs directas a los
-- objetos existentes continúan sirviendo (la lectura de objetos públicos no
-- pasa por RLS). Lo que muere es listar el contenido y escribir sin sesión.
drop policy if exists web_public_read on storage.objects;
drop policy if exists web_anon_write on storage.objects;
drop policy if exists web_anon_update on storage.objects;
