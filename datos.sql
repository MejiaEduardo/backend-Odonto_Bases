-- ============================================================
-- DATOS DE PRUEBA (DML) - Sistema de Clínica
-- ============================================================

-- ------------------------------------------------------------
-- Persona (15 registros: 5 doctores, 1 recepcionista, 1 admin, 8 pacientes)
-- ------------------------------------------------------------
INSERT INTO "Persona" ("id","nombre","apellido","dni","telefono","direccion","fechaNac","updatedAt") VALUES
(1,'Carlos','Martinez','0801199012345','99881122','Col. Palmira, Tegucigalpa','1980-03-15',CURRENT_TIMESTAMP),
(2,'Maria','Fernandez','0801198523456','98765432','Col. Kennedy, Tegucigalpa','1985-07-22',CURRENT_TIMESTAMP),
(3,'Jose','Rodriguez','0801197834567','96543210','Col. Miraflores, Tegucigalpa','1978-11-05',CURRENT_TIMESTAMP),
(4,'Ana','Lopez','0801199245678','97788899','Res. Las Uvas, Tegucigalpa','1992-01-30',CURRENT_TIMESTAMP),
(5,'Luis','Hernandez','0801198856789','95566778','Col. Alameda, Tegucigalpa','1988-09-12',CURRENT_TIMESTAMP),
(6,'Sandra','Gomez','0801199567890','99123456','Col. Loarque, Tegucigalpa','1995-05-18',CURRENT_TIMESTAMP),
(7,'Roberto','Diaz','0801198278901','98112233','Col. Humuya, Tegucigalpa','1982-04-09',CURRENT_TIMESTAMP),
(8,'Pedro','Sanchez','0801199089012','97001122','Barrio Abajo, Tegucigalpa','1990-06-25',CURRENT_TIMESTAMP),
(9,'Laura','Torres','0801199390123','96223344','Col. Tepeyac, Tegucigalpa','1993-02-14',CURRENT_TIMESTAMP),
(10,'Miguel','Ramirez','0801198701234','95334455','Col. Florencia, Tegucigalpa','1987-10-08',CURRENT_TIMESTAMP),
(11,'Carmen','Flores','0801199612345','94445566','Col. Molinares, Tegucigalpa','1996-12-01',CURRENT_TIMESTAMP),
(12,'Jorge','Castillo','0801198423456','93556677','Col. San Miguel, Tegucigalpa','1984-08-19',CURRENT_TIMESTAMP),
(13,'Patricia','Nunez','0801199534567','92667788','Res. El Trapiche, Tegucigalpa','1995-03-27',CURRENT_TIMESTAMP),
(14,'Fernando','Ortiz','0801199145678','91778899','Col. 21 de Octubre, Tegucigalpa','1991-07-16',CURRENT_TIMESTAMP),
(15,'Gabriela','Morales','0801199756789','90889900','Col. La Leona, Tegucigalpa','1997-09-23',CURRENT_TIMESTAMP);

-- ------------------------------------------------------------
-- User (10 registros: 5 doctores, 1 recepcionista, 1 admin, 3 clientes)
-- personaId es UNIQUE, así que solo algunas Personas tienen User
-- ------------------------------------------------------------
INSERT INTO "User" ("id","correo","password","rol","activo","verificado","personaId","updatedAt") VALUES
(1,'carlos.martinez@clinica.com','$2b$10$hashpassword01','DOCTOR',true,true,1,CURRENT_TIMESTAMP),
(2,'maria.fernandez@clinica.com','$2b$10$hashpassword02','DOCTOR',true,true,2,CURRENT_TIMESTAMP),
(3,'jose.rodriguez@clinica.com','$2b$10$hashpassword03','DOCTOR',true,true,3,CURRENT_TIMESTAMP),
(4,'ana.lopez@clinica.com','$2b$10$hashpassword04','DOCTOR',true,true,4,CURRENT_TIMESTAMP),
(5,'luis.hernandez@clinica.com','$2b$10$hashpassword05','DOCTOR',true,true,5,CURRENT_TIMESTAMP),
(6,'sandra.gomez@clinica.com','$2b$10$hashpassword06','RECEPCIONISTA',true,true,6,CURRENT_TIMESTAMP),
(7,'roberto.diaz@clinica.com','$2b$10$hashpassword07','ADMIN',true,true,7,CURRENT_TIMESTAMP),
(8,'pedro.sanchez@gmail.com','$2b$10$hashpassword08','CLIENTE',true,true,8,CURRENT_TIMESTAMP),
(9,'laura.torres@gmail.com','$2b$10$hashpassword09','CLIENTE',true,false,9,CURRENT_TIMESTAMP),
(10,'miguel.ramirez@gmail.com','$2b$10$hashpassword10','CLIENTE',true,true,10,CURRENT_TIMESTAMP);

