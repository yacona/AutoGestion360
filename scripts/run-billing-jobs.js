/**
 * Ejecuta jobs operativos de billing SaaS.
 *
 * Por seguridad corre en dry-run por defecto.
 *
 * Uso:
 *   npm run billing:jobs
 *   BILLING_JOBS_DRY_RUN=false npm run billing:jobs
 *   BILLING_JOBS_DAYS_AHEAD=15 BILLING_JOBS_GRACE_DAYS=5 npm run billing:jobs
 */
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const billingJobs = require('../src/modules/billing/billing.jobs');

const DEFAULT_LOCK_FILE = path.join(__dirname, '..', 'tmp', 'billing-jobs.lock');

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function acquireLock(lockFile) {
  ensureDir(lockFile);

  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(fd, JSON.stringify({
      pid: process.pid,
      started_at: new Date().toISOString(),
    }, null, 2));
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

function releaseLock(lockFile) {
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  } catch (error) {
    console.warn(`[billing-jobs] No se pudo liberar lock ${lockFile}:`, error.message);
  }
}

function writeOptionalLog(payload) {
  const logFile = process.env.BILLING_JOBS_LOG_FILE;
  if (!logFile) return;

  ensureDir(logFile);
  fs.appendFileSync(logFile, `${JSON.stringify({
    logged_at: new Date().toISOString(),
    ...payload,
  })}\n`);
}

async function main() {
  const lockFile = process.env.BILLING_JOBS_LOCK_FILE || DEFAULT_LOCK_FILE;
  const locked = acquireLock(lockFile);
  if (!locked) {
    const skipped = {
      status: 'SKIPPED',
      reason: 'Ya existe una ejecucion de billing jobs en curso.',
      lock_file: lockFile,
    };
    writeOptionalLog(skipped);
    console.log(JSON.stringify(skipped, null, 2));
    return;
  }

  try {
    const result = await billingJobs.runBillingJobs({
      dry_run: process.env.BILLING_JOBS_DRY_RUN !== 'false',
      days_ahead: process.env.BILLING_JOBS_DAYS_AHEAD || 7,
      grace_days: process.env.BILLING_JOBS_GRACE_DAYS || 3,
      invoice_due_days: process.env.BILLING_JOBS_INVOICE_DUE_DAYS || 7,
      limit: process.env.BILLING_JOBS_LIMIT || 100,
    }, null);

    writeOptionalLog({ status: 'OK', result });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    releaseLock(lockFile);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(JSON.stringify({
    status: 'FAILED',
    message: error.message,
    details: error.details || null,
  }, null, 2));
  process.exit(1);
});
