// hyphenator.js — wrap the hyphen library, hyphenate style runs

/** @typedef {import('./text-extract.js').Run} Run */

export class Hyphenator {
  /**
   * @param {function} hyphenateSyncFn — e.g. hyphenModule.default.hyphenateSync
   */
  constructor(hyphenateSyncFn) {
    this._hyphenateSync = hyphenateSyncFn;
  }

  /**
   * Hyphenate an array of style runs by inserting soft hyphens.
   * @param {Run[]} runs
   * @returns {Run[]}
   */
  hyphenateRuns(runs) {
    return runs.map(run => ({
      text: this._hyphenateSync(run.text),
      style: run.style,
    }));
  }
}
