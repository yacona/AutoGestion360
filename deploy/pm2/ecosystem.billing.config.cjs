module.exports = {
  apps: [
    {
      name: 'autogestion360-billing-jobs',
      script: 'scripts/run-billing-jobs.js',
      cwd: __dirname + '/../..',
      autorestart: false,
      cron_restart: '0 2 * * *',
      env: {
        NODE_ENV: 'production',
        BILLING_JOBS_DRY_RUN: 'false',
        BILLING_JOBS_DAYS_AHEAD: '7',
        BILLING_JOBS_GRACE_DAYS: '3',
        BILLING_JOBS_INVOICE_DUE_DAYS: '7',
        BILLING_JOBS_LIMIT: '100',
        BILLING_JOBS_LOCK_FILE: 'tmp/billing-jobs.lock',
        BILLING_JOBS_LOG_FILE: 'logs/billing-jobs.jsonl',
      },
    },
  ],
};