-- ------------------------------------------------------------
-- CodigoVerificacion (10 registros, userId es UNIQUE)
-- ------------------------------------------------------------
INSERT INTO "CodigoVerificacion" ("id","userId","codigo","fechaExpiracion","usado") VALUES
(1,1,'482913','2026-07-18 10:00:00',true),
(2,2,'193847','2026-07-18 10:00:00',true),
(3,3,'573920','2026-07-18 10:00:00',true),
(4,4,'620481','2026-07-18 10:00:00',true),
(5,5,'384756','2026-07-18 10:00:00',true),
(6,6,'847362','2026-07-18 10:00:00',true),
(7,7,'192834','2026-07-18 10:00:00',true),
(8,8,'736482','2026-07-18 10:00:00',true),
(9,9,'204958','2026-07-20 10:00:00',false),
(10,10,'657483','2026-07-18 10:00:00',true);

-- ------------------------------------------------------------
-- Empleado (7 registros: 5 doctores, 1 recepcionista, 1 admin)
-- ------------------------------------------------------------
INSERT INTO "Empleado" ("id","personaId","puesto","salario","fechaIngreso","activo") VALUES
(1,1,'DOCTOR',35000,'2018-03-01',true),
(2,2,'DOCTOR',36000,'2019-06-15',true),
(3,3,'DOCTOR',34000,'2017-01-10',true),
(4,4,'DOCTOR',37000,'2020-09-01',true),
(5,5,'DOCTOR',33000,'2021-02-20',true),
(6,6,'RECEPCIONISTA',12000,'2022-04-05',true),
(7,7,'ADMIN',20000,'2016-11-11',true);

-- ------------------------------------------------------------
-- Especialidad (10 registros)
-- ------------------------------------------------------------
INSERT INTO "Especialidad" ("id","nombre","descripcion","updatedAt") VALUES
(1,'Ortodoncia','Corrige la alineación de los dientes y la mordida.',CURRENT_TIMESTAMP),
(2,'Endodoncia','Trata las infecciones del nervio dental (conductos).',CURRENT_TIMESTAMP),
(3,'Periodoncia','Cuida las encías y los huesos que sostienen el diente.',CURRENT_TIMESTAMP),
(4,'Odontopediatría','Atención dental especializada en niños.',CURRENT_TIMESTAMP),
(5,'Rehabilitación Oral','Restaura dientes dañados o perdidos con prótesis.',CURRENT_TIMESTAMP),
(6,'Cirugía Maxilofacial','Operaciones de cara, mandíbula y extracción de cordales.',CURRENT_TIMESTAMP),
(7,'Implantología','Colocación de implantes dentales.',CURRENT_TIMESTAMP),
(8,'Odontología Estética','Mejora la apariencia visual de la sonrisa (carillas, blanqueamiento).',CURRENT_TIMESTAMP),
(9,'Patología Bucal','Diagnostica lesiones, aftas y enfermedades de la boca.',CURRENT_TIMESTAMP),
(10,'Odontología Forense','Identificación de personas mediante registros dentales.',CURRENT_TIMESTAMP);

-- ------------------------------------------------------------
-- EspecialidadDoctor (10 registros: doctorId referencia Empleado.id)
-- ------------------------------------------------------------
INSERT INTO "EspecialidadDoctor" ("doctorId","especialidadId") VALUES
(1,1),(1,6),
(2,2),(2,7),
(3,3),(3,8),
(4,4),(4,9),
(5,5),(5,10);

