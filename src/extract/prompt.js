// Formats a parsed transcript for the model (EX-02). Shared by the provider route and the MCP adapter.

const hms = (ms) => new Date(ms).toISOString().slice(11, 19);

/** Speaking time and cue count per speaker label, in order of first appearance. */
export function speakerSummary(cues) {
  const speakers = new Map();
  for (const c of cues) {
    const key = c.speaker ?? '(unlabelled)';
    const s = speakers.get(key) ?? { speaker: key, cues: 0, speakingMs: 0 };
    s.cues += 1;
    s.speakingMs += c.endMs - c.startMs;
    speakers.set(key, s);
  }
  return [...speakers.values()];
}

/**
 * @param {{id: string, startMs: number, endMs: number, speaker: string|null, text: string}[]} cues
 * @param {{ mainSpeaker?: string|null, interviewers?: string[] }} [options]
 */
export function formatTranscript(cues, { mainSpeaker = null, interviewers = [] } = {}) {
  const lines = ['# Speakers'];
  for (const s of speakerSummary(cues)) lines.push(`- ${s.speaker}: ${Math.round(s.speakingMs / 1000)} s speaking, ${s.cues} cues`);
  lines.push(`Configured main speaker: ${mainSpeaker ?? 'none (decide from the content)'}`);
  lines.push(`Configured interviewers: ${interviewers.length ? interviewers.join(', ') : 'none (decide from who asks the questions)'}`);
  lines.push('', '# Transcript');
  for (const c of cues) lines.push(`[${c.id} ${hms(c.startMs)} ${c.speaker ?? '(unlabelled)'}] ${c.text}`);
  return lines.join('\n');
}
