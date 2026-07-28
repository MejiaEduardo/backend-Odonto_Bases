-- ============================================================================
--  MIGRACION 006 - CORRIGE ExpedienteArchivo."filePath"
--  Proyecto: Clinica Odontologica
--  Base:     PostgreSQL 16
--
--  QUE ARREGLA
--  -----------
--  La migracion 004 convirtio "filePath" en una columna calculada a partir del
--  "expedienteId":
--
--      '/archivos/expedientes/' || "expedienteId" || '/'
--
--  Eso estaba MAL. Ese es el valor que tienen las filas de prueba de
--  datos.sql, que apuntan a una carpeta. Pero "filePath" es la LLAVE del
--  archivo dentro de Firebase Storage: con ella se genera el enlace de
--  descarga y con ella se borra (bucket.file(filePath) en
--  storage.service.ts). El backend siempre la arma asi:
--
--      const filePath = `archivos/${storageName}`;
--
--  Con la formula de la 004, cualquier archivo subido de verdad quedaba
--  registrado con una ruta que no existe en el bucket: no se podia ni
--  descargar ni borrar.
--
--  Sigue siendo un dato derivado -- por eso sigue siendo una columna
--  calculada -- pero se deriva de "storageName", que es de donde sale.
--
--  A QUIEN LE HACE FALTA
--  ---------------------
--  A quien ya aplico la 004 con la formula vieja. Si aplicaste la 004
--  corregida, esta migracion detecta que ya esta bien y no hace nada.
--
--  APLICAR:
--     docker cp db/006_filepath_desde_storagename.sql odonto-db:/tmp/
--     docker exec odonto-db psql -U postgres -d odontologia -f /tmp/006_filepath_desde_storagename.sql
-- ============================================================================

BEGIN;

SET client_min_messages = WARNING;

DO $$
DECLARE
    v_expresion TEXT;
    v_malos     INTEGER;
    v_lista     TEXT;
BEGIN
    -- 1. Comprobar que la tabla y la columna existan (o sea, que la 004 corrio)
    IF to_regclass('public."ExpedienteArchivo"') IS NULL THEN
        RAISE EXCEPTION
            'No existe la tabla "ExpedienteArchivo". Falta correr la instalacion basica.';
    END IF;

    SELECT generation_expression INTO v_expresion
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'ExpedienteArchivo'
      AND column_name  = 'filePath';

    IF v_expresion IS NULL THEN
        RAISE EXCEPTION
            'FALTA LA MIGRACION 004 ("filePath" todavia no es una columna calculada). Corra db/004_correcciones_ingeniero.sql primero.';
    END IF;

    -- 2. Si ya se deriva de storageName, no hay nada que hacer
    IF v_expresion LIKE '%storageName%' THEN
        RAISE NOTICE 'La migracion 006 ya estaba aplicada: "filePath" ya se deriva de "storageName". No se cambio nada.';
        RETURN;
    END IF;

    -- 3. Ningun storageName puede estar vacio: es lo que va a construir la ruta
    SELECT count(*), string_agg(id::TEXT, ', ')
      INTO v_malos, v_lista
    FROM "ExpedienteArchivo"
    WHERE "storageName" IS NULL OR btrim("storageName") = '';

    IF v_malos > 0 THEN
        RAISE EXCEPTION
            'Migracion abortada: % archivo(s) sin storageName (ids: %). Sin ese dato no se puede reconstruir la ruta.',
            v_malos, v_lista;
    END IF;

    -- 4. Rehacer la columna
    EXECUTE 'ALTER TABLE "ExpedienteArchivo" DROP COLUMN "filePath"';
    EXECUTE 'ALTER TABLE "ExpedienteArchivo"
             ADD COLUMN "filePath" TEXT
             GENERATED ALWAYS AS (''archivos/'' || "storageName") STORED';

    RAISE NOTICE '"filePath" ahora se deriva de "storageName".';
END $$;


-- ############################################################################
-- VERIFICACION
-- ############################################################################
SET client_min_messages = NOTICE;

DO $$
DECLARE
    v_total    INTEGER;
    v_malos    INTEGER;
BEGIN
    SELECT count(*) INTO v_total FROM "ExpedienteArchivo";

    SELECT count(*) INTO v_malos
    FROM "ExpedienteArchivo"
    WHERE "filePath" <> 'archivos/' || "storageName";

    IF v_malos > 0 THEN
        RAISE EXCEPTION 'Quedaron % archivo(s) con la ruta mal armada.', v_malos;
    END IF;

    RAISE NOTICE 'Migracion 006 aplicada correctamente. Archivos revisados: %.', v_total;
END $$;

COMMIT;

ANALYZE "ExpedienteArchivo";