-- ------------------------------------------------------------
-- ServicioClinico (10 registros)
-- ------------------------------------------------------------
INSERT INTO "ServicioClinico" ("id","nombre","descripcion","precio","activo","updatedAt") VALUES
(1,'Consulta y diagnóstico dental','Evaluación clínica completa con plan de tratamiento.',400,true,CURRENT_TIMESTAMP),
(2,'Limpieza dental (profilaxis)','Eliminación de placa y sarro, con pulido dental.',800,true,CURRENT_TIMESTAMP),
(3,'Extracción de muela del juicio','Cirugía de terceros molares (cordales) con anestesia local.',3500,true,CURRENT_TIMESTAMP),
(4,'Tratamiento de conductos','Endodoncia para salvar una pieza con el nervio infectado.',4000,true,CURRENT_TIMESTAMP),
(5,'Colocación de brackets','Ortodoncia fija metálica. No incluye los controles mensuales.',12000,true,CURRENT_TIMESTAMP),
(6,'Blanqueamiento dental','Aclarado del esmalte con gel activado por luz LED.',2800,true,CURRENT_TIMESTAMP),
(7,'Sellantes y flúor (niños)','Prevención de caries en molares infantiles.',600,true,CURRENT_TIMESTAMP),
(8,'Corona dental','Prótesis fija de porcelana sobre un diente restaurado.',5500,true,CURRENT_TIMESTAMP),
(9,'Implante dental','Colocación de implante de titanio con su corona.',18000,true,CURRENT_TIMESTAMP),
(10,'Resina dental (empaste)','Restauración estética de una pieza con caries.',900,true,CURRENT_TIMESTAMP);

-- ------------------------------------------------------------
-- ServicioEspecialidad (10 registros)
-- ------------------------------------------------------------
INSERT INTO "ServicioEspecialidad" ("servicioId","especialidadId") VALUES
(1,9),(2,3),(3,6),(4,2),(5,1),(6,8),(7,4),(8,5),(9,7),(10,5);

-- ------------------------------------------------------------
-- Expediente (8 registros, pacienteId es UNIQUE -> Persona 8 al 15)
-- ------------------------------------------------------------
INSERT INTO "Expediente" ("id","pacienteId","alergias","enfermedades","medicamentos","observaciones","activo","updatedAt") VALUES
(1,8,'Penicilina','Enfermedad periodontal','Enjuague de clorhexidina','Requiere limpiezas cada 6 meses',true,CURRENT_TIMESTAMP),
(2,9,'Ninguna','Ninguna','Ninguno','Sin antecedentes relevantes',true,CURRENT_TIMESTAMP),
(3,10,'Látex','Bruxismo','Ninguno','Usa placa de descarga nocturna',true,CURRENT_TIMESTAMP),
(4,11,'Ninguna','Diabetes tipo 2','Metformina 850mg','Diabético: cicatrización lenta, cuidado en extracciones',true,CURRENT_TIMESTAMP),
(5,12,'Anestesia con epinefrina','Ninguna','Ninguno','Usar anestésico sin vasoconstrictor',true,CURRENT_TIMESTAMP),
(6,13,'Ninguna','Sensibilidad dentinaria','Pasta desensibilizante','Evitar bebidas muy frías',true,CURRENT_TIMESTAMP),
(7,14,'Aspirina','Gingivitis crónica','Ninguno','Refuerzo de técnica de cepillado',true,CURRENT_TIMESTAMP),
(8,15,'Ninguna','Ninguna','Ninguno','Paciente sano, chequeo anual',true,CURRENT_TIMESTAMP);

-- ------------------------------------------------------------
-- ExpedienteDoctor (10 registros)
-- ------------------------------------------------------------
INSERT INTO "ExpedienteDoctor" ("expedienteId","doctorId") VALUES
(1,1),(1,2),
(2,1),
(3,3),
(4,3),(4,4),
(5,4),
(6,5),
(7,5),(7,1),
(8,2);

