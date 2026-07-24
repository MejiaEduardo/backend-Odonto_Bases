import { Module } from "@nestjs/common";
import { ExpedienteArchivoService } from "./expediente-archivo.service";
import { FirebaseService } from "./firebase.service";
import { StorageService } from "./storage.service";

@Module({
    // ConfigModule ya debería estar registrado globalmente en AppModule
    // (ConfigModule.forRoot({ isGlobal: true })), no hace falta repetirlo aquí.
    providers: [ExpedienteArchivoService, FirebaseService, StorageService],
    exports: [StorageService, ExpedienteArchivoService],
})
export class FirebaseModule {}
 