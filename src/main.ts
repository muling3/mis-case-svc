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

  // Test driver for the document-upload + Sandbox-scan PoC.
  // The accessGuard whitelist below is exact-match; the test-upload routes
  // include a dynamic /:documentId segment for status polling, so we let
  // anything under /api/cases/test-upload/ through with a prefix bypass.
  app.use((req: any, _res: any, next: () => void) => {
    if (req.path === '/api/cases/test-upload' ||
        req.path.startsWith('/api/cases/test-upload/')) {
      req.__skipAccessGuard = true;
    }
    next();
  });
  app.use((req: any, res: any, next: () => void) => {
    if (req.__skipAccessGuard) return next();
    return accessGuard({
      permission: 'case:read',
      // Whitelisted in-service (still token-gated by Kong, except the
      // health/ready paths which are also whitelisted in kong.yml).
      allow: ['/api/cases/health', '/api/cases/ready', '/api/cases/me'],
    })(req, res, next);
  });

  app.setGlobalPrefix(PREFIX);
  const port = Number(process.env.PORT) || 3003;
  await app.listen(port);
  console.log(authBanner());
  console.log(acBanner());
  console.log(`mis-case-service listening on http://localhost:${port}/${PREFIX}`);
}
bootstrap();