-- ------------------------------------------------------------
-- ExpedienteDetalle (10 registros)
-- ------------------------------------------------------------
INSERT INTO "ExpedienteDetalle" ("id","expedienteId","fecha","motivo","diagnostico","tratamiento","planTratamiento","doctorId","updatedAt") VALUES
(1,1,'2026-01-10','Sangrado de encías al cepillarse','Periodontitis leve, cálculo subgingival','Raspado y alisado radicular por cuadrantes','Control periodontal en 1 mes',1,CURRENT_TIMESTAMP),
(2,2,'2026-02-05','Chequeo de rutina','Sin hallazgos relevantes','Profilaxis y aplicación de flúor','Chequeo anual',1,CURRENT_TIMESTAMP),
(3,3,'2026-01-20','Desgaste en molares y dolor mandibular','Bruxismo nocturno','Ajuste de placa de descarga','Revisión del desgaste en 3 meses',3,CURRENT_TIMESTAMP),
(4,4,'2026-02-12','Molestia al masticar del lado derecho','Caries oclusal en pieza 46','Resina compuesta en pieza 46','Control en 6 meses',3,CURRENT_TIMESTAMP),
(5,5,'2026-01-28','Dolor intenso y espontáneo en pieza 36','Pulpitis irreversible','Inicio de tratamiento de conductos','Segunda sesión de endodoncia en 8 días',4,CURRENT_TIMESTAMP),
(6,6,'2026-02-18','Sensibilidad al frío en el sector anterior','Recesión gingival con exposición dentinaria','Aplicación de barniz desensibilizante','Reevaluar en 1 mes',5,CURRENT_TIMESTAMP),
(7,7,'2026-01-15','Inflamación de encías y mal aliento','Gingivitis por placa bacteriana','Profilaxis y enjuague de clorhexidina','Refuerzo de higiene, control en 3 meses',5,CURRENT_TIMESTAMP),
(8,8,'2026-02-22','Chequeo anual','Paciente sano','Ninguno','Próximo chequeo en 1 año',2,CURRENT_TIMESTAMP),
(9,1,'2026-03-01','Control periodontal','Encías sin sangrado, evolución favorable','Pulido y refuerzo de higiene','Mantenimiento cada 6 meses',2,CURRENT_TIMESTAMP),
(10,4,'2026-03-05','Control de restauración','Resina en buen estado, sin filtración','Ninguno','Control anual',4,CURRENT_TIMESTAMP);

-- ------------------------------------------------------------
-- ExpedienteArchivo (10 registros)
-- ------------------------------------------------------------
INSERT INTO "ExpedienteArchivo" ("id","expedienteId","nombreArchivo","tipoArchivo","creadoPorId","updatedAt","filePath","storageName") VALUES
(1,1,'electrocardiograma_pedro.pdf','application/pdf',1,CURRENT_TIMESTAMP,'/archivos/expedientes/1/','ekg_1_a1b2c3.pdf'),
(2,2,'analisis_sangre_laura.pdf','application/pdf',1,CURRENT_TIMESTAMP,'/archivos/expedientes/2/','labs_2_d4e5f6.pdf'),
(3,3,'radiografia_torax_miguel.jpg','image/jpeg',3,CURRENT_TIMESTAMP,'/archivos/expedientes/3/','xray_3_g7h8i9.jpg'),
(4,4,'glucometria_carmen.pdf','application/pdf',3,CURRENT_TIMESTAMP,'/archivos/expedientes/4/','gluc_4_j1k2l3.pdf'),
(5,5,'consulta_alergias_jorge.pdf','application/pdf',4,CURRENT_TIMESTAMP,'/archivos/expedientes/5/','alrg_5_m4n5o6.pdf'),
(6,6,'resonancia_patricia.jpg','image/jpeg',5,CURRENT_TIMESTAMP,'/archivos/expedientes/6/','mri_6_p7q8r9.jpg'),
(7,7,'endoscopia_fernando.pdf','application/pdf',5,CURRENT_TIMESTAMP,'/archivos/expedientes/7/','endo_7_s1t2u3.pdf'),
(8,8,'chequeo_gabriela.pdf','application/pdf',2,CURRENT_TIMESTAMP,'/archivos/expedientes/8/','chk_8_v4w5x6.pdf'),
(9,1,'receta_pedro.pdf','application/pdf',2,CURRENT_TIMESTAMP,'/archivos/expedientes/1/','rec_1_y7z8a9.pdf'),
(10,4,'receta_carmen.pdf','application/pdf',4,CURRENT_TIMESTAMP,'/archivos/expedientes/4/','rec_4_b1c2d3.pdf');

