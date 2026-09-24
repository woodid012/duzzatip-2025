// app/lib/constants.js

export const CURRENT_YEAR = new Date().getFullYear();

// Initial values
export const LATEST_ROUND = 0;

// The main comp's last round (its Grand Final). AFL finals rounds (25+, the
// Duzza Finals side comp) exist in the fixtures collection but must never
// drive the season pages' current-round logic.
export const MAIN_SEASON_FINAL_ROUND = 24;

export const POSITION_TYPES = [
  'Full Forward', 
  'Tall Forward', 
  'Offensive', 
  'Midfielder', 
  'Tackler', 
  'Ruck', 
  'Bench',
  'Reserve A',
  'Reserve B'
];

export const BACKUP_POSITIONS = [
  'Full Forward', 
  'Tall Forward', 
  'Offensive', 
  'Midfielder', 
  'Tackler', 
  'Ruck'
];

export const USER_NAMES = {
  1: "Feathers and noodle soup",
  2: "Sharky's Bite",
  3: "Full Metal Jacket Miguel",
  4: "Le Quack Attack",
  5: "Randy's Ruckin Roalercoaster",
  6: "Nightmare of Milky Briz",
  7: "String Theory",
  8: "Pinga Jinga Pillbox"
};

export const TEAM_LOGOS = {
  1: "🍜🪶",
  2: "🦈🩸",
  3: "🪖💣",
  4: "🦆⚡",
  5: "🎢😵",
  6: "🌙🥛",
  7: "🧵🌀",
  8: "💊🕺"
};