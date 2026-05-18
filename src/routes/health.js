'use strict';
const express = require('express');
const { get } = require('../db/connection');
const config = require('../config');
const pkg = require('../../package.json');

const router = express.Router();

router.get('/', async (req, res) => {
  const started = Date.now();
  try {
    await get('SELECT 1 AS ok');
    res.json({
      status: 'ok',
      service: pkg.name,
      version: pkg.version,
      environment: config.env,
      database: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      responseMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      service: pkg.name,
      version: pkg.version,
      environment: config.env,
      database: 'error',
      responseMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
