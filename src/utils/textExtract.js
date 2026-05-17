'use strict';

/**
 * Best-effort plain-text extraction from uploaded files. Supports docx
 * (mammoth), pdf (pdf-parse) and plain text. Failures don't block the
 * upload - they just leave file_text NULL and we fall back to the
 * abstract for similarity / AI review.
 */

const fs = require('fs/promises');
const path = require('path');
const logger = require('./logger');

async function extract(filePath) {
  if (!filePath) return null;
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.txt') {
      return (await fs.readFile(filePath, 'utf8')).slice(0, 200_000);
    }
    if (ext === '.docx') {
      // eslint-disable-next-line global-require
      const mammoth = require('mammoth');
      const buf = await fs.readFile(filePath);
      const out = await mammoth.extractRawText({ buffer: buf });
      return (out.value || '').slice(0, 200_000);
    }
    if (ext === '.pdf') {
      // eslint-disable-next-line global-require
      const pdfParse = require('pdf-parse');
      const buf = await fs.readFile(filePath);
      const out = await pdfParse(buf);
      return (out.text || '').slice(0, 200_000);
    }
    return null;
  } catch (err) {
    logger.warn({ err: err.message, filePath }, 'Text extraction failed');
    return null;
  }
}

module.exports = { extract };
