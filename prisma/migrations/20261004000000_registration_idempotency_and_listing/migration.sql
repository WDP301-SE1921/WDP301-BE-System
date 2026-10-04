ALTER TABLE `registration_orders`
  ADD COLUMN `createIdempotencyKey` VARCHAR(191) NULL,
  ADD COLUMN `createRequestHash` CHAR(64) NULL,
  ADD UNIQUE INDEX `registration_orders_createdByManagerId_createIdempotencyKey_key` (`createdByManagerId`, `createIdempotencyKey`),
  ADD INDEX `registration_orders_status_createdAt_idx` (`status`, `createdAt`);

ALTER TABLE `payments`
  ADD INDEX `payments_confirmedAt_idx` (`confirmedAt`);

ALTER TABLE `idempotency_records`
  ADD COLUMN `actorUserId` VARCHAR(191) NULL,
  ADD COLUMN `requestHash` CHAR(64) NULL;