-- ------------------------------------------------------------
-- Cita (10 registros)
-- ------------------------------------------------------------
INSERT INTO "Cita" ("id","fecha","hora","estado","pacienteId","doctorId","servicioId","recordatorio1h","recordatorio24h","updatedAt") VALUES
(1,'2026-07-20','09:00','CONFIRMADA',8,1,1,false,true,CURRENT_TIMESTAMP),
(2,'2026-07-20','10:30','PENDIENTE',9,2,6,false,false,CURRENT_TIMESTAMP),
(3,'2026-07-21','08:00','CANCELADA',10,3,8,false,false,CURRENT_TIMESTAMP),
(4,'2026-07-21','11:00','COMPLETADA',11,3,4,true,true,CURRENT_TIMESTAMP),
(5,'2026-07-22','14:00','CONFIRMADA',12,4,6,false,true,CURRENT_TIMESTAMP),
(6,'2026-07-22','15:30','CANCELADA',13,5,9,false,false,CURRENT_TIMESTAMP),
(7,'2026-07-23','09:30','COMPLETADA',14,5,1,true,true,CURRENT_TIMESTAMP),
(8,'2026-07-23','13:00','PENDIENTE',15,2,7,false,false,CURRENT_TIMESTAMP),
(9,'2026-07-24','10:00','CANCELADA',8,1,5,false,false,CURRENT_TIMESTAMP),
(10,'2026-07-25','16:00','CONFIRMADA',9,4,10,false,true,CURRENT_TIMESTAMP);

-- ------------------------------------------------------------
-- HistorialCancelacionCita (3 registros, solo citas CANCELADA: 3, 6, 9)
-- ------------------------------------------------------------
INSERT INTO "HistorialCancelacionCita" ("id","citaId","motivoCancelacion","usuarioCancelaId","rolCancela","fechaCancelacion") VALUES
(1,3,'Paciente no pudo asistir por motivos laborales',10,'CLIENTE',CURRENT_TIMESTAMP),
(2,6,'Doctor reprogramó por emergencia médica',7,'ADMIN',CURRENT_TIMESTAMP),
(3,9,'Paciente solicitó cambio de fecha',6,'RECEPCIONISTA',CURRENT_TIMESTAMP);

-- ------------------------------------------------------------
-- Logs (10 registros)
-- ------------------------------------------------------------
INSERT INTO "Logs" ("id","empleadoId","login","logout") VALUES
(1,1,'2026-07-15 08:00:00','2026-07-15 17:00:00'),
(2,2,'2026-07-15 08:05:00','2026-07-15 16:45:00'),
(3,3,'2026-07-15 07:55:00','2026-07-15 17:10:00'),
(4,4,'2026-07-16 08:10:00','2026-07-16 17:05:00'),
(5,5,'2026-07-16 08:00:00','2026-07-16 16:50:00'),
(6,6,'2026-07-16 07:45:00','2026-07-16 17:00:00'),
(7,7,'2026-07-16 08:00:00','2026-07-16 17:30:00'),
(8,1,'2026-07-17 08:00:00',NULL),
(9,2,'2026-07-17 08:15:00',NULL),
(10,6,'2026-07-17 07:50:00',NULL);

-- ------------------------------------------------------------
-- Factura (10 registros, citaId es UNIQUE cuando no es NULL)
-- ------------------------------------------------------------
INSERT INTO "Factura" ("id","numeroFactura","cai","fechaEmision","pacienteId","doctorId","subtotal","descuentos","importeExonerado","importeExento","isv15","isv18","totalPagar","citaId","updatedAt") VALUES
(1,'000-001-01-00000001','A1B2C3-D4E5F6-G7H8I9-J1K2L3-M4N5O6-P7','2026-07-21',11,3,1500,0,0,0,225,0,1725,4,CURRENT_TIMESTAMP),
(2,'000-001-01-00000002','A1B2C3-D4E5F6-G7H8I9-J1K2L3-M4N5O6-P7','2026-07-23',14,5,500,0,0,0,75,0,575,7,CURRENT_TIMESTAMP),
(3,'000-001-01-00000003','A1B2C3-D4E5F6-G7H8I9-J1K2L3-M4N5O6-P7','2026-07-10',8,1,500,50,0,0,67.5,0,517.5,NULL,CURRENT_TIMESTAMP),
(4,'000-001-01-00000004','A1B2C3-D4E5F6-G7H8I9-J1K2L3-M4N5O6-P7','2026-07-11',9,2,700,0,0,0,105,0,805,NULL,CURRENT_TIMESTAMP),
(5,'000-001-01-00000005','A1B2C3-D4E5F6-G7H8I9-J1K2L3-M4N5O6-P7','2026-07-12',10,3,600,0,0,600,0,0,600,NULL,CURRENT_TIMESTAMP),
(6,'000-001-01-00000006','A1B2C3-D4E5F6-G7H8I9-J1K2L3-M4N5O6-P7','2026-07-12',12,4,900,0,0,0,135,0,1035,NULL,CURRENT_TIMESTAMP),
(7,'000-001-01-00000007','A1B2C3-D4E5F6-G7H8I9-J1K2L3-M4N5O6-P7','2026-07-13',13,5,1000,100,0,0,135,0,1035,NULL,CURRENT_TIMESTAMP),
(8,'000-001-01-00000008','A1B2C3-D4E5F6-G7H8I9-J1K2L3-M4N5O6-P7','2026-07-13',15,2,350,0,350,0,0,0,350,NULL,CURRENT_TIMESTAMP),
(9,'000-001-01-00000009','A1B2C3-D4E5F6-G7H8I9-J1K2L3-M4N5O6-P7','2026-07-14',8,NULL,2000,0,0,0,300,0,2300,NULL,CURRENT_TIMESTAMP),
(10,'000-001-01-00000010','A1B2C3-D4E5F6-G7H8I9-J1K2L3-M4N5O6-P7','2026-07-14',9,NULL,1200,0,0,0,180,0,1380,NULL,CURRENT_TIMESTAMP);

