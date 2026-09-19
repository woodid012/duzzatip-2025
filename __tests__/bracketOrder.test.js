import { orderBracketWeeks } from '../src/app/lib/bracketOrder';

const weeks = [
  { round: 26, label: 'Qualifying & Elimination Finals' },
  { round: 27, label: 'Semi Finals' },
  { round: 28, label: 'Preliminary Finals' },
  { round: 29, label: 'Grand Final' },
];

const rounds = (ordered) => ordered.map((w) => w.round);

test('the live week leads, then back through the weeks behind it', () => {
  expect(rounds(orderBracketWeeks(weeks, 28))).toEqual([28, 27, 26]);
});

test('weeks that have not started yet are left out — the Grand Final included', () => {
  expect(rounds(orderBracketWeeks(weeks, 26))).toEqual([26]);
  expect(rounds(orderBracketWeeks(weeks, 27))).toEqual([27, 26]);
});

test('the Grand Final appears once it is the live week', () => {
  expect(rounds(orderBracketWeeks(weeks, 29))).toEqual([29, 28, 27, 26]);
});

test('no live week yet (or a decided comp parked past the end) shows them all', () => {
  expect(rounds(orderBracketWeeks(weeks, null))).toEqual([29, 28, 27, 26]);
  expect(rounds(orderBracketWeeks(weeks, undefined))).toEqual([29, 28, 27, 26]);
});

test('the input array is not reordered in place', () => {
  const input = [...weeks];
  orderBracketWeeks(input, 28);
  expect(rounds(input)).toEqual([26, 27, 28, 29]);
});

test('missing weeks are handled', () => {
  expect(orderBracketWeeks(undefined, 28)).toEqual([]);
  expect(orderBracketWeeks([], 28)).toEqual([]);
});
