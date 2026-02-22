// AFL 2026 Pre-Season Injury List
// Scraped from AFL.com.au + SEN injury hubs, Feb 2026
// Status: SEASON (out entire season), MONTHS (out months), WEEKS (out weeks), DOUBT (doubtful R1), MANAGED (light duties/managed)

const INJURIES = {
  // Adelaide
  "Mark Keane":          { status: "MONTHS", detail: "Broken ankle" },
  "Dan Curtin":          { status: "MONTHS", detail: "Dislocated knee, out R7+" },
  "Sid Draper":          { status: "DOUBT",  detail: "Groin soreness" },
  "Mitch Hinge":         { status: "MANAGED",detail: "Back soreness" },
  "Izak Rankine":        { status: "WEEKS",  detail: "Suspension R1-2" },
  "Callum Ah Chee":      { status: "DOUBT",  detail: "Hamstring strain" },
  "Ben Keays":           { status: "DOUBT",  detail: "Hamstring" },

  // Brisbane
  "Sam Draper":          { status: "WEEKS",  detail: "Foot stress reaction, miss R1" },
  "Jack Payne":          { status: "WEEKS",  detail: "Ruptured patella tendon, back R6" },
  "Eric Hipwood":        { status: "MONTHS", detail: "Ruptured ACL, second half season" },
  "Josh Dunkley":        { status: "MANAGED",detail: "Shoulder surgery, back in training" },
  "Jarrod Berry":        { status: "MANAGED",detail: "Shoulder surgery, back in training" },
  "Jaspa Fletcher":      { status: "MANAGED",detail: "Shoulder surgery" },
  "Keidean Coleman":     { status: "MANAGED",detail: "Quad, expected R1" },

  // Carlton
  "Jacob Weitering":     { status: "DOUBT",  detail: "Fractured rib" },
  "Jesse Motlop":        { status: "SEASON", detail: "Ruptured ACL, out all year" },
  "Harry O'Farrell":     { status: "MONTHS", detail: "Knee injury" },
  "Nic Newman":          { status: "WEEKS",  detail: "Patella injury, early-season return" },
  "Brodie Kemp":         { status: "WEEKS",  detail: "Ruptured Achilles, early-season return" },
  "Nick Haynes":         { status: "WEEKS",  detail: "Ankle, out opening fixtures" },
  "Matthew Cottrell":    { status: "WEEKS",  detail: "Foot, reassessed R2" },
  "Ollie Florent":       { status: "WEEKS",  detail: "Concussion" },

  // Collingwood
  "Darcy Moore":         { status: "DOUBT",  detail: "Calf injury, racing clock for R1" },
  "Beau McCreery":       { status: "DOUBT",  detail: "Foot surgery, racing clock" },
  "Jeremy Howe":         { status: "DOUBT",  detail: "Calf strain setback" },
  "Dan McStay":          { status: "WEEKS",  detail: "Shoulder/hamstring" },
  "Isaac Quaynor":       { status: "WEEKS",  detail: "Hamstring" },
  "Dan Houston":         { status: "WEEKS",  detail: "Hip" },
  "Bobby Hill":          { status: "WEEKS",  detail: "Extended leave, unclear return" },
  "Tew Jiath":           { status: "MONTHS", detail: "Knee" },
  "Reef McInnes":        { status: "MONTHS", detail: "ACL, early season return" },

  // Essendon
  "Nic Martin":          { status: "SEASON", detail: "Knee, out all 2026" },
  "Nick Bryan":          { status: "WEEKS",  detail: "ACL recovery, early-season return" },
  "Tom Edwards":         { status: "WEEKS",  detail: "ACL recovery, early-season return" },
  "Lewis Hayes":         { status: "WEEKS",  detail: "ACL recovery, early-season return" },
  "Jordan Ridley":       { status: "WEEKS",  detail: "Hamstring, out 6 weeks" },
  "Archie Perkins":      { status: "MANAGED",detail: "Groin, interrupted pre-season" },
  "Jye Caldwell":        { status: "DOUBT",  detail: "Knee concern" },
  "Isaac Kako":          { status: "DOUBT",  detail: "Hamstring strain" },

  // Fremantle
  "Sean Darcy":          { status: "DOUBT",  detail: "Calf strain" },
  "Sam Sturt":           { status: "MONTHS", detail: "ACL, back around R10" },
  "Luke Ryan":           { status: "WEEKS",  detail: "Shoulder" },
  "Aiden Riddle":        { status: "WEEKS",  detail: "Ankle" },

  // Geelong
  "Jeremy Cameron":      { status: "DOUBT",  detail: "Quad strain, no certainty for R1" },
  "Tyson Stengle":       { status: "WEEKS",  detail: "Personal issues, away from club" },
  "Toby Conway":         { status: "WEEKS",  detail: "Foot, won't be rushed" },
  "Harley Barker":       { status: "MONTHS", detail: "Knee ACL, majority of season" },

  // Gold Coast
  "Charlie Ballard":     { status: "WEEKS",  detail: "ACL recovery, miss R1" },
  "Matt Rowell":         { status: "DOUBT",  detail: "Broken finger" },
  "Beau Addinsall":      { status: "WEEKS",  detail: "High-grade hamstring, 4-6 weeks" },
  "Jai Murray":          { status: "WEEKS",  detail: "Femoral stress reaction, 4-6 weeks" },
  "Elliott Himmelberg":  { status: "MONTHS", detail: "ACL, mid-season target" },

  // GWS
  "Tom Green":           { status: "SEASON", detail: "ACL, out all season" },
  "Josh Kelly":          { status: "SEASON", detail: "Hip surgery, out most/all year" },
  "Darcy Jones":         { status: "MONTHS", detail: "ACL, possible late return" },
  "Sam Taylor":          { status: "MONTHS", detail: "High-grade hamstring" },
  "Toby Bedford":        { status: "WEEKS",  detail: "Hamstring, out 5-6 weeks" },
  "Finn Callaghan":      { status: "WEEKS",  detail: "Hip flexor, few weeks" },
  "Clayton Oliver":      { status: "MANAGED",detail: "Minor calf strain, managed minutes" },
  "Jesse Hogan":         { status: "WEEKS",  detail: "Foot" },

  // Hawthorn
  "Will Day":            { status: "MONTHS", detail: "Dislocated shoulder, targeting R14+" },
  "James Sicily":        { status: "MANAGED",detail: "Shoulder and hip, working back" },
  "Finn Maginness":      { status: "DOUBT",  detail: "Lacerated kidney" },

  // Melbourne
  "Jack Viney":          { status: "MONTHS", detail: "Achilles surgery, out first half" },
  "Jake Bowey":          { status: "MONTHS", detail: "Lisfranc fracture, out months" },
  "Max Gawn":            { status: "MANAGED",detail: "Finger fracture (played Origin, cleared)" },
  "Christian Salem":     { status: "MANAGED",detail: "Fitness concern, restricted to laps" },
  "Bailey Laurie":       { status: "WEEKS",  detail: "Fractured hand" },
  "Harry Sharp":         { status: "DOUBT",  detail: "Hamstring, possible early rounds" },
  "Jai Culley":          { status: "WEEKS",  detail: "Arm injury, out one month" },

  // North Melbourne
  "Jackson Archer":      { status: "SEASON", detail: "ACL, out all 2026" },
  "Blake Thredgold":     { status: "MONTHS", detail: "Lisfranc injury, out 6 months" },
  "Callum Coleman-Jones":{ status: "WEEKS",  detail: "Calf, pre-season ailment" },
  "Aidan Corr":          { status: "WEEKS",  detail: "Calf, pre-season ailment" },
  "George Wardlaw":      { status: "DOUBT",  detail: "Hamstring" },
  "Charlie Spargo":      { status: "DOUBT",  detail: "Shoulder, hopeful R1" },

  // Port Adelaide
  "Ivan Soldo":          { status: "SEASON", detail: "ACL, out all season" },
  "Sam Powell-Pepper":   { status: "MONTHS", detail: "ACL tear, mid-season return" },
  "Tom Cochrane":        { status: "MONTHS", detail: "Hamstring, out two months" },
  "Jason Horne-Francis": { status: "DOUBT",  detail: "Foot surgery + shoulder knock" },
  "Mitch Georgiades":    { status: "DOUBT",  detail: "Hamstring awareness, assessed post-Origin" },
  "Ollie Wines":         { status: "WEEKS",  detail: "Suspension, out first 2 rounds" },
  "Brandon Zerk-Thatcher":{ status: "WEEKS", detail: "Heel" },

  // Richmond
  "Judson Clarke":       { status: "MONTHS", detail: "ACL rupture, mid-year target" },
  "Tom Sims":            { status: "WEEKS",  detail: "Navicular foot surgery, not running" },
  "Josh Smillie":        { status: "WEEKS",  detail: "Quad surgery, early rounds" },
  "Nick Vlastuin":       { status: "DOUBT",  detail: "Ankle fracture, not certain R1" },
  "Dion Prestia":        { status: "MANAGED",detail: "Hamstring strain, not playing practice games" },
  "Sam Banks":           { status: "MANAGED",detail: "Foot stress, gradually rejoining" },

  // St Kilda
  "Max King":            { status: "MONTHS", detail: "Back stress fracture, out 6 months (debut)" },
  "Tom De Koning":       { status: "DOUBT",  detail: "Calf issue, likely R1" },
  "Jack Silvagni":       { status: "DOUBT",  detail: "Groin, likely R1" },
  "Liam Henry":          { status: "WEEKS",  detail: "Hamstring" },

  // Sydney
  "Taylor Adams":        { status: "DOUBT",  detail: "Achilles, likely miss R1" },
  "Callum Mills":        { status: "MANAGED",detail: "Hamstring, expected R1" },
  "Isaac Heeney":        { status: "MANAGED",detail: "Hamstring, expected R1" },
  "Harry Cunningham":    { status: "WEEKS",  detail: "Quad, miss 3-5 weeks" },
  "Jevan Phillipou":     { status: "WEEKS",  detail: "Quad, miss 5-7 weeks" },
  "Joel Amartey":        { status: "WEEKS",  detail: "Concussion" },
  "Brodie Grundy":       { status: "WEEKS",  detail: "Concussion" },
  "Ned Bowman":          { status: "WEEKS",  detail: "Hamstring, out 8 weeks" },

  // West Coast
  "Sam Allen":           { status: "MONTHS", detail: "ACL, miss season start" },
  "Jack Hutchinson":     { status: "WEEKS",  detail: "Ankle surgery" },
  "Brady Hough":         { status: "MANAGED",detail: "Ankle, working back" },
  "Bailey Williams":     { status: "DOUBT",  detail: "Groin, uncertain R1" },
  "Liam Duggan":         { status: "WEEKS",  detail: "Concussion" },
  "Elijah Hewett":       { status: "MANAGED",detail: "Calf, working back" },
  "Liam Baker":          { status: "WEEKS",  detail: "Suspension, out R2" },

  // Western Bulldogs
  "Cody Weightman":      { status: "MONTHS", detail: "Complex knee infection, return unclear" },
  "Ryley Sanders":       { status: "MANAGED",detail: "Bilateral hamstring, limited pre-season" },
  "Riley Garcia":        { status: "MONTHS", detail: "Hamstring, out 14 weeks" },
  "Adam Treloar":        { status: "DOUBT",  detail: "Calf/hamstring, doubtful R1" },
  "Lachlan Carmichael":  { status: "WEEKS",  detail: "Syndesmosis, out 2-3 weeks" },
  "Josh Dolan":          { status: "WEEKS",  detail: "Foot, out 2-3 weeks" },
  "Ed Richards":         { status: "WEEKS",  detail: "Shoulder" },
};

// Status display config
const INJURY_DISPLAY = {
  SEASON: { label: "OUT SEASON", color: "\x1b[31m" },   // red
  MONTHS: { label: "OUT MONTHS", color: "\x1b[33m" },   // yellow
  WEEKS:  { label: "OUT WEEKS",  color: "\x1b[33m" },   // yellow
  DOUBT:  { label: "DOUBT R1",   color: "\x1b[35m" },   // magenta
  MANAGED:{ label: "MANAGED",    color: "\x1b[36m" },   // cyan
};

module.exports = { INJURIES, INJURY_DISPLAY };
