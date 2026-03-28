// story-ops.js - pure story mutation helpers for editable model

/**
 * @typedef {import('./style.js').Style} Style
 * @typedef {{ text: string, style: Style }} Run
 * @typedef {Run[][]} Story
 * @typedef {{ paraIndex: number, charOffset: number }} StoryPos
 */

import { cloneStyle, styleEq, DEFAULT_STYLE } from './style.js';

function cloneRun(run) {
  return { text: run.text, style: cloneStyle(run.style) };
}

function cloneStory(story) {
  return story.map((para) => para.map(cloneRun));
}

export function paraTextLength(story, paraIndex) {
  if (!story[paraIndex]) return 0;
  return story[paraIndex].reduce((sum, run) => sum + run.text.length, 0);
}

function paragraphText(story, paraIndex) {
  if (!story[paraIndex]) return '';
  return story[paraIndex].map((run) => run.text).join('');
}

export function normalizeParagraph(runs) {
  const out = [];
  for (const run of runs) {
    if (!run || typeof run.text !== 'string') continue;
    if (run.text.length === 0) continue;
    const style = cloneStyle(run.style);
    const prev = out[out.length - 1];
    if (prev && styleEq(prev.style, style)) {
      prev.text += run.text;
    } else {
      out.push({ text: run.text, style });
    }
  }
  if (out.length === 0) {
    out.push({ text: '', style: cloneStyle(DEFAULT_STYLE) });
  }
  return out;
}

export function normalizeStory(story) {
  const base = Array.isArray(story) ? cloneStory(story) : [];
  const normalized = base.map(normalizeParagraph);
  if (normalized.length === 0) {
    normalized.push(normalizeParagraph([]));
  }
  return normalized;
}

function clampPosNormalized(story, pos) {
  const p = Number.isInteger(pos?.paraIndex) ? pos.paraIndex : 0;
  const paraIndex = Math.max(0, Math.min(story.length - 1, p));
  const maxOffset = paraTextLength(story, paraIndex);
  const c = Number.isInteger(pos?.charOffset) ? pos.charOffset : 0;
  const charOffset = Math.max(0, Math.min(maxOffset, c));
  return { paraIndex, charOffset };
}

export function clampPos(story, pos) {
  const s = normalizeStory(story);
  return clampPosNormalized(s, pos);
}

/**
 * @param {StoryPos} a
 * @param {StoryPos} b
 * @returns {-1|0|1}
 */
export function comparePositions(a, b) {
  if (a.paraIndex < b.paraIndex) return -1;
  if (a.paraIndex > b.paraIndex) return 1;
  if (a.charOffset < b.charOffset) return -1;
  if (a.charOffset > b.charOffset) return 1;
  return 0;
}

/**
 * @param {StoryPos} a
 * @param {StoryPos} b
 * @returns {{ start: StoryPos, end: StoryPos }}
 */
export function orderPositions(a, b) {
  return comparePositions(a, b) <= 0
    ? { start: a, end: b }
    : { start: b, end: a };
}

export function splitRunAtCharOffset(paragraphRuns, charOffset) {
  const left = [];
  const right = [];
  let seen = 0;

  for (const run of paragraphRuns) {
    const len = run.text.length;
    const runStart = seen;
    const runEnd = seen + len;
    const style = cloneStyle(run.style);

    if (charOffset <= runStart) {
      right.push({ text: run.text, style });
    } else if (charOffset >= runEnd) {
      left.push({ text: run.text, style });
    } else {
      const cut = charOffset - runStart;
      const lt = run.text.slice(0, cut);
      const rt = run.text.slice(cut);
      if (lt.length > 0) left.push({ text: lt, style: cloneStyle(style) });
      if (rt.length > 0) right.push({ text: rt, style: cloneStyle(style) });
    }

    seen = runEnd;
  }

  return { leftRuns: left, rightRuns: right };
}

function runAtOffset(paragraphRuns, charOffset, bias) {
  const totalLen = paragraphRuns.reduce((sum, run) => sum + run.text.length, 0);
  if (paragraphRuns.length === 0) return null;

  if (charOffset <= 0) {
    return bias === 'left' ? null : paragraphRuns[0];
  }
  if (charOffset >= totalLen) {
    return bias === 'right' ? null : paragraphRuns[paragraphRuns.length - 1];
  }

  let seen = 0;
  for (const run of paragraphRuns) {
    const next = seen + run.text.length;
    if (charOffset < next) return run;
    if (charOffset === next) {
      if (bias === 'left') return run;
      seen = next;
      continue;
    }
    seen = next;
  }
  return paragraphRuns[paragraphRuns.length - 1];
}

export function getStyleAtPos(story, pos, bias = 'left') {
  const s = normalizeStory(story);
  const p = clampPosNormalized(s, pos);
  const para = s[p.paraIndex];
  const run = runAtOffset(para, p.charOffset, bias);
  return run ? cloneStyle(run.style) : cloneStyle(DEFAULT_STYLE);
}

