import os from 'node:os';
import path from 'node:path';

const homeDir = () => os.homedir();
const claudeDir = () => path.join(homeDir(), '.claude');

export const PATHS = {
  homeDir,
  claudeDir,
  configFile: () => path.join(claudeDir(), 'cc-cream.json'),
  stateFile: () => path.join(claudeDir(), 'cc-cream-state.json'),
  debugLog: () => path.join(claudeDir(), 'cc-cream-debug.log'),
  settingsFile: () => path.join(claudeDir(), 'settings.json'),
  runtimeDir: () => path.join(claudeDir(), 'cc-cream'),
  runtimeEntry: () => path.join(claudeDir(), 'cc-cream', 'cc-cream.js'),
};
