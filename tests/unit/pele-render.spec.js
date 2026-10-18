import { test, expect } from '@playwright/test';
import { render, detectType } from 'pele';
import { checkoutJourney } from '../fixtures/checkout.journey.js';

test('detects journey diagrams', () => {
  expect(detectType(checkoutJourney)).toBe('journey');
});

test('renders a journey to SVG in Node', () => {
  const result = render(checkoutJourney);
  expect(result.type).toBe('journey');
  expect(result.svg).toMatch(/^<svg[^>]*class="pele pele-journey"/);
  expect(result.width).toBeGreaterThan(0);
  expect(result.height).toBeGreaterThan(0);
  expect(result.svg).toContain('Find product');
  expect(result.svg).toContain('Enter card');
});
