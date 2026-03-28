// hyphenator.js — wrap the hyphen library, hyphenate style runs

export class Hyphenator {
  /**
   * @param {function} hyphenateSyncFn — e.g. hyphenModule.default.hyphenateSync
   */
  constructor(hyphenateSyncFn) {
    this._hyphenateSync = hyphenateSyncFn;
  }

  /**
   * Hyphenate an array of style runs by inserting soft hyphens.
   * @param {{ text: string, style: object }[]} runs
   * @returns {{ text: string, style: object }[]}
   */
  hyphenateRuns(runs) {
    return runs.map(run => ({
      text: this._hyphenateSync(run.text),
      style: run.style,
    }));
  }
}
