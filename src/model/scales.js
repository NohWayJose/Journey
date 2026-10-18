// 5-point Likert labels (specs/00-vision.md#scales, D-010). Labels are derived, never stored.

export const SCALES = {
  difficulty: ['Very easy', 'Easy', 'Neither easy nor hard', 'Hard', 'Very hard'],
  frequency: ['Rarely', 'Monthly', 'Weekly', 'Daily', 'Multiple times a day'],
};

/** @param {'difficulty'|'frequency'} measure @param {1|2|3|4|5} value */
export const likertLabel = (measure, value) => SCALES[measure][value - 1];
