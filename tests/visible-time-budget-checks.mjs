import test from 'node:test';
import assert from 'node:assert/strict';
import '../web/visible-time-budget.js';

const VisibleTimeBudget = globalThis.VisibleTimeBudget;

test('continuous scrolling does not reset elapsed visible time', () => {
  const budget = new VisibleTimeBudget(60000);
  budget.setVisible(true, 0);
  for (let now = 10; now <= 70000; now += 1000) {
    budget.setVisible(true, now);
  }
  assert.equal(budget.elapsedAt(70000), 70000);
  assert.equal(budget.expired(70000), true);
});

test('background and offscreen intervals are excluded and visibility transitions settle intervals', () => {
  const budget = new VisibleTimeBudget(60000);
  budget.setVisible(true, 0);
  budget.setVisible(false, 10000);
  assert.equal(budget.elapsedAt(40000), 10000);
  budget.setVisible(true, 40000);
  assert.equal(budget.elapsedAt(50000), 20000);
  budget.setVisible(false, 50000);
  assert.equal(budget.elapsedAt(100000), 20000);
  budget.setVisible(true, 100000);
  assert.equal(budget.expired(140000), true);
  assert.equal(budget.expired(139999), false);
});

test('repeated same-state events neither settle nor restart a visible interval', () => {
  const budget = new VisibleTimeBudget(60000);
  budget.setVisible(true, 0);
  for (let now = 10; now <= 70000; now += 1000) budget.setVisible(true, now);
  assert.equal(budget.elapsedAt(70000), 70000);
});
