# AGENT.md

## 1. Purpose

This file defines the mandatory engineering rules for a reusable **NestJS backend project**.

The backend may serve one or more clients, including:

- Web applications
- Mobile applications
- Admin applications
- Partner integrations
- Third-party API consumers

The backend is the single source of truth for:

- Business logic
- Authentication
- Authorization
- Validation
- Database access
- API contracts
- External service orchestration

All developers and coding agents must read and follow this file before modifying backend code.

---

# 2. Target Architecture

```text
              ┌─────────────────┐
              │   Web Client    │
              └────────┬────────┘
                       │ HTTPS
                       ▼
                ┌─────────────┐
                │  NestJS API │
                └──────┬──────┘
                       │
                       ▼
                   Controller
                       │
                       ▼
                 DTO / Validation
                       │
                       ▼
                     Guard
                       │
                       ▼
                    Service
                       │
                       ▼
                  Repository
                       │
                       ▼
                     ORM
                       │
                       ▼
                   Database

              ┌─────────────────┐
              │  Mobile Client  │
              └────────┬────────┘
                       │ HTTPS
                       └──────────────► NestJS API
```

All clients MUST use the same backend business rules unless product requirements genuinely differ.

Different clients do not justify duplicated backend logic.

Bad:

```text
createOrderForWeb()
createOrderForMobile()
```

Preferred:

```text
createOrder()
```

---

# 3. Default Technology Stack

Recommended baseline:

```text
Framework       NestJS
Language        TypeScript
API             REST
Validation      class-validator + class-transformer
ORM             Prisma or project-standard ORM
Database        Project-selected relational database
Auth            Passport + JWT / secure cookies where appropriate
Documentation   Swagger / OpenAPI
Testing         Jest + Supertest
Package Manager pnpm
Linting         ESLint
Formatting      Prettier
Container       Docker
```

Do not change database engines, authentication models, or API contracts merely because the framework changes.

Treat framework migration, database migration, and API redesign as separate concerns.

---

# 4. Spring Boot → NestJS Mapping

Use this mapping when migrating an existing Spring Boot backend.

```text
Spring Boot                     NestJS

@RestController        →        @Controller()
@RequestMapping        →        @Controller('path')
@GetMapping            →        @Get()
@PostMapping           →        @Post()
@PutMapping            →        @Put()
@PatchMapping          →        @Patch()
@DeleteMapping         →        @Delete()

@Service               →        @Injectable() Service
@Repository            →        @Injectable() Repository
@Component             →        @Injectable() Provider

@Configuration         →        @Module() / ConfigModule
@Bean                  →        Provider
@Autowired             →        Constructor Injection

JpaRepository          →        Repository + ORM client
@Entity                →        ORM model/schema

DTO + Bean Validation  →        DTO + class-validator
@ControllerAdvice      →        ExceptionFilter
Spring Security        →        Passport + Guards
Security Filter        →        Guard / Middleware
HandlerInterceptor     →        NestJS Interceptor
Servlet Filter         →        Middleware

application.yml        →        ConfigModule + .env
@Scheduled             →        @nestjs/schedule
Async jobs             →        BullMQ or project-standard queue
WebClient              →        HttpModule / fetch
@Transactional         →        ORM transaction
MockMvc                →        Supertest
```

Do not mechanically reproduce Java patterns when NestJS already provides a better native mechanism.

---

# 5. Canonical Project Structure

```text
backend/
│
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── common/
│   │   ├── decorators/
│   │   ├── guards/
│   │   ├── filters/
│   │   ├── interceptors/
│   │   ├── middleware/
│   │   ├── errors/
│   │   ├── constants/
│   │   ├── enums/
│   │   ├── types/
│   │   └── utils/
│   │
│   ├── config/
│   │   ├── configuration.ts
│   │   ├── env.validation.ts
│   │   └── config.module.ts
│   │
│   ├── database/
│   │   └── orm/
│   │       ├── database.module.ts
│   │       └── database.service.ts
│   │
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── <domain-a>/
│   │   ├── <domain-b>/
│   │   └── health/
│   │
│   └── integrations/
│       ├── storage/
│       ├── mail/
│       ├── cache/
│       ├── queue/
│       ├── payments/
│       ├── external-api/
│       └── observability/
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/
│   ├── architecture.md
│   ├── api-conventions.md
│   ├── security.md
│   ├── database.md
│   ├── testing.md
│   └── migration.md
│
├── .env
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── nest-cli.json
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── AGENT.md
```

