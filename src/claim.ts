/**
 * The lab's negative claim, in exactly one place.
 *
 * Master template 4.1d: every lab declares at least one sentence naming a
 * security property the construction does NOT provide, scoped to what is on the
 * page rather than to the field. The page prints this string in two places
 * (exhibit 4's verdict and the scoping card) and `e2e/claims.spec.ts` asserts
 * both against this constant, so the claim cannot drift out of either.
 */
export const NEGATIVE_CLAIM =
  'A match says that an identifier this phone heard was derived from a reported key. ' +
  'It says nothing about whether the two people were near each other: in this scenario ' +
  'they never were, and the match is the same.'
