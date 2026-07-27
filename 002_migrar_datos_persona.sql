UPDATE "Persona"
SET
    "primerNombre" = split_part(nombre,' ',1),
    "segundoNombre" = NULLIF(split_part(nombre,' ',2),''),
    "primerApellido" = split_part(apellido,' ',1),
    "segundoApellido" = NULLIF(split_part(apellido,' ',2),'');