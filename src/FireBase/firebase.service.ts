import { Injectable, OnModuleInit } from '@nestjs/common';
import { initializeApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { Bucket } from '@google-cloud/storage';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private bucket: Bucket;

  onModuleInit() {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    // 1. Verificar si la clave existe (medida de seguridad)
    if (!serviceAccountJson) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_KEY no está definida en las variables de entorno.',
      );
    }

    // 2. Parsear la cadena JSON a un objeto que firebase-admin necesita
    let serviceAccount: ServiceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch (e) {
      console.error('Error al parsear FIREBASE_SERVICE_ACCOUNT_KEY:', e);
      throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY no es un JSON válido.');
    }

    // 3. Inicializar usando la API modular (firebase-admin v12+)
    const app = initializeApp({
      credential: cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

    this.bucket = getStorage(app).bucket();
    console.log('Firebase Admin SDK inicializado.');
  }

  getBucket(): Bucket {
    return this.bucket;
  }
}