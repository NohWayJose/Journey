// WebVTT parser. Rules VT-01 to VT-08 in specs/30-design.md#vtt-parsing.

export class VttError extends Error {
  constructor(message, line) {
    super(line ? `Line ${line}: ${message}` : message);
    this.name = 'VttError';
    this.line = line;
  }
}

const TIMESTAMP = /^(?:(\d+):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&lrm;': '', '&rlm;': '' };
const ZOOM_SPEAKER = /^([^:<>\d][^:<>]{0,39}):\s+(.*)$/;

function toMs(stamp, line) {
  const m = TIMESTAMP.exec(stamp);
  if (!m) throw new VttError(`Invalid timestamp "${stamp}"`, line);
  const [, h = '0', min, s, ms] = m;
  return ((Number(h) * 60 + Number(min)) * 60 + Number(s)) * 1000 + Number(ms);
}

function cleanText(raw) {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (e) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePayload(lines) {
  const raw = lines.join(' ');
  const voice = /<v(?:\.[^\s>]+)*\s+([^>]+)>/.exec(raw);
  if (voice) return { speaker: voice[1].trim(), text: cleanText(raw) };
  const text = cleanText(raw);
  const zoom = ZOOM_SPEAKER.exec(text);
  if (zoom) return { speaker: zoom[1].trim(), text: zoom[2] };
  return { speaker: null, text };
}

/**
 * @param {string} source WebVTT file contents
 * @returns {{ cues: {id: string, startMs: number, endMs: number, speaker: string|null, text: string}[], durationMs: number }}
 */
export function parseVtt(source) {
  const lines = source.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0])) throw new VttError('File must start with WEBVTT', 1);

  const cues = [];
  let i = 1;
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }

    // Collect one block (up to a blank line)
    const start = i;
    const block = [];
    while (i < lines.length && lines[i].trim() !== '') block.push(lines[i++]);

    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(block[0])) continue;

    // A first line that starts like a timestamp is a (possibly broken) timing line, not an identifier
    const timingIndex = block[0].includes('-->') || /^\d+:\d{2}/.test(block[0]) ? 0 : 1;
    const timing = block[timingIndex];
    const lineNo = start + timingIndex + 1;
    if (!timing || !timing.includes('-->')) throw new VttError('Expected a timing line ("start --> end")', lineNo);

    const [from, rest] = timing.split('-->').map((s) => s.trim());
    const startMs = toMs(from, lineNo);
    const endMs = toMs(rest.split(/\s+/)[0], lineNo);
    if (endMs < startMs) throw new VttError('Cue ends before it starts', lineNo);

    const { speaker, text } = parsePayload(block.slice(timingIndex + 1));
    if (text) cues.push({ id: `c${cues.length + 1}`, startMs, endMs, speaker, text });
  }

  return { cues, durationMs: cues.reduce((max, c) => Math.max(max, c.endMs), 0) };
}
