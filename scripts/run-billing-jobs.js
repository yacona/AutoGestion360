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

const billingJobs = require('../src/modules/billing/billing.jobs');

async function main() {
  const result = await billingJobs.runBillingJobs({
    dry_run: process.env.BILLING_JOBS_DRY_RUN !== 'false',
    days_ahead: process.env.BILLING_JOBS_DAYS_AHEAD || 7,
    grace_days: process.env.BILLING_JOBS_GRACE_DAYS || 3,
    invoice_due_days: process.env.BILLING_JOBS_INVOICE_DUE_DAYS || 7,
    limit: process.env.BILLING_JOBS_LIMIT || 100,
  }, null);

  console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(JSON.stringify({
    status: 'FAILED',
    message: error.message,
    details: error.details || null,
  }, null, 2));
  process.exit(1);
});
