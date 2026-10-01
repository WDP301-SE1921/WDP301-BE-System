CREATE TYPE "UserRole" AS ENUM ('MANAGER', 'TEACHER', 'PARENT');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "RegistrationType" AS ENUM ('FIRST_CHILD', 'NEW_CHILD', 'EXISTING_STUDENT_NEW_SUBJECT');
CREATE TYPE "RegistrationStatus" AS ENUM ('DRAFT', 'PAYMENT_CONFIRMED', 'LINKED', 'CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('CONFIRMED');
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING_LINK', 'ACTIVE', 'ENDED');
CREATE TYPE "InvitationStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "displayName" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "parent_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parent_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "student_profiles" (
    "id" TEXT NOT NULL,
    "parentProfileId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "dateOfBirth" DATE,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "student_profiles_grade_check" CHECK ("grade" BETWEEN 6 AND 9)
);

CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "programs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "programs_grade_check" CHECK ("grade" BETWEEN 6 AND 9)
);

CREATE TABLE "classes" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "monthlyFee" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "classes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classes_capacity_check" CHECK ("capacity" > 0),
    CONSTRAINT "classes_monthly_fee_check" CHECK ("monthlyFee" >= 0)
);

CREATE TABLE "registration_orders" (
    "id" TEXT NOT NULL,
    "type" "RegistrationType" NOT NULL,
    "parentEmail" TEXT NOT NULL,
    "parentPhone" TEXT,
    "studentFullName" TEXT NOT NULL,
    "studentGrade" INTEGER NOT NULL,
    "targetStudentId" TEXT,
    "classId" TEXT NOT NULL,
    "packageMonths" INTEGER NOT NULL,
    "quotedAmount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "status" "RegistrationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByManagerId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "registration_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "registration_orders_grade_check" CHECK ("studentGrade" BETWEEN 6 AND 9),
    CONSTRAINT "registration_orders_package_months_check" CHECK ("packageMonths" BETWEEN 1 AND 12),
    CONSTRAINT "registration_orders_amount_check" CHECK ("quotedAmount" >= 0)
);

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "registrationOrderId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "confirmedByManagerId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiptNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_amount_check" CHECK ("amount" >= 0)
);

CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "registrationOrderId" TEXT NOT NULL,
    "studentProfileId" TEXT,
    "classId" TEXT NOT NULL,
    "packageMonths" INTEGER NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'PENDING_LINK',
    "startDate" DATE,
    "endDate" DATE,
    "activatedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "enrollments_package_months_check" CHECK ("packageMonths" BETWEEN 1 AND 12),
    CONSTRAINT "enrollments_dates_check" CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate")
);

CREATE TABLE "link_invitations" (
    "id" TEXT NOT NULL,
    "registrationOrderId" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expectedParentEmail" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "link_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_events_attempt_count_check" CHECK ("attemptCount" >= 0)
);

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "registrationOrderId" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "parent_profiles_userId_key" ON "parent_profiles"("userId");
CREATE INDEX "student_profiles_parentProfileId_idx" ON "student_profiles"("parentProfileId");
CREATE INDEX "programs_subject_grade_idx" ON "programs"("subject", "grade");
CREATE INDEX "classes_programId_isOpen_idx" ON "classes"("programId", "isOpen");
CREATE INDEX "registration_orders_parentEmail_idx" ON "registration_orders"("parentEmail");
CREATE INDEX "registration_orders_classId_status_idx" ON "registration_orders"("classId", "status");
CREATE INDEX "registration_orders_targetStudentId_idx" ON "registration_orders"("targetStudentId");
CREATE UNIQUE INDEX "payments_registrationOrderId_key" ON "payments"("registrationOrderId");
CREATE UNIQUE INDEX "payments_receiptNumber_key" ON "payments"("receiptNumber");
CREATE INDEX "payments_confirmedByManagerId_idx" ON "payments"("confirmedByManagerId");
CREATE UNIQUE INDEX "enrollments_registrationOrderId_key" ON "enrollments"("registrationOrderId");
CREATE INDEX "enrollments_classId_status_idx" ON "enrollments"("classId", "status");
CREATE INDEX "enrollments_studentProfileId_status_idx" ON "enrollments"("studentProfileId", "status");
CREATE UNIQUE INDEX "link_invitations_tokenHash_key" ON "link_invitations"("tokenHash");
CREATE UNIQUE INDEX "link_invitations_one_active_per_order_key" ON "link_invitations"("registrationOrderId") WHERE "status" = 'ACTIVE';
CREATE INDEX "link_invitations_registrationOrderId_status_idx" ON "link_invitations"("registrationOrderId", "status");
CREATE INDEX "link_invitations_expectedParentEmail_idx" ON "link_invitations"("expectedParentEmail");
CREATE INDEX "outbox_events_status_nextAttemptAt_idx" ON "outbox_events"("status", "nextAttemptAt");
CREATE INDEX "outbox_events_aggregateId_idx" ON "outbox_events"("aggregateId");
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX "idempotency_records_registrationOrderId_idx" ON "idempotency_records"("registrationOrderId");
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

ALTER TABLE "parent_profiles" ADD CONSTRAINT "parent_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_parentProfileId_fkey" FOREIGN KEY ("parentProfileId") REFERENCES "parent_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "classes" ADD CONSTRAINT "classes_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registration_orders" ADD CONSTRAINT "registration_orders_targetStudentId_fkey" FOREIGN KEY ("targetStudentId") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registration_orders" ADD CONSTRAINT "registration_orders_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registration_orders" ADD CONSTRAINT "registration_orders_createdByManagerId_fkey" FOREIGN KEY ("createdByManagerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_registrationOrderId_fkey" FOREIGN KEY ("registrationOrderId") REFERENCES "registration_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmedByManagerId_fkey" FOREIGN KEY ("confirmedByManagerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_registrationOrderId_fkey" FOREIGN KEY ("registrationOrderId") REFERENCES "registration_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "link_invitations" ADD CONSTRAINT "link_invitations_registrationOrderId_fkey" FOREIGN KEY ("registrationOrderId") REFERENCES "registration_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "link_invitations" ADD CONSTRAINT "link_invitations_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_aggregateId_fkey" FOREIGN KEY ("aggregateId") REFERENCES "registration_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_registrationOrderId_fkey" FOREIGN KEY ("registrationOrderId") REFERENCES "registration_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
