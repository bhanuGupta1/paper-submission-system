'use strict';

const path = require('path');
const fs = require('fs/promises');
const ExcelJS = require('exceljs');
const Paper = require('../models/Paper');
const Review = require('../models/Review');
const analytics = require('../services/operationsAnalytics');
const { all } = require('../db/connection');
const config = require('../config');

async function dashboard(req, res, next) {
  try {
    const papers = await Paper.listAll();
    const reviews = await Review.listAll();
    const aiUsage = await all(
      `SELECT action, provider, COUNT(*) AS n
       FROM ai_audit
       GROUP BY action, provider
       ORDER BY n DESC`
    );
    const ops = await analytics.getAdminAnalytics();
    res.render('admin/dashboard', { title: 'Admin dashboard', papers, reviews, aiUsage, ops });
  } catch (err) {
    next(err);
  }
}

async function exportXlsx(req, res, next) {
  try {
    const rows = await all(`
      SELECT p.id, p.title, p.authors, u.username AS contact_author,
             p.abstract, p.keywords, p.review_status,
             p.similarity_score, p.ai_text_likelihood,
             p.submission_date
      FROM papers p
      LEFT JOIN users u ON p.author_id = u.id
      ORDER BY p.submission_date DESC
    `);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Papers');
    ws.columns = [
      { header: 'ID', key: 'id', width: 6 },
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Authors', key: 'authors', width: 24 },
      { header: 'Contact author', key: 'contact_author', width: 18 },
      { header: 'Abstract', key: 'abstract', width: 60 },
      { header: 'Keywords', key: 'keywords', width: 24 },
      { header: 'Status', key: 'review_status', width: 14 },
      { header: 'Similarity', key: 'similarity_score', width: 10 },
      { header: 'AI-text likelihood', key: 'ai_text_likelihood', width: 16 },
      { header: 'Submission date', key: 'submission_date', width: 20 },
    ];
    rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true };

    const tmp = path.join(config.paths.root, 'data', `export-${Date.now()}.xlsx`);
    await wb.xlsx.writeFile(tmp);
    res.download(tmp, 'papers.xlsx', async () => {
      fs.unlink(tmp).catch(() => {});
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { dashboard, exportXlsx };
