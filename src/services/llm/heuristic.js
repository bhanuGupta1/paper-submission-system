'use strict';

// Heuristic stubs — same interface as openrouter.js, offline fallbacks

const STOPWORDS = new Set([
  'the','a','an','and','or','but','of','in','on','at','to','for','with','by','from','as',
  'is','are','was','were','be','been','being','this','that','these','those','it','its',
  'we','our','their','them','they','i','you','your','he','she','his','her','do','does',
  'did','done','have','has','had','having','can','could','should','would','will','may',
  'might','must','shall','than','then','so','if','because','about','into','over','under',
  'between','through','during','before','after','above','below','out','off','here','there',
  'when','where','why','how','what','which','who','whom','whose','also','very','more','most',
  'such','some','any','all','each','other','same','only','own','no','not','nor','too',
]);

function tokenize(text) {
  if (!text) return [];
  return String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function sentences(text) {
  if (!text) return [];
  return String(text).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
}

function wordFrequency(tokens) {
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  return freq;
}

function summarize(text, numSentences = 3) {
  const sents = sentences(text);
  if (sents.length <= numSentences) return sents.join(' ');
  const tokens = tokenize(text);
  const freq = wordFrequency(tokens);
  const scored = sents.map((s, i) => ({ s, i, score: tokenize(s).reduce((acc, w) => acc + (freq.get(w) || 0), 0) / Math.max(1, tokenize(s).length) }));
  return scored.sort((a, b) => b.score - a.score).slice(0, numSentences).sort((a, b) => a.i - b.i).map(x => x.s).join(' ');
}

function extractKeywords(text, n = 6) {
  const freq = wordFrequency(tokenize(text));
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

function draftReview(paper) {
  const text = (paper.title || '') + '. ' + (paper.abstract || '');
  const lower = text.toLowerCase();
  const tokens = tokenize(text);
  const wc = tokens.length;
  const noveltyHints = ['novel','first','new','propose','introduce','unprecedented'];
  const rigorHints = ['evaluate','experiment','benchmark','baseline','ablation','dataset'];
  const hedgingHints = ['might','could','possibly','somewhat','preliminary'];
  const noveltyHits = noveltyHints.filter(w => lower.includes(w)).length;
  const rigorHits = rigorHints.filter(w => lower.includes(w)).length;
  const hedgingHits = hedgingHints.filter(w => lower.includes(w)).length;
  const summary = summarize(paper.abstract || '', 2) || 'No abstract supplied.';
  const strengths = [];
  if (noveltyHits >= 2) strengths.push('Abstract frames the contribution as novel.');
  if (rigorHits >= 2) strengths.push('Empirical evaluation is described.');
  if (wc > 100) strengths.push('Abstract is sufficiently detailed.');
  if (!strengths.length) strengths.push('Topic appears relevant to the venue scope.');
  const weaknesses = [];
  if (rigorHits === 0) weaknesses.push('No mention of evaluation methodology in the abstract.');
  if (hedgingHits >= 2) weaknesses.push('Several hedging terms suggest preliminary results.');
  if (wc < 60) weaknesses.push('Abstract is unusually short.');
  if (!noveltyHits) weaknesses.push('Novelty claim is not explicit.');
  if (!weaknesses.length) weaknesses.push('No major weaknesses from abstract alone; full-text review needed.');
  const score = h => Math.max(2, Math.min(5, 2 + Math.round(h * 0.7)));
  const novelty_score = score(noveltyHits), clarity_score = wc > 100 ? 4 : wc > 50 ? 3 : 2, significance_score = score(noveltyHits + Math.floor(rigorHits / 2));
  const avg = (novelty_score + clarity_score + significance_score) / 3;
  const recommendation = avg >= 4.3 ? 'accept' : avg >= 3.7 ? 'minor_revisions' : avg <= 2.5 ? 'reject' : 'major_revisions';
  return { summary, strengths: strengths.join('\n- '), weaknesses: weaknesses.join('\n- '), novelty_score, clarity_score, significance_score, recommendation, confidence_note: 'Heuristic draft — edit before submitting.', provider: 'heuristic' };
}

function suggestTitles(abstract, n = 3) {
  const kw = extractKeywords(abstract, 8);
  if (kw.length < 3) return [];
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
  const out = [];
  if (kw.length >= 3) out.push(cap(kw[0]) + ' for ' + cap(kw[1]) + ': An Empirical Study');
  if (kw.length >= 4) out.push('Towards ' + cap(kw[1]) + ' via ' + cap(kw[2]) + ' and ' + cap(kw[3]));
  if (kw.length >= 5) out.push('Re-examining ' + cap(kw[0]) + ': A ' + cap(kw[4]) + '-based Approach');
  return out.slice(0, n);
}

function polishAbstract(text) {
  if (!text || !text.trim()) return { revised: '', suggestions: ['Abstract is empty — please add 100-250 words.'] };
  let revised = String(text).replace(/\s+/g, ' ').trim();
  revised = revised.charAt(0).toUpperCase() + revised.slice(1);
  revised = revised.replace(/\b(very|quite|really|basically|actually|just|in order to)\b/gi, m => m.toLowerCase() === 'in order to' ? 'to' : '').replace(/\s{2,}/g, ' ');
  const suggestions = [];
  const wc = revised.split(/\s+/).length;
  if (wc < 80) suggestions.push('Abstract is short (' + wc + ' words). Most venues expect 150-250.');
  if (wc > 300) suggestions.push('Abstract is long (' + wc + ' words). Aim for under 250.');
  if (!/result|finding|show|demonstrate|achieve|evaluate/i.test(revised)) suggestions.push('Add a sentence describing the main result or evaluation outcome.');
  if (!/we |our /i.test(revised)) suggestions.push('State the contribution explicitly with "we propose" or "we present".');
  return { revised, suggestions };
}

// Null stubs for LLM-only features
function generateDecisionLetter() { return null; }
function summarizeReviews() { return null; }
function deskRejectionCheck() { return null; }
function ethicsCheck() { return null; }
function citationHallucinationCheck() { return null; }
function toneImprove() { return null; }
function writingScore() { return null; }
function sectionFeedback() { return null; }
function reviewAssist() { return null; }
function reviewQualityLlm() { return null; }
function revisionSummarizer() { return null; }
function responseToReviewers() { return null; }
function analyticsInsights() { return null; }
function generateRubric() { return null; }
function streamToneImprove(text, res) { res.write('data: ' + JSON.stringify({ error: 'Streaming requires OpenRouter API' }) + '\n\n'); res.end(); }

module.exports = {
  summarize, extractKeywords, draftReview, suggestTitles, polishAbstract,
  generateDecisionLetter, summarizeReviews,
  deskRejectionCheck, ethicsCheck, citationHallucinationCheck,
  toneImprove, writingScore, sectionFeedback,
  reviewAssist, reviewQualityLlm,
  revisionSummarizer, responseToReviewers,
  analyticsInsights, generateRubric, streamToneImprove,
};