Create folders only when actual code requires them.

Do not create empty architecture solely to match this template.

---

# 6. Module Organization

Use feature/domain-based organization.

Preferred:

```text
modules/
├── auth/
├── users/
├── orders/
├── payments/
├── notifications/
└── reports/
```

Avoid organizing the entire project into huge global technical folders such as:

```text
controllers/
services/
repositories/
dto/
```

with unrelated files from every domain.

Typical module:

```text
orders/
├── orders.module.ts
├── orders.controller.ts
├── orders.service.ts
├── orders.repository.ts
├── orders.mapper.ts
└── dto/
    ├── create-order.dto.ts
    ├── update-order.dto.ts
    └── order-response.dto.ts
```

---

# 7. Module Boundary Rules

Modules should communicate through exported providers.

Preferred:

```text
PaymentsService
     ↓
OrdersService
```

Avoid directly accessing another module's repository if that bypasses business rules.

Use `forwardRef()` only when a genuine circular dependency is unavoidable.

Do not use it as a default solution for poor module boundaries.

---

# 8. Controller Rules

Controllers are HTTP boundaries.

Controllers may:

- Define routes
- Read body, params, query and headers
- Apply DTOs
- Apply Guards
- Apply Pipes
- Apply decorators
- Call services
- Set HTTP status
- Return response DTOs

Controllers MUST NOT contain business logic.

Bad:

```ts
@Post()
async create(@Body() dto: CreateOrderDto) {
  const entity = await this.db.entity.findUnique(...);

  if (...) {
    throw new BadRequestException();
  }

  // calculate
  // update database
  // send notification
  // call payment provider
}
```

Good:

```ts
@Post()
async create(
  @CurrentUser() user: CurrentUser,
  @Body() dto: CreateOrderDto,
) {
  return this.ordersService.create(user, dto);
}
```

Controllers must remain thin.

---

# 9. Service Rules

Services own application and business logic.

Services may:

- Apply business rules
- Validate domain state
- Check ownership
- Check permissions
- Coordinate repositories
- Start transactions
- Call integration services
- Coordinate multiple domain services

Services MUST NOT depend directly on:

```text
Request
Response
Express Response
React
Next.js
Flutter
Client UI state
```

Use explicit typed inputs.

Preferred:

```ts
createOrder(
  currentUser: CurrentUser,
  input: CreateOrderInput,
)
```

Avoid:

```ts
createOrder(request: Request)
```

---

# 10. Repository Rules

Repositories own persistence logic.

Repositories may contain:

- ORM queries
- Query composition
- Persistence projections
- Database-specific lookup logic

Repositories MUST NOT contain:

- HTTP logic
- JWT logic
- UI logic
- Route-level authorization
- Domain workflow decisions

Repository abstraction is optional for trivial modules.

Allowed for simple cases:

```text
Controller
 ↓
Service
 ↓
ORM
```

Preferred for important or complex domains:

```text
Controller
 ↓
Service
 ↓
Repository
 ↓
ORM
```

---

# 11. Dependency Injection Rules

Use NestJS dependency injection.

Good:

```ts
constructor(
  private readonly ordersService: OrdersService,
) {}
```

Never manually instantiate application providers in controllers or services.

NestJS should own provider creation and lifecycle.

---

# 12. DTO Rules

All external request input must use DTOs or equivalent validated boundary models.

Example:

```ts
export class CreateOrderDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
```

Do not use ORM/database models as API input DTOs.

Do not accept arbitrary objects without validation.

---

# 13. Global Validation

Configure a global ValidationPipe.

Recommended:

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
```

Validate all untrusted input:

- Request bodies
- Route params
- Query params
- Headers when relevant
- Multipart metadata
- Webhooks
- External provider responses when required

TypeScript types do not perform runtime validation.

---

# 14. Param and Query Parsing

Use NestJS Pipes.

Example:

```ts
@Get(':id')
findOne(
  @Param('id', ParseIntPipe) id: number,
) {}
```

Use dedicated query DTOs for pagination, filtering and sorting.

---

# 15. DTO vs Database Model

Never expose database models automatically as API contracts.

Preferred:

```text
Database Model
     ↓
