// Renders a Task Flow Model to SVG files: compiles to Mermaid, renders with pele, attaches
// stylesheets (specs/30-design.md#styling). pele is only used here, so it can be replaced.

import { readFileSync } from 'node:fs';
import { render } from 'pele';
import { compileTaskFlow } from './mermaid.js';

export const DEFAULT_THEME = readFileSync(new URL('../../styles/journey.css', import.meta.url), 'utf8');

const attr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Adds linked (`<?xml-stylesheet?>`) and embedded (`<style>`) stylesheets to an SVG document. */
export function attachStylesheets(svg, { link = [], embed = [] } = {}) {
  let out = svg;
  if (embed.length) {
    const css = embed.join('\n').replace(/]]>/g, ']]]]><![CDATA[>');
    out = out.replace(/^(<svg\b[^>]*>)/, `$1<style><![CDATA[\n${css}\n]]></style>`);
  }
  if (link.length) {
    const pis = link.map((href) => `<?xml-stylesheet type="text/css" href="${attr(href)}"?>`).join('\n');
    out = `<?xml version="1.0" encoding="UTF-8"?>\n${pis}\n${out}`;
  }
  return out;
}

/**
 * @param {object} flow the `flow` part of a Task Flow Document
 * @param {{id: string, startMs: number}[]} cues
 * @param {object} [options] compile options (name, direction, detail, wrapAt) plus:
 * @param {{ link?: string[], embed?: string[] }} [options.stylesheets] extra stylesheets (hrefs to link, CSS text to embed)
 * @param {boolean} [options.defaultTheme=true] embed the default (Carbon-based) theme
 * @returns {{ id: string, fileName: string, mermaid: string, svg: string }[]}
 */
export function renderTaskFlow(flow, cues, { stylesheets = {}, defaultTheme = true, ...compileOptions } = {}) {
  const embed = [...(defaultTheme ? [DEFAULT_THEME] : []), ...(stylesheets.embed ?? [])];
  return compileTaskFlow(flow, cues, compileOptions).map((diagram) => ({
    ...diagram,
    svg: attachStylesheets(render(diagram.mermaid).svg, { link: stylesheets.link ?? [], embed }),
  }));
}