export function resolveTypingStyle(story, pos, typingStyle) {
  if (typingStyle) return cloneStyle(typingStyle);
  const s = normalizeStory(story);
  const p = clampPosNormalized(s, pos);
  if (p.charOffset === 0) {
    return getStyleAtPos(s, p, 'right');
  }
  return getStyleAtPos(s, p, 'left');
}

function mergePairNormalized(story, paraIndex) {
  if (paraIndex < 0 || paraIndex >= story.length - 1) return story;
  const merged = normalizeParagraph([...story[paraIndex], ...story[paraIndex + 1]]);
  const out = story.slice(0, paraIndex);
  out.push(merged);
  out.push(...story.slice(paraIndex + 2));
  return out;
}

export function mergeParagraphs(story, paraIndex) {
  const s = normalizeStory(story);
  return mergePairNormalized(s, paraIndex);
}

/**
 * Delete a half-open range [start, end) and return collapsed cursor at range start.
 * @param {Story} story
 * @param {StoryPos} a
 * @param {StoryPos} b
 * @returns {{ story: Story, cursor: StoryPos }}
 */
export function deleteRange(story, a, b) {
  const s = normalizeStory(story);
  const pa = clampPosNormalized(s, a);
  const pb = clampPosNormalized(s, b);
  const ordered = orderPositions(pa, pb);
  const start = ordered.start;
  const end = ordered.end;

  if (comparePositions(start, end) === 0) {
    return { story: s, cursor: start };
  }

  if (start.paraIndex === end.paraIndex) {
    const para = s[start.paraIndex];
    const left = splitRunAtCharOffset(para, start.charOffset).leftRuns;
    const right = splitRunAtCharOffset(para, end.charOffset).rightRuns;
    const nextPara = normalizeParagraph([...left, ...right]);
    const nextStory = s.slice();
    nextStory[start.paraIndex] = nextPara;
    return { story: normalizeStory(nextStory), cursor: start };
  }

  const startPara = s[start.paraIndex];
  const endPara = s[end.paraIndex];
  const left = splitRunAtCharOffset(startPara, start.charOffset).leftRuns;
  const right = splitRunAtCharOffset(endPara, end.charOffset).rightRuns;
  const mergedPara = normalizeParagraph([...left, ...right]);

  const nextStory = [
    ...s.slice(0, start.paraIndex),
    mergedPara,
    ...s.slice(end.paraIndex + 1),
  ];

  return {
    story: normalizeStory(nextStory),
    cursor: { paraIndex: start.paraIndex, charOffset: start.charOffset },
  };
}

/**
 * Replace range [start, end) with text and return cursor after inserted text.
 * @param {Story} story
 * @param {StoryPos} start
 * @param {StoryPos} end
 * @param {string} text
 * @param {{ typingStyle?: Style }} [opts]
 * @returns {{ story: Story, cursor: StoryPos }}
 */
export function replaceRange(story, start, end, text, opts = {}) {
  const deleted = deleteRange(story, start, end);
  return insertText(deleted.story, deleted.cursor, text, opts);
}

/**
 * Return plain text content for half-open range [start, end).
 * Paragraph boundaries are represented as newlines.
 * @param {Story} story
 * @param {StoryPos} a
 * @param {StoryPos} b
 * @returns {string}
 */
export function textInRange(story, a, b) {
  const s = normalizeStory(story);
  const pa = clampPosNormalized(s, a);
  const pb = clampPosNormalized(s, b);
  const { start, end } = orderPositions(pa, pb);

  if (comparePositions(start, end) === 0) return '';

  if (start.paraIndex === end.paraIndex) {
    return paragraphText(s, start.paraIndex).slice(start.charOffset, end.charOffset);
  }

  const parts = [];
  parts.push(paragraphText(s, start.paraIndex).slice(start.charOffset));
  for (let pi = start.paraIndex + 1; pi < end.paraIndex; pi++) {
    parts.push(paragraphText(s, pi));
  }
  parts.push(paragraphText(s, end.paraIndex).slice(0, end.charOffset));
  return parts.join('\n');
}

/**
 * Apply a partial character-style patch to all runs touching [start, end).
 * @param {Story} story
 * @param {StoryPos} a
 * @param {StoryPos} b
 * @param {Partial<Style>} stylePatch
 * @returns {Story}
 */
export function applyStyleRange(story, a, b, stylePatch) {
  const s = normalizeStory(story);
  const pa = clampPosNormalized(s, a);
  const pb = clampPosNormalized(s, b);
  const { start, end } = orderPositions(pa, pb);
  if (comparePositions(start, end) === 0) return s;

  const patch = { ...(stylePatch || {}) };
  const nextStory = s.slice();

  for (let pi = start.paraIndex; pi <= end.paraIndex; pi++) {
    const para = nextStory[pi];
    const paraLen = paraTextLength(nextStory, pi);
    const from = pi === start.paraIndex ? start.charOffset : 0;
    const to = pi === end.paraIndex ? end.charOffset : paraLen;
    if (to <= from) continue;

    const firstSplit = splitRunAtCharOffset(para, from);
    const secondSplit = splitRunAtCharOffset(firstSplit.rightRuns, to - from);
    const styledMid = secondSplit.leftRuns.map((run) => ({
      text: run.text,
      style: cloneStyle({ ...run.style, ...patch }),
    }));

    nextStory[pi] = normalizeParagraph([
      ...firstSplit.leftRuns,
      ...styledMid,
      ...secondSplit.rightRuns,
    ]);
  }

  return normalizeStory(nextStory);
}