Mapper
     ↓
Response DTO
```

Prevent accidental exposure of:

- password hashes
- internal flags
- private metadata
- implementation-specific fields

---

# 16. Correct NestJS Request Lifecycle

Understand the request lifecycle correctly.

```text
Incoming Request
      ↓
Middleware
      ↓
Guards
      ↓
Interceptors (before)
      ↓
Pipes / Validation
      ↓
Controller
      ↓
Service
      ↓
Repository
      ↓
ORM
      ↓
Database
      ↓
Service
      ↓
Interceptors (after)
      ↓
HTTP Response
```

Uncaught exceptions flow to Exception Filters.

---

# 17. Middleware Rules

Use middleware for low-level HTTP concerns.

Good examples:

- Request ID
- Basic request metadata
- Context propagation

Do not use middleware as the primary authorization mechanism.

Use Guards for access control.

---

# 18. Guard Rules

Guards answer access questions such as:

- Is the user authenticated?
- Does this user role have route access?
- Is this API key valid?

Do not place large business workflows inside Guards.

Use Services for resource-level authorization.

---

# 19. Interceptor Rules

Interceptors may handle:

- Response transformation
- Timing
- Logging
- Metrics
- Timeouts
- Caching
- Serialization

Do not place core business logic inside Interceptors.

---

# 20. Exception Filter Rules

Use a global exception strategy.

Avoid repeated controller-level try/catch when errors can be normalized globally.

Preferred:

```text
Domain/Application Error
        ↓
Global Exception Filter
        ↓
Standard Error Response
```

Never expose:

- stack traces
- SQL errors
- ORM internals
- filesystem paths
- credentials
- infrastructure secrets

---

# 21. Standard Error Contract

Use a stable error format.

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found"
  }
}
```

Treat stable error codes as part of the public client contract.

---

# 22. Standard Success Contract

Single resource:

```json
{
  "success": true,
  "data": {}
}
```

List:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

All clients should consume the same API contract where practical.

---

# 23. API Prefix and Versioning

Use a global API prefix.

Example:

```ts
app.setGlobalPrefix('api');
```

Version public APIs.

Typical:

```text
/api/v1/auth/login
/api/v1/users
/api/v1/orders
```

Use `/api/v2` for intentional breaking changes.

Do not silently change existing client contracts.

---

# 24. REST Naming Rules

Use resource-oriented routes.

Good:

```text
GET    /api/v1/orders
GET    /api/v1/orders/:id
POST   /api/v1/orders
PATCH  /api/v1/orders/:id
DELETE /api/v1/orders/:id
```

Avoid:

```text
/getOrders
/createOrder
/updateOrder
/deleteOrder
```

Domain commands are acceptable when they represent real actions:

```text
/cancel
/approve
/verify
/refresh
/logout
```

---

# 25. HTTP Status Rules

Use meaningful HTTP status codes.

```text
200 OK
201 Created
204 No Content

400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests

500 Internal Server Error
503 Service Unavailable
```

Do not return HTTP 200 for every failure.

---

# 26. Authentication Rules

Use NestJS Passport integration and Guards where applicable.

Example:

```ts
@UseGuards(JwtAuthGuard)
@Get('me')
getMe(@CurrentUser() user: CurrentUser) {}
```

Do not manually parse JWTs in every controller.

Centralize authentication behavior.

---

# 27. Public Endpoint Rules

When using a global authentication guard, use a custom `@Public()` decorator for public routes.

Do not maintain random hardcoded public-route lists.

---

# 28. Authorization Rules

Authentication asks:

```text
Who are you?
```

Authorization asks:

```text
Can you perform this operation?
```

Use Guards for broad route-level access.

Use Services for resource-level authorization and ownership checks.

Never rely on frontend authorization.

---

# 29. Role Guards

Use explicit role or permission decorators/guards where appropriate.

Frontend route protection is UX only.

Backend access control is security.

---

# 30. Ownership Rules

Always validate ownership of user-owned resources.

Identity must come from authenticated context.

Never trust client-provided identity fields as proof of identity.

---

# 31. Multi-Client Authentication

Web and Mobile may use different credential transport.

Web may use:

```text
HttpOnly secure cookie
```

Mobile may use:

```text
Authorization: Bearer <access-token>
Refresh token
Secure device storage
```

