// Tracks elapsed time only while a consumer is visible. Transitions settle the
// previous interval before changing state, so frequent scroll events cannot
// restart or erase the budget.
(function exposeVisibleTimeBudget(root) {
  class VisibleTimeBudget {
    constructor(limitMs) {
      this.limitMs = limitMs;
      this.elapsedMs = 0;
      this.visible = false;
      this.visibleSince = null;
    }

    setVisible(visible, now) {
      if (visible === this.visible) return false;
      if (this.visible) this.elapsedMs += Math.max(0, now - this.visibleSince);
      this.visible = visible;
      this.visibleSince = visible ? now : null;
      return true;
    }

    elapsedAt(now) {
      return this.elapsedMs + (this.visible ? Math.max(0, now - this.visibleSince) : 0);
    }

    expired(now) {
      return this.elapsedAt(now) >= this.limitMs;
    }
  }

  root.VisibleTimeBudget = VisibleTimeBudget;
})(globalThis);
