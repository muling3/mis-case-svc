import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { banner as authBanner, gatewayIdentity } from '@mis/auth-middleware';
import { banner as acBanner, accessGuard } from '@mis/access-control';

const PREFIX = 'api/cases';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Kong already authenticated the caller (jwt plugin). These read the
  // forwarded identity and enforce per-service authorization.
  app.use(gatewayIdentity());
  app.use(
    accessGuard({
      permission: 'case:read',
      // Whitelisted in-service (still token-gated by Kong, except the
      // health/ready paths which are also whitelisted in kong.yml).
      allow: ['/api/cases/health', '/api/cases/ready', '/api/cases/me'],
    }),
  );

  app.setGlobalPrefix(PREFIX);
  const port = Number(process.env.PORT) || 3003;
  await app.listen(port);
  console.log(authBanner());
  console.log(acBanner());
  console.log(`mis-case-service listening on http://localhost:${port}/${PREFIX}`);
}
bootstrap();