Both should resolve to a common backend identity context.

Business services must not duplicate logic based solely on client type.

---

# 32. Cookie Security Rules

If browser authentication uses cookies:

- Cookies MUST be `HttpOnly`.
- Cookies MUST use `Secure` in production.
- `SameSite` MUST be explicitly configured.
- CSRF protection MUST be evaluated for state-changing requests.
- CORS origins MUST be explicit.
- `credentials: true` MUST only be enabled for trusted origins.
- Sensitive cookie values MUST never be logged.

Do not use wildcard CORS with credentialed browser auth.

---

# 33. Bearer Token Rules

If clients use Bearer tokens:

- Never put tokens in URLs.
- Never log tokens.
- Store refresh tokens securely.
- Reject expired tokens.
- Define rotation/revocation strategy when required.

---

# 34. Password Security

Never:

- Store plaintext passwords
- Log passwords
- Return password hashes
- Implement custom password cryptography

Use a trusted password hashing algorithm such as:

```text
argon2
```

or:

```text
bcrypt
```

---

# 35. CORS Rules

Configure explicit trusted origins for browser clients.

Do not blindly use:

```ts
origin: '*'
```

for authenticated production APIs.

---

# 36. CSRF Rules

Cookie-authenticated browser endpoints must evaluate CSRF protection.

Bearer-token native mobile clients have a different threat model.

Do not treat both authentication mechanisms as identical.

---

# 37. Security Headers

Use production security headers.

Recommended baseline:

```text
helmet
```

Do not disable protections without a documented reason.

---

# 38. Environment Configuration

Use:

```text
@nestjs/config
```

Centralize configuration.

Avoid scattered direct access to `process.env.*`.

Validate required environment variables at startup.

Fail fast when required configuration is missing.

---

# 39. Environment Validation

Validate configuration such as:

```text
DATABASE_URL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
CACHE_URL
QUEUE_URL
STORAGE_ENDPOINT
STORAGE_ACCESS_KEY
STORAGE_SECRET_KEY
MAIL_PROVIDER_KEY
PAYMENT_PROVIDER_KEY
```

Only require configuration for enabled features.

---

# 40. Secrets Rules

Never commit:

```text
.env
JWT secrets
database passwords
storage credentials
payment secrets
provider tokens
private keys
```

Maintain:

```text
.env.example
```

with safe placeholders only.

---

# 41. ORM Architecture

Expose the ORM through NestJS providers.

For Prisma:

```text
PrismaModule
    ↓
PrismaService
```

Do not instantiate ORM clients repeatedly across modules.

---

# 42. Existing Database Migration Rules

When migrating an existing backend, treat the current production database as the source of truth.

Recommended approach:

```text
Existing production schema
        ↓
Safe database copy
        ↓
ORM introspection
        ↓
Review generated schema
        ↓
Validate relations / indexes / defaults
        ↓
Baseline migration history
        ↓
Generate client
        ↓
NestJS uses existing data
```

Mandatory rules:

1. Introspect a safe copy first.
2. Never reset production/shared databases.
3. Do not use development synchronization commands as production migration strategy.
4. Review inferred relations.
5. Review unique constraints.
6. Review indexes.
7. Review enums.
8. Review defaults.
9. Review nullable columns.
10. Review mapped table/column names.
11. Baseline existing schema before new migrations.
12. Only new schema changes after baseline should generate new migrations.

---

# 43. Framework Migration Safety

Framework migration must preserve:

- Existing production data
- Table semantics
- Existing public API unless intentionally changed
- Authentication rules
- Authorization rules
- Error codes
- External integration behavior
- Business workflow behavior

Do not redesign the whole system during framework migration unless explicitly requested.

---

# 44. Database Schema Change Rules

Every schema change must have migration history.

Never manually modify production schema without a tracked migration.

Do not drop or rename production structures merely for aesthetic reasons.

Data safety has priority over schema aesthetics.

---

# 45. Transaction Rules

Use transactions when multiple operations must succeed or fail together.

Examples:

```text
Create order
+
Create order items
+
Update inventory
```

```text
Create account
+
Create profile
+
Assign default role
```

Use ORM transaction mechanisms appropriately.

---

# 46. Concurrency and Race Conditions

Transactions alone do not solve every concurrency issue.

Critical invariants should also use:

