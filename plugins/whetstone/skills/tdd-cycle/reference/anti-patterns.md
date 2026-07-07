# Test anti-patterns

Three ways a test looks green but earns nothing, from Matt Pocock's tdd notes. Reject a drafted test against these **before** running `run_slice red`.

## Implementation-coupled

The test asserts *how* the code works, not *what* it does — it reaches into private helpers, internal state, or a specific call sequence.

- **Smell:** the test breaks when you refactor without changing behaviour.
- **Fix:** assert through the public seam only. If you must touch internals to observe the outcome, the seam is wrong — renegotiate it.

## Tautological

The test restates the implementation, so it can never fail for a real reason (`expect(add(2, 2)).toBe(2 + 2)`, or a mock asserted to return exactly what it was told to return).

- **Smell:** you can't imagine a bug this test would catch.
- **Fix:** assert a concrete expected value (`toBe(4)`), and mock only true external boundaries — never the unit under test.

## Horizontal slicing

Testing a whole layer at once ("all the validators", "the entire mapper") instead of one thin vertical slice of behaviour end-to-end.

- **Smell:** the RED step lights up ten unrelated failures; you can't tell which line of production code the next GREEN belongs to.
- **Fix:** one behaviour per cycle, through the seam, from input to observable output. Add the next behaviour as the next slice.

## The check

If a drafted test trips any of these, rewrite it before `run_slice red`. A test that fails for the wrong reason is worse than no test — it makes a false claim of coverage.
