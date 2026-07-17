import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true keeps the exact posted bytes on `req.rawBody` so the LiveKit
  // webhook signature can be verified (any re-serialization breaks it).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  // LiveKit posts webhooks as `application/webhook+json`; teach the JSON parser
  // to accept that (alongside normal JSON) so its raw body is captured too.
  app.useBodyParser('json', {
    type: ['application/json', 'application/webhook+json'],
  });
  // Spike scripts and the browser client call the token endpoint cross-origin.
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
