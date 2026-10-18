import { test, expect } from '@playwright/test';
import { parseVtt, VttError } from '../../src/vtt/parse.js';

const vtt = (...blocks) => ['WEBVTT', '', ...blocks.flatMap((b) => [b, ''])].join('\n');

test('VT-01: rejects a file without the WEBVTT header', () => {
  expect(() => parseVtt('00:00.000 --> 00:01.000\nHello')).toThrow(VttError);
  expect(parseVtt('﻿WEBVTT - interview\n').cues).toEqual([]);
});

test('VT-02: parses identifiers, both timestamp forms, settings and CRLF', () => {
  const { cues } = parseVtt(
    'WEBVTT\r\n\r\n42\r\n00:00:01.500 --> 00:00:04.000 align:start\r\nFirst line\r\nsecond line\r\n\r\n00:05.000 --> 00:06.250\r\nNext\r\n',
  );
  expect(cues).toEqual([
    { id: 'c1', startMs: 1500, endMs: 4000, speaker: null, text: 'First line second line' },
    { id: 'c2', startMs: 5000, endMs: 6250, speaker: null, text: 'Next' },
  ]);
});

test('VT-03: ignores NOTE, STYLE and REGION blocks', () => {
  const { cues } = parseVtt(vtt('NOTE recorded on Teams', 'STYLE\n::cue { color: red }', '00:01.000 --> 00:02.000\nHi'));
  expect(cues.map((c) => c.text)).toEqual(['Hi']);
});

test('VT-04: takes the speaker from voice tags or a Zoom-style prefix', () => {
  const { cues } = parseVtt(vtt(
    '00:01.000 --> 00:02.000\n<v Priya Shah>I start with the spreadsheet</v>',
    '00:02.000 --> 00:03.000\n<v.loud Meeting Room 3>We all do',
    '00:03.000 --> 00:04.000\nJo Bloggs: Me too',
    '00:04.000 --> 00:05.000\n10:30 is when it starts',
  ));
  expect(cues.map(({ speaker, text }) => [speaker, text])).toEqual([
    ['Priya Shah', 'I start with the spreadsheet'],
    ['Meeting Room 3', 'We all do'],
    ['Jo Bloggs', 'Me too'],
    [null, '10:30 is when it starts'],
  ]);
});

test('VT-05: strips other tags and decodes entities', () => {
  const { cues } = parseVtt(vtt('00:01.000 --> 00:02.000\n<v Sam><i>Fish</i> &amp; chips &lt;3 <00:01.500><c.yellow>now</c>'));
  expect(cues[0].text).toBe('Fish & chips <3 now');
});

test('VT-06: numbers cues in order, ignoring file identifiers and dropping empty cues', () => {
  const { cues } = parseVtt(vtt('b7\n00:01.000 --> 00:02.000\nOne', 'x\n00:02.000 --> 00:03.000\n<v Sam></v>', '00:03.000 --> 00:04.000\nTwo'));
  expect(cues.map((c) => [c.id, c.text])).toEqual([['c1', 'One'], ['c2', 'Two']]);
});

test('VT-07: reports malformed timing with its line number', () => {
  expect(() => parseVtt(vtt('00:01.000 -> 00:02.000\nOops'))).toThrow(/Line 3/);
  expect(() => parseVtt(vtt('00:01.000 --> 00:0x.000\nOops'))).toThrow(/Line 3: Invalid timestamp/);
  expect(() => parseVtt(vtt('00:05.000 --> 00:02.000\nOops'))).toThrow(/Line 3: Cue ends before it starts/);
});

test('VT-08: duration is the latest cue end', () => {
  expect(parseVtt(vtt('00:01.000 --> 01:00:00.000\nA', '00:02.000 --> 00:03.000\nB')).durationMs).toBe(3_600_000);
});