- Unique constraints
- Optimistic concurrency control
- Version fields
- Idempotency keys
- Appropriate isolation level

Evaluate concurrency explicitly for critical read-modify-write workflows.

---

# 47. Idempotency Rules

Consider idempotency for duplicate-sensitive commands.

Examples:

- Order creation
- Payment operations
- Subscription changes
- Webhook processing
- Retryable asynchronous jobs

Repeated requests must not silently create duplicate critical records.

---

# 48. External Integration Architecture

External infrastructure belongs in dedicated modules/providers.

Examples:

```text
storage
mail
payments
cache
queue
external APIs
```

Do not call provider SDKs directly from controllers.

Preferred:

```text
DomainService
    ↓
Provider abstraction
    ↓
Concrete integration
```

---

# 49. Provider Abstractions

Use interfaces/tokens when abstraction provides real value.

Examples:

```text
ObjectStorage
MailProvider
PaymentGateway
NotificationProvider
ExternalApiClient
```

Avoid unnecessary interfaces for code that has no meaningful abstraction boundary.

---

# 50. External HTTP Calls

All external HTTP calls should define:

- Timeout
- Error handling
- Logging
- Retry strategy when safe
- Circuit-breaking/degradation strategy where needed

Do not allow third-party providers to hang requests indefinitely.

---

# 51. Retry Rules

Retry only operations that are safe to retry.

Do not blindly retry non-idempotent operations.

If retrying non-idempotent commands, design explicit idempotency protection.

---

# 52. Object Storage Rules

If the project uses object storage:

- Keep buckets/containers private by default.
- Use controlled/presigned access when appropriate.
- Never expose storage credentials to clients.
- Keep object-key conventions stable.
- Validate ownership before generating private download links.
- Avoid hardcoding storage URLs into client code.

---

# 53. File Upload Rules

Backend must validate uploads even when clients validate them.

Validate:

- MIME type
- Extension
- File size
- File count
- File signature where appropriate
- Ownership / authenticated actor

Never trust original filenames as server file paths.

---

# 54. Background Job Rules

Use a queue such as BullMQ only when work is genuinely:

- Long-running
- Retryable
- Expensive
- Suitable for asynchronous execution

Examples:

- Email batches
- Report generation
- Media processing
- Notification fanout
- Large imports/exports

Do not introduce queues without a concrete need.

---

# 55. Webhook Rules

Webhook endpoints must verify provider authenticity.

Examples:

- Signature headers
- Shared secrets
- Provider-issued verification tokens

When providers require exact raw request bytes, configure raw-body handling correctly.

Webhook processing should be idempotent where duplicate delivery is possible.

---

# 56. Request Size Limits

Set explicit size limits for:

- JSON bodies
- Multipart uploads
- Webhook bodies
- Large text payloads

Do not allow unbounded request bodies.

---

# 57. Rate Limiting

Apply server-side rate limiting to sensitive or expensive endpoints.

Examples:

```text
/auth/login
/auth/register
/auth/refresh
/password-reset
/uploads
/search
/provider callbacks
```

Do not rely on frontend throttling.

---

# 58. Pagination

Potentially large collections must support bounded pagination.

Example:

```text
?page=1&limit=20
```

Always enforce a maximum limit.

---

# 59. Filtering and Sorting

Validate all filtering and sorting fields.

Use allowlists for sortable/filterable fields.

Do not directly interpolate user-controlled fields into raw SQL.

---

# 60. Database Query Rules

Avoid:

- N+1 queries
- Unbounded queries
- Loading unnecessary columns
- Duplicate queries
- Large object graphs without need

Fetch only fields required by the use case.

---

# 61. Async Rules

Avoid unnecessary sequential awaits.

Use `Promise.all` for independent operations.

Do not parallelize operations that depend on each other.

---

# 62. Logging Rules

Use structured logging.

Useful fields:

```text
requestId
route
method
statusCode
duration
errorCode
```

Never log:

- Passwords
- Access tokens
- Refresh tokens
- Provider secrets
- Private keys
- Sensitive payloads by default

---

# 63. Request IDs and Context

Every request should have a correlation/request ID.

Propagate request context throughout the request lifecycle.

`AsyncLocalStorage` may be used where appropriate.

---

# 64. Observability

Production observability should cover:

```text
Logs
Metrics
Traces
```