-- ------------------------------------------------------------
-- DetalleFactura (10 registros)
-- ------------------------------------------------------------
INSERT INTO "DetalleFactura" ("id","facturaId","servicioId","descripcion","cantidad","precioUnitario","totalLinea","aplicaISV","updatedAt") VALUES
(1,1,4,'Ecografía general',1,1500,1500,true,CURRENT_TIMESTAMP),
(2,2,1,'Consulta general',1,500,500,true,CURRENT_TIMESTAMP),
(3,3,1,'Consulta general',1,500,500,true,CURRENT_TIMESTAMP),
(4,4,6,'Consulta dermatológica',1,700,700,true,CURRENT_TIMESTAMP),
(5,5,8,'Consulta pediátrica',1,600,600,false,CURRENT_TIMESTAMP),
(6,6,5,'Electrocardiograma',1,900,900,true,CURRENT_TIMESTAMP),
(7,7,9,'Terapia psicológica',1,1000,1000,true,CURRENT_TIMESTAMP),
(8,8,7,'Vacunación',1,350,350,false,CURRENT_TIMESTAMP),
(9,9,10,'Chequeo general completo',1,2000,2000,true,CURRENT_TIMESTAMP),
(10,10,3,'Extracción dental',1,1200,1200,true,CURRENT_TIMESTAMP);

-- ============================================================
-- Reiniciar las secuencias de las tablas con id SERIAL
-- (necesario porque insertamos los ids manualmente)
-- ============================================================
SELECT setval(pg_get_serial_sequence('"Persona"','id'), (SELECT MAX(id) FROM "Persona"));
SELECT setval(pg_get_serial_sequence('"User"','id'), (SELECT MAX(id) FROM "User"));
SELECT setval(pg_get_serial_sequence('"CodigoVerificacion"','id'), (SELECT MAX(id) FROM "CodigoVerificacion"));
SELECT setval(pg_get_serial_sequence('"Empleado"','id'), (SELECT MAX(id) FROM "Empleado"));
SELECT setval(pg_get_serial_sequence('"Especialidad"','id'), (SELECT MAX(id) FROM "Especialidad"));
SELECT setval(pg_get_serial_sequence('"ServicioClinico"','id'), (SELECT MAX(id) FROM "ServicioClinico"));
SELECT setval(pg_get_serial_sequence('"Expediente"','id'), (SELECT MAX(id) FROM "Expediente"));
SELECT setval(pg_get_serial_sequence('"ExpedienteDetalle"','id'), (SELECT MAX(id) FROM "ExpedienteDetalle"));
SELECT setval(pg_get_serial_sequence('"ExpedienteArchivo"','id'), (SELECT MAX(id) FROM "ExpedienteArchivo"));
SELECT setval(pg_get_serial_sequence('"Cita"','id'), (SELECT MAX(id) FROM "Cita"));
SELECT setval(pg_get_serial_sequence('"HistorialCancelacionCita"','id'), (SELECT MAX(id) FROM "HistorialCancelacionCita"));
SELECT setval(pg_get_serial_sequence('"Logs"','id'), (SELECT MAX(id) FROM "Logs"));
SELECT setval(pg_get_serial_sequence('"Factura"','id'), (SELECT MAX(id) FROM "Factura"));
SELECT setval(pg_get_serial_sequence('"DetalleFactura"','id'), (SELECT MAX(id) FROM "DetalleFactura"));