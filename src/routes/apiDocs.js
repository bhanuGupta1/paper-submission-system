'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');

const router = express.Router();

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'PaperSub.AI — Public API',
    version: '1.0.0',
    description: `
## Overview
PaperSub.AI is a peer-review platform for academic institutions. This REST API gives programmatic access to accepted (published) papers.

## Authentication
All endpoints require an API key. Generate one from your **Profile → API keys** page.

Pass the key as a **Bearer token**:
\`\`\`
Authorization: Bearer psa_your_key_here
\`\`\`
Or as a query parameter:
\`\`\`
?api_key=psa_your_key_here
\`\`\`

## Rate limits
100 requests / 15 minutes per API key. Headers \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, and \`X-RateLimit-Reset\` are returned on every response.
    `.trim(),
    contact: { name: 'PaperSub.AI Support', email: 'support@papersub.ai' },
    license: { name: 'MIT' },
  },
  servers: [{ url: '/api/v1', description: 'Production' }],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'PSA API Key' },
    },
    schemas: {
      Paper: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
          authors: { type: 'string', description: 'Comma-separated author names' },
          abstract: { type: 'string' },
          keywords: { type: 'string' },
          ai_summary: { type: 'string', nullable: true },
          submission_date: { type: 'string', format: 'date-time' },
          author_username: { type: 'string' },
        },
      },
      ApiStatus: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          user: { type: 'string' },
          role: { type: 'string' },
          scopes: { type: 'string' },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
      PaperList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Paper' } },
          meta: {
            type: 'object',
            properties: {
              page: { type: 'integer' },
              limit: { type: 'integer' },
              total: { type: 'integer' },
            },
          },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    '/status': {
      get: {
        summary: 'API health check',
        description: 'Returns OK and caller identity. Use this to verify your API key works.',
        operationId: 'getStatus',
        tags: ['Utility'],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiStatus' } } } },
          401: { description: 'Invalid API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/papers': {
      get: {
        summary: 'List accepted papers',
        description: 'Returns paginated list of published (accepted) papers. Supports full-text search.',
        operationId: 'listPapers',
        tags: ['Papers'],
        parameters: [
          { name: 'q', in: 'query', description: 'Full-text search query', schema: { type: 'string' } },
          { name: 'page', in: 'query', description: 'Page number (1-based)', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', description: 'Results per page (max 50)', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'Paper list', content: { 'application/json': { schema: { $ref: '#/components/schemas/PaperList' } } } },
          401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/papers/{id}': {
      get: {
        summary: 'Get a single paper',
        operationId: 'getPaper',
        tags: ['Papers'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: { description: 'Paper', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Paper' } } } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/papers/{id}/cite': {
      get: {
        summary: 'Get BibTeX citation',
        operationId: 'getCitation',
        tags: ['Papers'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: { description: 'BibTeX text', content: { 'text/plain': { schema: { type: 'string' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
};

router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(spec, {
  customSiteTitle: 'PaperSub.AI API Docs',
  customCss: '.swagger-ui .topbar { display: none }',
}));
router.get('/openapi.json', (req, res) => res.json(spec));

module.exports = router;
