import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { initializeApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { Bucket } from '@google-cloud/storage';

/**
 * Firebase Storage: se usa SOLO para adjuntar archivos a los expedientes.
 *
 * Antes, si faltaba FIREBASE_SERVICE_ACCOUNT_KEY, este servicio lanzaba una
 * excepción en onModuleInit y eso tumbaba TODA la aplicación: no arrancaban
 * citas, ni login, ni expedientes. Una función opcional bloqueaba el sistema
 * completo.
 *
 * Ahora la inicialización es opcional:
 *   - Sin credenciales -> avisa por consola y el servidor arranca normal.
 *   - Solo falla si alguien intenta subir un archivo de verdad.
 *
 * Para habilitarlo, agregar al .env:
 *   FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account", ...}   (JSON en UNA línea)
 *   FIREBASE_STORAGE_BUCKET=nombre-del-bucket.appspot.com
 */
@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private bucket: Bucket | null = null;

  onModuleInit() {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    // Sin credenciales: seguimos sin Firebase en vez de tumbar la app.
    if (!serviceAccountJson) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT_KEY no está definida. ' +
          'La subida de archivos a expedientes quedará deshabilitada; ' +
          'el resto del sistema funciona con normalidad.',
      );
      return;
    }

    let serviceAccount: ServiceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
    } catch (e) {
      this.logger.error(
        'FIREBASE_SERVICE_ACCOUNT_KEY no es un JSON válido. ' +
          'Subida de archivos deshabilitada.',
        e as Error,
      );
      return;
    }

    try {
      const app = initializeApp({
        credential: cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      });
      this.bucket = getStorage(app).bucket();
      this.logger.log('Firebase Admin SDK inicializado.');
    } catch (e) {
      this.logger.error(
        'No se pudo inicializar Firebase. Subida de archivos deshabilitada.',
        e as Error,
      );
    }
  }

  /**
   * Devuelve el bucket de Storage.
   * Lanza solo si de verdad se intenta usar sin haberlo configurado,
   * para que el error salga en el endpoint de subida y no en el arranque.
   */
  getBucket(): Bucket {
    if (!this.bucket) {
      throw new Error(
        'Firebase Storage no está configurado. ' +
          'Define FIREBASE_SERVICE_ACCOUNT_KEY y FIREBASE_STORAGE_BUCKET en el .env ' +
          'para habilitar la subida de archivos.',
      );
    }
    return this.bucket;
  }

  /** Permite a otros servicios saber si la subida está disponible. */
  estaConfigurado(): boolean {
    return this.bucket !== null;
  }
}
