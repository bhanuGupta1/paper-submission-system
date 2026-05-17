'use strict';

/**
 * Heuristic "LLM-shaped" backend.
 *
 * Implements the same interface as the Claude backend so the rest of the
 * codebase doesn't care which one is active. Useful for development,
 * for CI, and for offline / zero-cost demos.
 *
 * The transformations are deliberately conservative and explainable -
 * we never invent facts; we paraphrase, score, and structure what's
 * already in the paper.
 */

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

// ---------- text helpers --------------------------------------------------

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function sentences(text) {
  if (!text) return [];
  return String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordFrequency(tokens) {
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  return freq;
}

// ---------- public API ----------------------------------------------------

function summarize(text, numSentences = 3) {
  const sents = sentences(text);
  if (sents.length <= numSentences) return sents.join(' ');
  // TextRank-lite: score each sentence by sum of token frequencies.
  const tokens = tokenize(text);
  const freq = wordFrequency(tokens);
  const scored = sents.map((s, i) => {
    const score =
      tokenize(s).reduce((acc, w) => acc + (freq.get(w) || 0), 0) /
      Math.max(1, tokenize(s).length);
    return { s, i, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, numSentences)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
    .join(' ');
}

function extractKeywords(text, n = 6) {
  const freq = wordFrequency(tokenize(text));
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

/**
 * Generate a structured first-pass review draft.
 *
 * The intent is to ground a *human* reviewer, not to replace them.
 * Scores are conservative midpoints unless the abstract gives strong
 * positive or negative signals (length, hedging language, etc.).
 */
function draftReview(paper) {
  const text = `${paper.title || ''}. ${paper.abstract || ''}`;
  const tokens = tokenize(text);
  const wordCount = tokens.length;

  const summary = summarize(paper.abstract || '', 2) ||
    'No abstract supplied; reviewer should request one.';

  const noveltyHints = ['novel', 'first', 'new', 'propose', 'introduce', 'unprecedented'];
  const rigorHints   = ['evaluate', 'experiment', 'benchmark', 'baseline', 'ablation', 'dataset'];
  const hedgingHints = ['might', 'could', 'possibly', 'somewhat', 'preliminary'];

  const lower = text.toLowerCase();
  const noveltyHits = noveltyHints.filter((w) => lower.includes(w)).length;
  const rigorHits   = rigorHints.filter((w) => lower.includes(w)).length;
  const hedgingHits = hedgingHints.filter((w) => lower.includes(w)).length;

  const strengths = [];
  if (noveltyHits >= 2) strengths.push('The abstract frames the contribution as novel and clearly motivated.');
  if (rigorHits >= 2)   strengths.push('Empirical evaluation is described (datasets / baselines / experiments mentioned).');
  if (wordCount > 100)  strengths.push('Abstract is sufficiently detailed for an initial assessment.');
  if (strengths.length === 0) strengths.push('Topic appears relevant to the venue scope.');

  const weaknesses = [];
  if (rigorHits === 0)  weaknesses.push('No mention of evaluation methodology or baselines in the abstract.');
  if (hedgingHits >= 2) weaknesses.push('Several hedging terms suggest preliminary results; reviewer should check rigor of evidence.');
  if (wordCount < 60)   weaknesses.push('Abstract is unusually short; key methodology details may be missing.');
  if (noveltyHits === 0) weaknesses.push('Novelty claim is not made explicit; reviewer should verify positioning vs. prior work.');
  if (weaknesses.length === 0) weaknesses.push('No major weaknesses surfaced from abstract alone; full-text review needed.');

  const score = (hits) => Math.max(2, Math.min(5, 2 + Math.round(hits * 0.7)));
  const novelty_score      = score(noveltyHits);
  const significance_score = score(noveltyHits + Math.floor(rigorHits / 2));
  const clarity_score = wordCount > 100 ? 4 : wordCount > 50 ? 3 : 2;

  let recommendation = 'major_revisions';
  const avg = (novelty_score + significance_score + clarity_score) / 3;
  if (avg >= 4.3) recommendation = 'accept';
  else if (avg >= 3.7) recommendation = 'minor_revisions';
  else if (avg <= 2.5) recommendation = 'reject';

  return {
    summary,
    strengths: strengths.join('\n- '),
    weaknesses: weaknesses.join('\n- '),
    novelty_score,
    clarity_score,
    significance_score,
    recommendation,
    confidence_note:
      'Auto-drafted from the abstract using rule-based heuristics. Treat as a starting point and verify against the full manuscript.',
    provider: 'heuristic',
  };
}

/**
 * Suggest title alternatives by recombining high-signal noun phrases
 * out of the abstract. Pure rules, no fabrication.
 */
function suggestTitles(abstract, n = 3) {
  const kw = extractKeywords(abstract, 8);
  if (kw.length < 3) return [];
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const out = [];
  if (kw.length >= 3) out.push(`${cap(kw[0])} for ${cap(kw[1])}: An Empirical Study`);
  if (kw.length >= 4) out.push(`Towards ${cap(kw[1])} via ${cap(kw[2])} and ${cap(kw[3])}`);
  if (kw.length >= 5) out.push(`Re-examining ${cap(kw[0])}: A ${cap(kw[4])}-based Approach`);
  return out.slice(0, n);
}

/**
 * Conservative abstract polish: trims filler, capitalises, normalises
 * whitespace, surfaces specific suggestions for the author.
 */
function polishAbstract(text) {
  if (!text || !text.trim()) {
    return { revised: '', suggestions: ['Abstract is empty - please add 100-250 words.'] };
  }
  let revised = String(text).replace(/\s+/g, ' ').trim();
  // Sentence-case start.
  revised = revised.charAt(0).toUpperCase() + revised.slice(1);
  // Strip filler.
  revised = revised
    .replace(/\b(very|quite|really|basically|actually|just|in order to)\b/gi, (m) =>
      m.toLowerCase() === 'in order to' ? 'to' : '')
    .replace(/\s{2,}/g, ' ');

  const suggestions = [];
  const wordCount = revised.split(/\s+/).length;
  if (wordCount < 80)  suggestions.push(`Abstract is short (${wordCount} words). Most venues expect 150-250.`);
  if (wordCount > 300) suggestions.push(`Abstract is long (${wordCount} words). Aim for under 250.`);
  if (!/result|finding|show|demonstrate|achieve|evaluate/i.test(revised))
    suggestions.push('Add a sentence describing the main result or evaluation outcome.');
  if (!/we |our /i.test(revised))
    suggestions.push('State the contribution explicitly with "we propose" or "we present".');
  if (/\b(very|really|basically|actually)\b/i.test(text))
    suggestions.push('Removed filler words (very, really, basically, actually).');

  return { revised, suggestions };
}

module.exports = { draftReview, summarize, extractKeywords, polishAbstract, suggestTitles };