Useful generic metrics may include:

```text
request.duration
request.error_rate
db.query.duration
queue.depth
queue.failure
external_api.failure
cache.hit_rate
```

Do not collect sensitive payloads unnecessarily.

---

# 65. Health Checks

Expose separate liveness and readiness endpoints.

Recommended:

```text
GET /health/live
GET /health/ready
```

Liveness asks:

```text
Is the process alive?
```

Readiness asks:

```text
Can this instance safely receive traffic?
```

Readiness may check critical dependencies such as:

- Database
- Cache
- Queue
- Critical storage
- Required external service

Optional integrations should not necessarily make the entire application unready.

Use `@nestjs/terminus` where appropriate.

---

# 66. Graceful Shutdown

Enable graceful shutdown.

Example:

```ts
app.enableShutdownHooks();
```

Clean up resources such as:

- Database connections
- Queue consumers
- Cache connections
- Background workers
- Long-lived clients

---

# 67. Production Bootstrap Baseline

`main.ts` should normally configure:

```text
Config validation
Global prefix
Versioning
Helmet
CORS
ValidationPipe
Global exception filter
Interceptors
Swagger
Graceful shutdown
Request size limits
```

Concept:

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  app.setGlobalPrefix('api');

  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // versioning
  // filters
  // interceptors
  // swagger
  // request limits

  await app.listen(port);
}
```

Exact configuration depends on project requirements.

---

# 68. Swagger / OpenAPI Rules

Use:

```text
@nestjs/swagger
```

Document:

- Request DTOs
- Response DTOs
- Authentication
- Error responses
- Enums
- Pagination
- File uploads

Treat OpenAPI as a client contract.

---

# 69. Mobile Client Contract Rule

Mobile clients MUST NOT depend on backend ORM models, repositories, or internal service types.

Preferred:

```text
NestJS
  ↓
OpenAPI
  ↓
Generated client
  ↓
Mobile App
```

Use code generation when it materially reduces duplicated contract code.

---

# 70. Web Client Contract Rule

A separately deployed Web frontend should communicate with NestJS through HTTP.

Correct:

```text
Web Frontend
    ↓ HTTP
NestJS API
```

Do not allow frontend projects to import backend repositories or ORM clients.

---

# 71. Client Independence

Backend business behavior should not branch on client type without a real product requirement.

Avoid:

```ts
if (client === 'web') {
  ...
}

if (client === 'mobile') {
  ...
}
```

Presentation differences belong in clients.

Business invariants belong in the backend.

---

# 72. API Compatibility

Do not casually:

- Rename public fields
- Remove fields
- Change field types
- Change optional/required status
- Rename stable error codes
- Change enum semantics

Prefer additive changes.

Use a new API version for intentional breaking changes.

---

# 73. Testing Structure

```text
test/
├── unit/
├── integration/
└── e2e/
```

Unit tests:

- Services
- Mappers
- Permission logic
- Validation helpers

Integration tests:

- Repositories
- Database
- External adapters

E2E tests:

```text
HTTP
 ↓
Controller
 ↓
Service
 ↓
Repository
 ↓
Database
```

---

# 74. Unit Test Rules

Mock dependencies at module boundaries.

Do not start the whole application/database for every unit test.

Keep unit tests fast and isolated.

---

# 75. Critical E2E Coverage

At minimum test critical flows such as:

- Authentication
- Authorization
- Ownership
- Main CRUD workflows
- File upload if used
- Payment flow if used
- Background jobs if critical
- Error paths
- Validation failures

---

# 76. Security Regression Tests

At minimum test:

```text
anonymous access blocked where required
insufficient role rejected
resource ownership enforced
invalid token rejected
expired token rejected
invalid payload rejected
oversized upload rejected
duplicate critical operation prevented
```

---

# 77. Framework Migration Contract Tests

For each migrated endpoint compare:

- HTTP method
- URL
- Request body
- Query parameters
- Validation behavior
- Status code
- Response fields
- Error codes
- Authentication
- Authorization
- Database side effects

Migration is complete only when behavior matches or an intentional contract change is approved.

---

# 78. Recommended Migration Order

For migration from an existing backend:

```text
1. Freeze current API contract
2. Freeze existing DB schema
3. Create NestJS skeleton
4. Connect ORM to existing DB
5. Baseline migration history
6. Migrate authentication/security
7. Migrate simple modules
8. Migrate critical business modules
9. Migrate external integrations
10. Add observability and health checks
11. Run contract/E2E comparisons
12. Switch clients gradually
13. Retire old backend
```

Prefer incremental migration when practical.

---

# 79. TypeScript Rules

Enable strict TypeScript.

Avoid:

```ts
any
```

Prefer:

```ts
unknown
```

for untrusted values, then narrow safely.

Do not silence compiler errors with:

```ts
as any
@ts-ignore
```

without a documented technical reason.

---

# 80. Naming Conventions

Files:

```text
orders.module.ts
orders.controller.ts
orders.service.ts
orders.repository.ts

