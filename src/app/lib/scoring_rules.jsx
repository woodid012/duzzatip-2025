export const POSITIONS = {
  FORWARD: {
    name: 'Forward',
    calculation: (stats) => {
      const points = stats.goals * 9 + stats.behinds;
      return {
        total: points,
        breakdown: [
          stats.goals ? `${stats.goals} goals × 9 = ${stats.goals * 9}` : null,
          stats.behinds ? `${stats.behinds} behinds × 1 = ${stats.behinds}` : null
        ].filter(Boolean)
      };
    }
  },
  
  TALL_FORWARD: {
    name: 'Tall Forward',
    calculation: (stats) => {
      const points = stats.goals * 6 + stats.marks * 2;
      return {
        total: points,
        breakdown: [
          stats.goals ? `${stats.goals} goals × 6 = ${stats.goals * 6}` : null,
          stats.marks ? `${stats.marks} marks × 2 = ${stats.marks * 2}` : null
        ].filter(Boolean)
      };
    }
  },
  
  OFFENSIVE: {
    name: 'Offensive',
    calculation: (stats) => {
      const points = stats.goals * 7 + stats.kicks;
      return {
        total: points,
        breakdown: [
          stats.goals ? `${stats.goals} goals × 7 = ${stats.goals * 7}` : null,
          stats.kicks ? `${stats.kicks} kicks × 1 = ${stats.kicks}` : null
        ].filter(Boolean)
      };
    }
  },
  
  MIDFIELDER: {
    name: 'Midfielder',
    calculation: (stats) => {
      const basePoints = Math.min(stats.disposals, 30);
      const extraDisposals = Math.max(0, stats.disposals - 30);
      const extraPoints = extraDisposals * 3;
      return {
        total: basePoints + extraPoints,
        breakdown: [
          basePoints ? `First ${basePoints} disposals × 1 = ${basePoints}` : null,
          extraDisposals ? `Extra ${extraDisposals} disposals × 3 = ${extraPoints}` : null
        ].filter(Boolean)
      };
    }
  },
  
  TACKLER: {
    name: 'Tackler',
    calculation: (stats) => {
      const points = stats.tackles * 4 + stats.handballs;
      return {
        total: points,
        breakdown: [
          stats.tackles ? `${stats.tackles} tackles × 4 = ${stats.tackles * 4}` : null,
          stats.handballs ? `${stats.handballs} handballs × 1 = ${stats.handballs}` : null
        ].filter(Boolean)
      };
    }
  },
  
  RUCK: {
    name: 'Ruck',
    calculation: (stats) => {
      const total = stats.hitouts + stats.marks;
      let points = 0;
      let breakdown = [];

      if (total <= 18) {
        points = stats.hitouts + stats.marks;
        breakdown = [
          stats.hitouts ? `${stats.hitouts} hitouts × 1 = ${stats.hitouts}` : null,
          stats.marks ? `${stats.marks} marks × 1 = ${stats.marks}` : null
        ];
      } else {
        const regularMarks = Math.max(0, 18 - stats.hitouts);
        const tripleMarks = stats.marks - regularMarks;
        points = stats.hitouts + regularMarks + (tripleMarks * 3);
        breakdown = [
          stats.hitouts ? `${stats.hitouts} hitouts × 1 = ${stats.hitouts}` : null,
          regularMarks > 0 ? `${regularMarks} marks × 1 = ${regularMarks}` : null,
          tripleMarks > 0 ? `${tripleMarks} marks × 3 = ${tripleMarks * 3} (bonus)` : null
        ];
      }
      
      return {
        total: points,
        breakdown: breakdown.filter(Boolean)
      };
    }
  }
};