'use strict';

const express = require('express');

const ctrl = require('./billing.controller');
const validate = require('../../middlewares/validate');
const { billingWebhookLimiter } = require('../../lib/security/rate-limit');
const { providerParamSchema } = require('../../lib/validation/billing.schemas');

const router = express.Router();

router.post(
  '/webhooks/:provider',
  billingWebhookLimiter,
  validate({ params: providerParamSchema }),
  ctrl.recibirWebhook
);

module.exports = router;