create-order.dto.ts
update-order.dto.ts
order-response.dto.ts
```

Classes:

```text
OrdersModule
OrdersController
OrdersService
OrdersRepository
CreateOrderDto
```

Use meaningful function names.

Good:

```text
findUserByEmail
createOrder
verifyPassword
cancelSubscription
```

Bad:

```text
processData
doStuff
handleThing
```

---

# 81. Common Folder Rules

`common/` is only for cross-cutting reusable code.

Good:

```text
guards
decorators
filters
interceptors
generic errors
shared infrastructure types
```

Do not place domain-specific business logic inside `common/`.

---

# 82. Utility Rules

Avoid giant files such as:

```text
utils.ts
helpers.ts
common.service.ts
```

with unrelated logic.

Prefer focused utilities.

---

# 83. Avoid Fat Services

If a service grows too large, split by real responsibility.

Example:

```text
OrdersService
OrderPricingService
OrderFulfillmentService
```

Do not split prematurely.

---

# 84. Avoid Premature DDD

Do not automatically create:

```text
domain/
application/
infrastructure/
presentation/
use-cases/
ports/
adapters/
aggregates/
value-objects/
```

for simple CRUD modules.

Use deeper DDD/Clean Architecture only when domain complexity justifies it.

---

# 85. No Giant Shared Module

Avoid one giant `SharedModule` containing unrelated providers.

Prefer focused modules:

```text
DatabaseModule
StorageModule
MailModule
CacheModule
QueueModule
```

---

# 86. Dependency Rules

Before adding a dependency:

1. Check if NestJS/platform already supports it.
2. Check package maintenance.
3. Check security history.
4. Check whether an existing dependency already solves the problem.
5. Avoid multiple libraries for the same responsibility.

Do not add packages for trivial helper functions.

---

# 87. Dead Code Rules

Delete:

- Unused functions
- Unused imports
- Obsolete files
- Commented-out old implementations
- Dead feature flags

Git preserves history.

---

# 88. Comment Rules

Comments should explain:

```text
WHY
```

not obvious:

```text
WHAT
```

Remove stale comments when behavior changes.

---

# 89. TODO Rules

Avoid vague TODOs.

Bad:

```ts
// TODO fix
```

Better:

```ts
// TODO: replace in-memory rate limiter with distributed storage
// before multi-instance deployment.
```

---

# 90. CI Rules

Every pull request should run:

```text
install
 ↓
lint
 ↓
typecheck
 ↓
unit tests
 ↓
integration tests
 ↓
e2e tests where relevant
 ↓
build
```

Typical:

```bash
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

If ORM schema changed, validate and regenerate client.

---

# 91. Deployment Rules

Recommended production deployment sequence:

```text
Build artifact
     ↓
Run database migration
     ↓
Start new instance
     ↓
Readiness becomes healthy
     ↓
Route traffic
     ↓
Gracefully stop old instance
```

Do not route traffic before readiness passes.

Do not run destructive development migration commands during normal startup.

---

# 92. Health-Aware Deployment

Process started does not mean application ready.

Use:

- Liveness for process health/restart decisions.
- Readiness for traffic-routing decisions.

Deployment automation should wait for readiness.

---

# 93. Agent Workflow Rules

Before changing code, an AI coding agent must:

1. Read this file.
2. Identify the owning NestJS module.
3. Inspect the Controller.
4. Inspect DTOs.
5. Inspect Service.
6. Inspect Repository.
7. Inspect ORM schema.
8. Inspect authentication/authorization.
9. Inspect external integrations.
10. Inspect existing tests.
11. Search for reusable existing functionality.
12. Preserve public API behavior unless explicitly instructed otherwise.

