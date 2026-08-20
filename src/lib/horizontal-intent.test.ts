import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isHorizontalIntent, clampOffset, flingTarget, HORIZONTAL_THRESHOLD_PX, HORIZONTAL_RATIO } from "./horizontal-intent.ts"

describe("isHorizontalIntent", () => {
  it("returns true for clearly horizontal drag", () => {
    assert.equal(isHorizontalIntent({ dx: 20, dy: 1 }), true)
  })

  it("returns false for clearly vertical drag", () => {
    assert.equal(isHorizontalIntent({ dx: 2, dy: 30 }), false)
  })

  it("returns false for small movements below threshold", () => {
    assert.equal(isHorizontalIntent({ dx: 3, dy: 0 }), false)
  })

  it("returns false for diagonal that is more vertical than horizontal ratio", () => {
    assert.equal(isHorizontalIntent({ dx: 10, dy: 20 }), false)
  })

  it("returns true for diagonal that is more horizontal than ratio", () => {
    assert.equal(isHorizontalIntent({ dx: 20, dy: 10 }), true)
  })

  it("respects custom threshold", () => {
    assert.equal(isHorizontalIntent({ dx: 8, dy: 0, threshold: 10 }), false)
    assert.equal(isHorizontalIntent({ dx: 12, dy: 0, threshold: 10 }), true)
  })

  it("respects custom ratio", () => {
    assert.equal(isHorizontalIntent({ dx: 20, dy: 30, ratio: 0.5 }), true)
  })
})

describe("clampOffset", () => {
  it("returns 0 when maxOffset is 0 or negative", () => {
    assert.equal(clampOffset(100, 0), 0)
    assert.equal(clampOffset(100, -10), 0)
  })

  it("clamps to 0 for negative offset", () => {
    assert.equal(clampOffset(-50, 200), 0)
  })

  it("clamps to maxOffset for large offset", () => {
    assert.equal(clampOffset(300, 200), 200)
  })

  it("returns offset when within bounds", () => {
    assert.equal(clampOffset(100, 200), 100)
  })
})

describe("flingTarget", () => {
  it("projects forward with positive velocity", () => {
    const target = flingTarget(500, 100, 1000)
    assert.ok(target > 100, "fling target should be ahead of current offset")
    assert.ok(target <= 1000, "fling target should be clamped to max")
  })

  it("projects backward with negative velocity", () => {
    const target = flingTarget(-500, 500, 1000)
    assert.ok(target < 500, "fling target should be behind current offset")
    assert.ok(target >= 0, "fling target should not be negative")
  })

  it("clamps to maxOffset", () => {
    const target = flingTarget(10000, 900, 1000)
    assert.equal(target, 1000)
  })

  it("clamps to 0", () => {
    const target = flingTarget(-10000, 100, 1000)
    assert.equal(target, 0)
  })
})

describe("constants", () => {
  it("exports a threshold of 6", () => {
    assert.equal(HORIZONTAL_THRESHOLD_PX, 6)
  })

  it("exports a ratio of 0.7", () => {
    assert.equal(HORIZONTAL_RATIO, 0.7)
  })
})
