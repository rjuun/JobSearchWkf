/**
 * Role-archetype requirement sets (Additive Plan · C2). A small, curated seed of
 * senior role shapes, each with ranked requirements phrased the way a JD would.
 * The Discover surface scores these against the user's graph with the SAME B6
 * requirement-alignment formula (lib/scoring) — no new scoring, just new inputs.
 *
 * `family` groups adjacent shapes so "Unexpected Doors" can prefer archetypes
 * outside the user's dominant family (an honest adjacency, not a random suggestion).
 */
export type Archetype = {
  key: string;
  title: string;
  family: 'Finance' | 'Transformation' | 'Operations' | 'Strategy' | 'Product' | 'People' | 'Risk';
  blurb: string;
  requirements: { requirement: string; rank: 'Core' | 'Important' | 'Nice-to-Have' }[];
};

export const ARCHETYPES: Archetype[] = [
  {
    key: 'cfo',
    title: 'Chief Financial Officer',
    family: 'Finance',
    blurb: 'Own the financial strategy, controls and forecasting of the whole business.',
    requirements: [
      { requirement: 'Financial planning, budgeting and forecasting at group level', rank: 'Core' },
      { requirement: 'Financial controlling and governance', rank: 'Core' },
      { requirement: 'Stakeholder management with board and investors', rank: 'Important' },
      { requirement: 'Team leadership across finance functions', rank: 'Important' },
      { requirement: 'M&A or capital allocation experience', rank: 'Nice-to-Have' },
    ],
  },
  {
    key: 'fin-controller',
    title: 'Group Financial Controller',
    family: 'Finance',
    blurb: 'Run consolidation, controls and reporting across entities.',
    requirements: [
      { requirement: 'Financial controlling and consolidation', rank: 'Core' },
      { requirement: 'Budgeting, forecasting and variance analysis', rank: 'Core' },
      { requirement: 'Process governance and internal controls', rank: 'Important' },
      { requirement: 'Stakeholder reporting', rank: 'Important' },
    ],
  },
  {
    key: 'transformation-director',
    title: 'Director of Transformation',
    family: 'Transformation',
    blurb: 'Lead enterprise change programmes end to end.',
    requirements: [
      { requirement: 'Leading large-scale transformation and change programmes', rank: 'Core' },
      { requirement: 'Operating model and process harmonisation', rank: 'Core' },
      { requirement: 'Stakeholder management across regions', rank: 'Important' },
      { requirement: 'Programme and project management', rank: 'Important' },
      { requirement: 'Change management and adoption', rank: 'Nice-to-Have' },
    ],
  },
  {
    key: 'chief-of-staff',
    title: 'Chief of Staff / CEO Associate',
    family: 'Strategy',
    blurb: 'The operating right hand to the CEO — strategy into execution.',
    requirements: [
      { requirement: 'Strategy development and execution', rank: 'Core' },
      { requirement: 'Cross-functional stakeholder management', rank: 'Core' },
      { requirement: 'Operating cadence and governance', rank: 'Important' },
      { requirement: 'Analysis and decision support for executives', rank: 'Important' },
    ],
  },
  {
    key: 'coo',
    title: 'Chief Operating Officer',
    family: 'Operations',
    blurb: 'Own operational delivery and performance across the business.',
    requirements: [
      { requirement: 'Operational leadership and performance management', rank: 'Core' },
      { requirement: 'Process optimisation and efficiency', rank: 'Core' },
      { requirement: 'Budget ownership and cost management', rank: 'Important' },
      { requirement: 'Cross-functional team leadership', rank: 'Important' },
    ],
  },
  {
    key: 'strategy-director',
    title: 'Director of Strategy',
    family: 'Strategy',
    blurb: 'Set the direction and translate it into concrete initiatives.',
    requirements: [
      { requirement: 'Corporate strategy and market analysis', rank: 'Core' },
      { requirement: 'Financial modelling and business cases', rank: 'Core' },
      { requirement: 'Executive stakeholder management', rank: 'Important' },
      { requirement: 'Initiative portfolio governance', rank: 'Nice-to-Have' },
    ],
  },
  {
    key: 'pmo-lead',
    title: 'Head of PMO / Programme Delivery',
    family: 'Operations',
    blurb: 'Run the portfolio of programmes and their governance.',
    requirements: [
      { requirement: 'Programme and portfolio management', rank: 'Core' },
      { requirement: 'Governance, reporting and controls', rank: 'Core' },
      { requirement: 'Stakeholder management', rank: 'Important' },
      { requirement: 'Budget and resource planning', rank: 'Important' },
    ],
  },
  {
    key: 'product-ops',
    title: 'Director of Product Operations',
    family: 'Product',
    blurb: 'Make the product org run — process, data and cross-team delivery.',
    requirements: [
      { requirement: 'Operational process design and optimisation', rank: 'Core' },
      { requirement: 'Cross-functional stakeholder management', rank: 'Core' },
      { requirement: 'Data-driven performance management', rank: 'Important' },
      { requirement: 'Product or delivery lifecycle knowledge', rank: 'Nice-to-Have' },
    ],
  },
  {
    key: 'risk-director',
    title: 'Director of Risk & Controls',
    family: 'Risk',
    blurb: 'Own the enterprise risk framework and its controls.',
    requirements: [
      { requirement: 'Risk framework, controls and governance', rank: 'Core' },
      { requirement: 'Financial and operational risk analysis', rank: 'Core' },
      { requirement: 'Stakeholder and board reporting', rank: 'Important' },
      { requirement: 'Regulatory and compliance awareness', rank: 'Nice-to-Have' },
    ],
  },
  {
    key: 'transformation-finance',
    title: 'Finance Transformation Lead',
    family: 'Transformation',
    blurb: 'Where finance meets change — modernise the finance operating model.',
    requirements: [
      { requirement: 'Finance process transformation and harmonisation', rank: 'Core' },
      { requirement: 'Budgeting, forecasting and controlling', rank: 'Core' },
      { requirement: 'Change and stakeholder management', rank: 'Important' },
      { requirement: 'Systems and data-driven improvement', rank: 'Nice-to-Have' },
    ],
  },
];

export function archetypeByKey(key: string): Archetype | undefined {
  return ARCHETYPES.find((a) => a.key === key);
}
