'use strict';

const writingAssistant = require('../services/writingAssistant');

async function polish(req, res, next) {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });
    const out = await writingAssistant.polish(text, req.user.id);
    res.json(out);
  } catch (err) {
    next(err);
  }
}

async function titles(req, res, next) {
  try {
    const { abstract } = req.body;
    if (!abstract || !abstract.trim()) {
      return res.status(400).json({ error: 'abstract is required' });
    }
    const out = await writingAssistant.titles(abstract, req.user.id, 3);
    res.json({ titles: out });
  } catch (err) {
    next(err);
  }
}

async function keywords(req, res, next) {
  try {
    const { abstract } = req.body;
    if (!abstract || !abstract.trim()) {
      return res.status(400).json({ error: 'abstract is required' });
    }
    const out = await writingAssistant.keywords(abstract, req.user.id, 6);
    res.json({ keywords: out });
  } catch (err) {
    next(err);
  }
}

module.exports = { polish, titles, keywords };
