"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const auth_middleware_1 = require("@mis/auth-middleware");
const access_control_1 = require("@mis/access-control");
const PREFIX = 'api/cases';
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    // Kong already authenticated the caller (jwt plugin). These read the
    // forwarded identity and enforce per-service authorization.
    app.use((0, auth_middleware_1.gatewayIdentity)());
    app.use((0, access_control_1.accessGuard)({
        permission: 'case:read',
        // Whitelisted in-service (still token-gated by Kong, except the
        // health/ready paths which are also whitelisted in kong.yml).
        allow: ['/api/cases/health', '/api/cases/ready', '/api/cases/me'],
    }));
    app.setGlobalPrefix(PREFIX);
    const port = Number(process.env.PORT) || 3003;
    await app.listen(port);
    console.log((0, auth_middleware_1.banner)());
    console.log((0, access_control_1.banner)());
    console.log(`mis-case-service listening on http://localhost:${port}/${PREFIX}`);
}
bootstrap();
//# sourceMappingURL=main.js.map