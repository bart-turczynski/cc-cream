// Built-in defaults (PRD §6, minus the dropped `width` key — §14.2).
// Each colored segment names the LOWER BOUND where a color begins; the color
// function tests `red` first, then `orange` (ctx only), then `amber`, else green.
export const DEFAULTS = {
  numbers: 'compact',     // 'compact' | 'exact'
  ttl: 'auto',            // 'auto' | 60 | 5
  percentage: 'consumed', // 'consumed' | 'remaining' — display-only flip of ctx/5h/7d (PRDv2 §3)
  segments: {
    model:    { on: true,  row: 3, order: 0.5 },
    // `basis` picks the fullness reference the color (and, by default, the
    // shown %) measures against: 'window' = used_percentage of the real window
    // (no-regression default); 'ceiling' = total_input_tokens / `ceiling`, so
    // the warning fires at a fixed absolute size on any window. `display`
    // governs the shown %: 'basis' tracks the coloring basis (number and color
    // agree), 'window' pins it to CC's window figure regardless (PRD §4.4).
    ctx:      { on: true,  row: 1, order: 2, amber: 30, orange: 40, red: 50, basis: 'window', ceiling: 200000, display: 'basis' },
    cache:    { on: true,  row: 1, order: 3, drop: 20, drop_recover: 80 },
    ttl:      { on: true,  row: 1, order: 4, amber: 50, red: 80 },
    cost:     { on: true,  row: 1, order: 5 },
    '5h':     { on: true,  row: 2, order: 1, amber: 75, red: 90 },
    '7d':     { on: true,  row: 2, order: 2, amber: 75, red: 90 },
    // peak: amber peak-window indicator (PRDv2 §2). start/end are Pacific-time
    // hours (0–23, exclusive end); weekday (Mon–Fri) and the America/Los_Angeles
    // timezone are hardcoded policy facts, not config. Inside the window it reads
    // "peak until HH:MM" (local close time); the `lead` minutes before it opens it
    // counts down "peak in Nm".
    peak:     { on: true,  row: 2, order: 3, start: 5, end: 11, lead: 60 },
    burn:         { on: true,  row: 2, order: 1.5 },
    effort:       { on: true, row: 1, order: 6 },
    thinking:     { on: true, row: 1, order: 7 },
    api_ratio:    { on: true, row: 1, order: 8 },
    session_name: { on: true, row: 3, order: 1 },
    write:        { on: true, row: 1, order: 3.5 },
  },
};

// Row 1 renders as visual zones separated by " | " (PRD §4.3).
// Empty zones drop out, so a model-only bar is just the name with no separators.
export const ROW1_ZONES = [['ctx', 'cache', 'write', 'ttl', 'effort', 'thinking', 'api_ratio'], ['cost']];

export const ANSI = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  amber: '\x1b[33m',
  orange: '\x1b[38;5;208m',
};