---

# 94. Agent Placement Decision

When creating code:

```text
HTTP endpoint?
→ *.controller.ts

Input validation?
→ dto/

Business rule?
→ *.service.ts

Database query?
→ *.repository.ts

Database client?
→ database/orm/

Authentication?
→ modules/auth/

Authorization guard/decorator?
→ common/guards or common/decorators

External provider?
→ integrations/<provider>/

Cross-cutting HTTP behavior?
→ common/

Configuration?
→ config/

Health/readiness?
→ modules/health/
```

---

# 95. Agent Must Not

Agents MUST NOT:

- Put business logic in Controllers
- Scatter ORM queries everywhere without reason
- Duplicate Web/Mobile business logic
- Disable Guards
- Trust client identity fields
- Bypass ownership checks
- Hardcode secrets
- Add `any` to silence errors
- Delete migrations casually
- Run destructive migration commands against production/shared DB
- Rename public API fields casually
- Expose password hashes
- Expose provider credentials
- Put provider SDK logic inside Controllers
- Treat frontend validation as backend security
- Disable failing tests
- Rewrite unrelated modules
- Add dependencies without need
- Use wildcard credentialed CORS
- Log tokens, passwords or secrets
- Break client compatibility without versioning

---

# 96. Definition of Done

A backend change is complete only when:

- Correct module owns the code
- Controller remains thin
- DTO validation exists
- Service owns business logic
- Persistence is isolated appropriately
- Authentication exists where required
- Authorization exists where required
- Ownership is checked where required
- Concurrency invariants are considered
- Errors follow standard API contract
- OpenAPI is updated
- Database migration exists if schema changed
- Existing data remains safe
- Tests are updated
- TypeScript passes
- Lint passes
- Tests pass
- Build passes
- No secrets are exposed
- Clients remain compatible
- Health/readiness remains valid
- Observability is sufficient for production troubleshooting

---

# 97. Golden NestJS Rules

```text
1. Organize by domain.

2. Keep Controllers thin.

3. Validate external input with DTOs/Pipes.

4. Use Guards for route access.

5. Put business logic in Services.

6. Keep persistence logic isolated when useful.

7. Keep ORM/database access server-only.

8. Normalize errors with Exception Filters.

9. Use Interceptors for cross-cutting request/response concerns.

10. Never trust client input.

11. Never trust client-provided identity.

12. Share one backend business implementation across clients.

13. NestJS is the backend authority.

14. Clients communicate through versioned APIs.

15. Isolate external providers.

16. Preserve API contracts during migrations.

17. Preserve database semantics during migrations.

18. Use OpenAPI as the public contract.

19. Protect cookie auth with CSRF/CORS/cookie policy.

20. Use DB constraints for critical invariants.

21. Design idempotency where duplicate requests are dangerous.

22. Support graceful shutdown.

23. Separate liveness from readiness.

24. Maintain logs, metrics and traces.

25. Keep production secrets out of source control.

26. Use migrations for schema changes.

27. Prefer simple NestJS architecture before heavy DDD.

28. Do not over-engineer.
```

---

# 98. Final Architecture Summary

```text
              ┌────────────────────┐
              │    Web Client      │
              └─────────┬──────────┘
                        │
                      HTTPS
                        │
                        ▼
            ┌──────────────────────────┐
            │       NestJS API         │
            │                          │
            │ Middleware               │
            │     ↓                    │
            │ Guards                   │
            │     ↓                    │
            │ Interceptors (pre)       │
            │     ↓                    │
            │ DTO / Pipes              │
            │     ↓                    │
            │ Controller               │
            │     ↓                    │
            │ Service                  │
            │     ↓                    │
            │ Repository               │
            │     ↓                    │
            │ ORM                      │
            └───────────┬──────────────┘
                        │
                        ▼
                     Database
                        ▲
                        │
            ┌───────────┴───────────┐
            │                       │
       Integrations               HTTPS
      ┌───┬───┬───┐                 │
      │   │   │   │                 ▼
   Mail Pay Cache Queue      ┌───────────────┐
                             │ Mobile Client │
                             └───────────────┘
```

One backend.

One business logic implementation.

One authorization model.

One database source of truth.

One versioned API contract.

All new backend code must preserve these boundaries unless there is a documented technical reason to deviate.