export function insertText(story, pos, text, opts = {}) {
  const s = normalizeStory(story);
  const p = clampPosNormalized(s, pos);
  const toInsert = String(text ?? '');
  if (toInsert.length === 0) {
    return { story: s, cursor: p };
  }

  if (toInsert.includes('\n')) {
    const parts = toInsert.split('\n');
    const style = resolveTypingStyle(s, p, opts.typingStyle);
    const para = s[p.paraIndex];
    const split = splitRunAtCharOffset(para, p.charOffset);

    const replacementParas = [];
    replacementParas.push(normalizeParagraph([
      ...split.leftRuns,
      { text: parts[0], style },
    ]));

    for (let i = 1; i < parts.length - 1; i++) {
      replacementParas.push(normalizeParagraph([{ text: parts[i], style }]));
    }

    replacementParas.push(normalizeParagraph([
      { text: parts[parts.length - 1], style },
      ...split.rightRuns,
    ]));

    const nextStory = [
      ...s.slice(0, p.paraIndex),
      ...replacementParas,
      ...s.slice(p.paraIndex + 1),
    ];

    return {
      story: nextStory,
      cursor: {
        paraIndex: p.paraIndex + parts.length - 1,
        charOffset: parts[parts.length - 1].length,
      },
    };
  }

  const style = resolveTypingStyle(s, p, opts.typingStyle);
  const para = s[p.paraIndex];
  const split = splitRunAtCharOffset(para, p.charOffset);
  const nextPara = normalizeParagraph([
    ...split.leftRuns,
    { text: toInsert, style },
    ...split.rightRuns,
  ]);

  const nextStory = s.slice();
  nextStory[p.paraIndex] = nextPara;
  return {
    story: normalizeStory(nextStory),
    cursor: { paraIndex: p.paraIndex, charOffset: p.charOffset + toInsert.length },
  };
}

export function insertParagraphBreak(story, pos) {
  const s = normalizeStory(story);
  const p = clampPosNormalized(s, pos);
  const para = s[p.paraIndex];
  const split = splitRunAtCharOffset(para, p.charOffset);

  const left = normalizeParagraph(split.leftRuns);
  const right = normalizeParagraph(split.rightRuns);

  const nextStory = [
    ...s.slice(0, p.paraIndex),
    left,
    right,
    ...s.slice(p.paraIndex + 1),
  ];

  return {
    story: normalizeStory(nextStory),
    cursor: { paraIndex: p.paraIndex + 1, charOffset: 0 },
  };
}

export function deleteBackward(story, pos) {
  const s = normalizeStory(story);
  const p = clampPosNormalized(s, pos);

  if (p.paraIndex === 0 && p.charOffset === 0) {
    return { story: s, cursor: p };
  }

  if (p.charOffset === 0) {
    const prevLen = paraTextLength(s, p.paraIndex - 1);
    return {
      story: mergePairNormalized(s, p.paraIndex - 1),
      cursor: { paraIndex: p.paraIndex - 1, charOffset: prevLen },
    };
  }

  const para = s[p.paraIndex];
  const left = splitRunAtCharOffset(para, p.charOffset - 1).leftRuns;
  const right = splitRunAtCharOffset(para, p.charOffset).rightRuns;
  const nextPara = normalizeParagraph([...left, ...right]);

  const nextStory = s.slice();
  nextStory[p.paraIndex] = nextPara;
  return {
    story: normalizeStory(nextStory),
    cursor: { paraIndex: p.paraIndex, charOffset: p.charOffset - 1 },
  };
}

export function deleteForward(story, pos) {
  const s = normalizeStory(story);
  const p = clampPosNormalized(s, pos);
  const len = paraTextLength(s, p.paraIndex);

  if (p.paraIndex === s.length - 1 && p.charOffset === len) {
    return { story: s, cursor: p };
  }

  if (p.charOffset === len) {
    return {
      story: mergePairNormalized(s, p.paraIndex),
      cursor: p,
    };
  }

  const para = s[p.paraIndex];
  const left = splitRunAtCharOffset(para, p.charOffset).leftRuns;
  const right = splitRunAtCharOffset(para, p.charOffset + 1).rightRuns;
  const nextPara = normalizeParagraph([...left, ...right]);

  const nextStory = s.slice();
  nextStory[p.paraIndex] = nextPara;
  return {
    story: normalizeStory(nextStory),
    cursor: p,
  };
}
