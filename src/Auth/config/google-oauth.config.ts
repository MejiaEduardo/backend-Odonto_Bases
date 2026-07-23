import { registerAs } from '@nestjs/config';

export default registerAs('googleOauth', () => ({
  clienteId: process.env.GOOGLE_CLIENT_ID,
  clienteSecret: process.env.GOOGLE_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL,
}));
