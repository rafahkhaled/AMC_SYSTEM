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
  });

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
