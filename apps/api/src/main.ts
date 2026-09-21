import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigurationError, type Environment, readEnvironment } from './config/env.js';
import { PinoLoggerService, createLogger } from './observability/logger.js';

async function bootstrap(): Promise<void> {
  let environment: Environment;
  try {
    environment = readEnvironment();
  } catch (error) {
    // Before the logger exists, and deliberately loud: a misconfigured process
    // must fail here rather than halfway through someone's first request.
    if (error instanceof ConfigurationError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(environment);

  const app = await NestFactory.create(AppModule, {
    logger: new PinoLoggerService(logger),
    bufferLogs: true,
    /*
     * Keep the bytes of every request body alongside the parsed one.
     *
     * The WhatsApp webhook is authenticated by an HMAC over exactly what Meta
     * sent, and JSON.parse followed by JSON.stringify does not reproduce those
     * bytes — key order, whitespace and unicode escapes all differ, and the
     * digest differs with them. Without this the signature never matches and
     * every message a client sends is refused.
     */
    rawBody: true,
  });

  /**
   * Everything the API serves lives under /api, so the browser application can
   * be served from the same origin as the API it talks to. That is not a
   * cosmetic choice: the session cookie is SameSite=Strict, which means a
   * different origin would never send it at all.
   */
  app.setGlobalPrefix('api');

  // Do not advertise the framework. It tells an attacker which advisories to
  // try and tells an honest user nothing.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // No class-validator pipe here on purpose. Request validation comes from the
  // Zod schemas in @amc/contracts, which the browser imports too, so one schema
  // defines the shape on both sides. The pipe arrives with those contracts.
  app.enableShutdownHooks();

  await app.listen(environment.PORT);
  logger.info({ port: environment.PORT }, 'AMC API listening');
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `Failed to start: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
