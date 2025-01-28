export const POSITIONS = {
  FULL_FORWARD: {
    name: 'Full Forward',
    calculation: (stats) => ({
      total: stats.goals * 9 + stats.behinds,
      breakdown: [
        stats.goals && `${stats.goals}G × 9`,
        stats.behinds && `${stats.behinds}B × 1`
      ].filter(Boolean)
    })
  },

  MIDFIELDER: {
    name: 'Midfielder',
    calculation: (stats) => {
      const disposals = stats.kicks + stats.handballs;
      const baseDisposals = Math.min(disposals, 30);
      const extraDisposals = Math.max(0, disposals - 30);
      return {
        total: baseDisposals + (extraDisposals * 3),
        breakdown: [
          baseDisposals && `First ${baseDisposals}D × 1`,
          extraDisposals && `Next ${extraDisposals}D × 3`
        ].filter(Boolean)
      };
    }
  },

  OFFENSIVE: {
    name: 'Offensive',
    calculation: (stats) => ({
      total: stats.goals * 7 + stats.kicks,
      breakdown: [
        stats.goals && `${stats.goals}G × 7`,
        stats.kicks && `${stats.kicks}K × 1`
      ].filter(Boolean)
    })
  },

  TALL_FORWARD: {
    name: 'Tall Forward',
    calculation: (stats) => ({
      total: stats.goals * 6 + stats.marks * 2,
      breakdown: [
        stats.goals && `${stats.goals}G × 6`,
        stats.marks && `${stats.marks}M × 2`
      ].filter(Boolean)
    })
  },

  TACKLER: {
    name: 'Tackler',
    calculation: (stats) => ({
      total: stats.tackles * 4 + stats.handballs,
      breakdown: [
        stats.tackles && `${stats.tackles}T × 4`,
        stats.handballs && `${stats.handballs}H × 1`
      ].filter(Boolean)
    })
  },

  RUCK: {
    name: 'Ruck',
    calculation: (stats) => {
      const totalHitoutsMarks = stats.hitouts + stats.marks;
      if (totalHitoutsMarks <= 18) {
        return {
          total: totalHitoutsMarks,
          breakdown: [
            stats.hitouts && `${stats.hitouts}HO × 1`,
            stats.marks && `${stats.marks}M × 1`
          ].filter(Boolean)
        };
      }
      const regularMarks = Math.max(0, 18 - stats.hitouts);
      const bonusMarks = stats.marks - regularMarks;
      return {
        total: stats.hitouts + regularMarks + (bonusMarks * 3),
        breakdown: [
          stats.hitouts && `${stats.hitouts}HO × 1`,
          regularMarks && `${regularMarks}M × 1`,
          bonusMarks && `${bonusMarks}M × 3 (bonus)`
        ].filter(Boolean)
      };
    }
  }
};