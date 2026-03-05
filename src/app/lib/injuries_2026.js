// AFL 2026 Injury List
// Source: afl.com.au/matches/injury-list — Updated: March 3-4, 2026
// Status: SEASON (out entire season), MONTHS (out months/TBC long-term), WEEKS (out weeks), DOUBT (test/game-day decision), MANAGED (light duties)

export const INJURIES = {
  // Adelaide
  "Dan Curtin":            { status: "MONTHS", detail: "Knee, TBC" },
  "Mark Keane":            { status: "MONTHS", detail: "Leg, TBC" },
  "Mitch Hinge":           { status: "DOUBT",  detail: "Back, test" },
  "James Peatling":        { status: "WEEKS",  detail: "Hamstring, 1 week" },
  "Izak Rankine":          { status: "WEEKS",  detail: "Suspension, out until R2" },

  // Brisbane
  "Cody Curtin":           { status: "MONTHS", detail: "Chest, TBC" },
  "Tom Doedee":            { status: "WEEKS",  detail: "Wrist, 2 weeks" },
  "Sam Draper":            { status: "WEEKS",  detail: "Foot, 1-2 weeks" },
  "Koby Evans":            { status: "WEEKS",  detail: "Ankle, 3-4 weeks" },
  "Eric Hipwood":          { status: "MONTHS", detail: "Knee, mid-season return" },
  "Luke Lloyd":            { status: "WEEKS",  detail: "Ankle, 3-4 weeks" },
  "Ben Murphy":            { status: "MONTHS", detail: "Chest, TBC" },
  "Jack Payne":            { status: "MONTHS", detail: "Knee, TBC" },
  "Cam Rayner":            { status: "DOUBT",  detail: "Groin, test" },
  "Henry Smith":           { status: "WEEKS",  detail: "Foot, 4 weeks" },

  // Carlton
  "Adam Cerra":            { status: "WEEKS",  detail: "Hamstring, 3-4 weeks" },
  "Matt Cottrell":         { status: "WEEKS",  detail: "Knee, 3-4 weeks" },
  "Francis Evans":         { status: "WEEKS",  detail: "Knee, 1-3 weeks" },
  "Nick Haynes":           { status: "WEEKS",  detail: "Ankle, 1-3 weeks" },
  "Jesse Motlop":          { status: "SEASON", detail: "Knee, out all season" },
  "Nic Newman":            { status: "WEEKS",  detail: "Suspension, out until R3" },
  "Harry O'Farrell":       { status: "MONTHS", detail: "Knee, TBC" },
  "Billy Wilson":          { status: "MONTHS", detail: "Foot, TBC" },

  // Collingwood
  "Bobby Hill":            { status: "MONTHS", detail: "Unavailable, TBC" },
  "Jeremy Howe":           { status: "WEEKS",  detail: "Calf, 1-2 weeks" },
  "Reef McInnes":          { status: "WEEKS",  detail: "Knee, 4-6 weeks" },
  "Darcy Moore":           { status: "DOUBT",  detail: "Calf, 1 week" },

  // Essendon
  "Cillian Bourke":        { status: "MONTHS", detail: "Hamstring, TBC" },
  "Nick Bryan":            { status: "MONTHS", detail: "Knee, TBC" },
  "Tom Edwards":           { status: "MONTHS", detail: "Knee, TBC" },
  "Lewis Hayes":           { status: "MONTHS", detail: "Knee, TBC" },
  "Isaac Kako":            { status: "WEEKS",  detail: "Hamstring, 1-3 weeks" },
  "Nic Martin":            { status: "SEASON", detail: "Knee, out all season" },
  "Jordan Ridley":         { status: "WEEKS",  detail: "Calf, 4-5 weeks" },
  "Sullivan Robey":        { status: "WEEKS",  detail: "Back, 1 week" },
  "Will Setterfield":      { status: "MONTHS", detail: "Foot, TBC" },
  "Rhys Unwin":            { status: "WEEKS",  detail: "Calf, 3 weeks" },

  // Fremantle
  "Brennan Cox":           { status: "DOUBT",  detail: "Calf, test" },
  "Alex Pearce":           { status: "DOUBT",  detail: "Calf, test" },
  "Sam Switkowski":        { status: "DOUBT",  detail: "Concussion, test" },
  "Sam Sturt":             { status: "MONTHS", detail: "Knee, TBC" },
  "Karl Worner":           { status: "DOUBT",  detail: "Knee soreness, test" },

  // Geelong
  "Harley Barker":         { status: "SEASON", detail: "Knee, indefinite" },
  "Jeremy Cameron":        { status: "DOUBT",  detail: "Quad, test" },
  "Toby Conway":           { status: "MONTHS", detail: "Foot/knee, TBC" },
  "Patrick Dangerfield":   { status: "DOUBT",  detail: "Calf, test" },
  "Keighton Matofai-Forbes":{ status: "MONTHS",detail: "Foot, TBC" },
  "Gryan Miers":           { status: "DOUBT",  detail: "Thumb, test" },
  "Jacob Molier":          { status: "MONTHS", detail: "Foot, 8-10 weeks" },
  "Bailey Smith":          { status: "DOUBT",  detail: "Calf, test" },

  // Gold Coast
  "Beau Addinsall":        { status: "WEEKS",  detail: "Hamstring, 4-6 weeks" },
  "Charlie Ballard":       { status: "DOUBT",  detail: "Knee, test" },
  "Elliott Himmelberg":    { status: "MONTHS", detail: "Knee, 6+ weeks" },
  "Max Knobel":            { status: "WEEKS",  detail: "Ankle, 1-3 weeks" },
  "Jai Murray":            { status: "MONTHS", detail: "Leg, 6+ weeks" },
  "Jake Rogers":           { status: "DOUBT",  detail: "Hamstring, test" },
  "Matt Rowell":           { status: "MONTHS", detail: "Finger, TBC" },
  "Jed Walter":            { status: "WEEKS",  detail: "Suspension, out R1" },

  // GWS
  "Leek Aleer":            { status: "WEEKS",  detail: "Groin, 1 week" },
  "Cody Angove":           { status: "MONTHS", detail: "Hamstring, TBC" },
  "Toby Bedford":          { status: "WEEKS",  detail: "Hamstring, 1 week" },
  "Aaron Cadman":          { status: "WEEKS",  detail: "Pelvis, 2 weeks" },
  "Finn Callaghan":        { status: "DOUBT",  detail: "Hip, test" },
  "Brent Daniels":         { status: "WEEKS",  detail: "Hamstring, 3-4 weeks" },
  "Tom Green":             { status: "SEASON", detail: "Knee, out all season" },
  "Darcy Jones":           { status: "MONTHS", detail: "Knee, TBC" },
  "Josh Kelly":            { status: "MONTHS", detail: "Hip, TBC" },
  "Toby McMullin":         { status: "WEEKS",  detail: "Hamstring, 1 week" },
  "Sam Taylor":            { status: "WEEKS",  detail: "Hamstring, 4-6 weeks" },

  // Hawthorn
  "Tom Barrass":           { status: "DOUBT",  detail: "Back, test" },
  "James Blanck":          { status: "MONTHS", detail: "Groin, TBC" },
  "Will Day":              { status: "MONTHS", detail: "Shoulder, 3 months" },
  "Cam Mackenzie":         { status: "WEEKS",  detail: "Concussion, 1 week" },
  "Cam Nairn":             { status: "WEEKS",  detail: "Back, 1 week" },

  // Melbourne
  "Jake Bowey":            { status: "MONTHS", detail: "Foot, TBC" },
  "Tom Campbell":          { status: "MONTHS", detail: "Neck, TBC" },
  "Jai Culley":            { status: "WEEKS",  detail: "Arm, 1-2 weeks" },
  "Bayley Fritsch":        { status: "WEEKS",  detail: "Hand, 1-2 weeks" },
  "Jack Henderson":        { status: "MONTHS", detail: "Sacrum, TBC" },
  "Matt Jefferson":        { status: "MONTHS", detail: "Foot, TBC" },
  "Luker Kentfield":       { status: "WEEKS",  detail: "Knee, 6 weeks" },
  "Shane McAdam":          { status: "MONTHS", detail: "Achilles, TBC" },
  "Brody Mihocek":         { status: "DOUBT",  detail: "Concussion, test" },
  "Andy Moniz-Wakefield":  { status: "MONTHS", detail: "Knee, TBC" },
  "Jack Viney":            { status: "MONTHS", detail: "Achilles, 8 weeks" },
  "Kalani White":          { status: "MONTHS", detail: "Glandular fever, TBC" },

  // North Melbourne
  "Jackson Archer":        { status: "SEASON", detail: "Knee, out all season" },
  "Aidan Corr":            { status: "DOUBT",  detail: "Calf, test" },
  "Taylor Goad":           { status: "WEEKS",  detail: "Ankle, 2-4 weeks" },
  "Riley Hardeman":        { status: "WEEKS",  detail: "Ankle, 1-2 weeks" },
  "Luke McDonald":         { status: "DOUBT",  detail: "Wrist, test" },
  "Colby McKercher":       { status: "DOUBT",  detail: "Finger, test" },
  "Blake Thredgold":       { status: "MONTHS", detail: "Foot, TBC" },
  "George Wardlaw":        { status: "WEEKS",  detail: "Hamstring, 2-3 weeks" },

  // Port Adelaide
  "Tom Cochrane":          { status: "WEEKS",  detail: "Hamstring, 3-4 weeks" },
  "Jack Lukosius":         { status: "DOUBT",  detail: "Groin, test" },
  "Sam Powell-Pepper":     { status: "MONTHS", detail: "Knee, 12-14 weeks" },
  "Ivan Soldo":            { status: "SEASON", detail: "Knee, out all season" },
  "Ollie Wines":           { status: "WEEKS",  detail: "Suspension, out until R3" },

  // Richmond
  "Judson Clarke":         { status: "MONTHS", detail: "ACL, TBC" },
  "Sam Cumming":           { status: "WEEKS",  detail: "Shoulder, 4 weeks" },
  "Ollie Hayes-Brown":     { status: "DOUBT",  detail: "Patella tendon, test" },
  "Taj Hotton":            { status: "MONTHS", detail: "Hip, TBC" },
  "Mykelti Lefau":         { status: "WEEKS",  detail: "Suspension, out until R2" },
  "Dion Prestia":          { status: "DOUBT",  detail: "Hamstring, test" },
  "Samson Ryan":           { status: "WEEKS",  detail: "Foot, 3-4 weeks" },
  "Tom Sims":              { status: "MONTHS", detail: "Elbow/foot, TBC" },
  "Josh Smillie":          { status: "WEEKS",  detail: "Quad, 6-10 weeks" },
  "Nick Vlastuin":         { status: "DOUBT",  detail: "Management, test" },

  // St Kilda
  "Ryan Byrnes":           { status: "MONTHS", detail: "Foot, TBC" },
  "Liam Henry":            { status: "WEEKS",  detail: "Hamstring, 6-7 weeks" },
  "Max King":              { status: "MONTHS", detail: "Calf/knee, TBC" },
  "Liam O'Connell":        { status: "MONTHS", detail: "Facial fractures, TBC" },
  "Jack Silvagni":         { status: "DOUBT",  detail: "Concussion, test" },

  // Sydney
  "Riak Andrew":           { status: "MONTHS", detail: "Quad, TBC" },
  "Ned Bowman":            { status: "WEEKS",  detail: "Hamstring, 6 weeks" },
  "Braeden Campbell":      { status: "MONTHS", detail: "Shin, TBC" },
  "Billy Cootee":          { status: "WEEKS",  detail: "Thigh, 3-4 weeks" },
  "Harry Cunningham":      { status: "WEEKS",  detail: "Quad, 1 week" },
  "Jesse Dattoli":         { status: "WEEKS",  detail: "Foot, 1-2 weeks" },
  "Tom Hanily":            { status: "WEEKS",  detail: "Shin, 2-3 weeks" },
  "Max King":              { status: "MONTHS", detail: "Back, 5 months" },
  "Jevan Phillipou":       { status: "WEEKS",  detail: "Quad, 1-2 weeks" },

  // West Coast
  "Liam Baker":            { status: "WEEKS",  detail: "Suspension, out until R2" },
  "Tyler Brockman":        { status: "WEEKS",  detail: "ITB, 5 weeks" },
  "Liam Duggan":           { status: "DOUBT",  detail: "Concussion, test" },
  "Harry Edwards":         { status: "MONTHS", detail: "Concussion, TBC" },
  "Reuben Ginbey":         { status: "DOUBT",  detail: "Foot, test" },
  "Jack Graham":           { status: "DOUBT",  detail: "Hamstring, test" },
  "Tom Gross":             { status: "WEEKS",  detail: "Hamstring, 5-7 weeks" },
  "Jack Hutchinson":       { status: "WEEKS",  detail: "Ankle, 7-9 weeks" },
  "Tim Kelly":             { status: "DOUBT",  detail: "Hamstring, test" },
  "Noah Long":             { status: "SEASON", detail: "Knee, out all season" },
  "Fred Rodriguez":        { status: "MONTHS", detail: "Foot, TBC" },
  "Harry Schoenberg":      { status: "WEEKS",  detail: "Suspension, out until R2" },
  "Brandon Starcevich":    { status: "WEEKS",  detail: "Calf, 1-2 weeks" },
  "Bailey Williams":       { status: "WEEKS",  detail: "Groin, 2-3 weeks" },

  // Western Bulldogs
  "Bailey Dale":           { status: "DOUBT",  detail: "Knee, test" },
  "Sam Darcy":             { status: "DOUBT",  detail: "Soreness, test" },
  "Riley Garcia":          { status: "MONTHS", detail: "Hamstring, TBC" },
  "Ryan Gardner":          { status: "WEEKS",  detail: "Groin, 1-2 weeks" },
  "Adam Treloar":          { status: "DOUBT",  detail: "Calf, test" },
  "Ryley Sanders":         { status: "WEEKS",  detail: "Concussion, 1-2 weeks" },
  "Zac Walker":            { status: "WEEKS",  detail: "Ankle, 5-7 weeks" },
  "Cody Weightman":        { status: "MONTHS", detail: "Knee, TBC" },
};

// Tailwind classes + label per status
export const INJURY_CONFIG = {
  SEASON:  { dot: "bg-red-500",    badge: "bg-red-100 text-red-700 border-red-300",    label: "OUT SEASON" },
  MONTHS:  { dot: "bg-orange-500", badge: "bg-orange-100 text-orange-700 border-orange-300", label: "OUT MONTHS" },
  WEEKS:   { dot: "bg-yellow-500", badge: "bg-yellow-100 text-yellow-700 border-yellow-300", label: "OUT WEEKS"  },
  DOUBT:   { dot: "bg-purple-500", badge: "bg-purple-100 text-purple-700 border-purple-300", label: "DOUBT R1"  },
  MANAGED: { dot: "bg-blue-400",   badge: "bg-blue-100 text-blue-700 border-blue-300",   label: "MANAGED"    },
  HEALTHY: { dot: "bg-green-500",  badge: "bg-green-100 text-green-700 border-green-300", label: "Fit"        },
};
