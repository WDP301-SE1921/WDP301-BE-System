// Uses connection-local TEMPORARY tables, leaving persistent project data untouched.
const mysql = require('mysql2/promise');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  const db = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    multipleStatements: true,
    connectTimeout: 5000,
  });
  try {
    await db.query(`
      CREATE TEMPORARY TABLE outcome_sets (
        id VARCHAR(191) PRIMARY KEY, status ENUM('DRAFT','TECHNICALLY_APPROVED','APPROVED') NOT NULL DEFAULT 'DRAFT',
        reviewerId VARCHAR(191) NULL, reviewedAt DATETIME(3) NULL, approvedById VARCHAR(191) NULL,
        approvedAt DATETIME(3) NULL, reviewNote TEXT NULL
      );
      CREATE TEMPORARY TABLE learning_outcomes (id VARCHAR(191) PRIMARY KEY, outcomeSetId VARCHAR(191), sourceStatus VARCHAR(32), verifiedById VARCHAR(191));
      CREATE TEMPORARY TABLE lesson_outcomes (lessonId VARCHAR(191), outcomeId VARCHAR(191));
      INSERT INTO outcome_sets (id,status,reviewerId,reviewedAt,approvedById) VALUES
        ('draft','DRAFT',NULL,NULL,NULL),
        ('old-approved','APPROVED','teacher','2026-11-01','manager'),
        ('valid','TECHNICALLY_APPROVED','teacher','2026-11-01',NULL),
        ('no-reviewer','TECHNICALLY_APPROVED',NULL,'2026-11-01',NULL),
        ('unverified','TECHNICALLY_APPROVED','teacher','2026-11-01',NULL),
        ('unlinked','TECHNICALLY_APPROVED','teacher','2026-11-01',NULL),
        ('empty','TECHNICALLY_APPROVED','teacher','2026-11-01',NULL),
        ('other-reviewer','TECHNICALLY_APPROVED','teacher','2026-11-01',NULL);
      INSERT INTO learning_outcomes VALUES
        ('valid-clo','valid','VERIFIED','teacher'),
        ('unverified-clo','unverified','CANDIDATE','teacher'),
        ('unlinked-clo','unlinked','VERIFIED','teacher'),
        ('other-clo','other-reviewer','VERIFIED','other');
      INSERT INTO lesson_outcomes VALUES ('lesson','valid-clo'),('lesson','unverified-clo'),('lesson','other-clo');
    `);
    const sql = readFileSync(
      path.resolve(
        __dirname,
        '../../prisma/migrations/20261110000000_teacher_final_clo_approval/migration.sql',
      ),
      'utf8',
    );
    await db.query(sql);
    const [rows] = await db.query('SELECT * FROM outcome_sets ORDER BY id');
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    assert.equal(byId.valid.status, 'APPROVED');
    assert.equal(byId.valid.approvedById, 'teacher');
    assert.equal(byId.valid.approvedAt.getTime(), byId.valid.reviewedAt.getTime());
    assert.equal(byId['old-approved'].approvedById, 'manager');
    assert.equal(byId['old-approved'].status, 'APPROVED');
    assert.equal(byId.draft.status, 'DRAFT');
    for (const id of ['no-reviewer', 'unverified', 'unlinked', 'empty', 'other-reviewer']) {
      assert.equal(byId[id].status, 'DRAFT');
      assert.equal(byId[id].reviewerId, null);
      assert.match(byId[id].reviewNote, /xác minh lại CLO/);
    }
    const [columns] = await db.query("SHOW COLUMNS FROM outcome_sets LIKE 'status'");
    assert.equal(columns[0].Type, "enum('DRAFT','APPROVED')");
    console.log(
      'CLO approval migration: 8 legacy-state fixtures passed on MySQL temporary tables.',
    );
  } finally {
    await db.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
