import assert from 'node:assert/strict';
import {
  hasBookNowOfferStarted,
  undispatchedBookNowOfferFilter,
} from '../utils/bookNowOfferState';

assert.equal(hasBookNowOfferStarted(undefined), false);
assert.equal(hasBookNowOfferStarted({}), false);
assert.equal(hasBookNowOfferStarted({ stage: null }), false);
assert.equal(hasBookNowOfferStarted({ stage: 'preferred' }), true);
assert.equal(hasBookNowOfferStarted({ stage: 'area_rule' }), true);
assert.equal(hasBookNowOfferStarted({ stage: 'all' }), true);
assert.equal(hasBookNowOfferStarted({ stage: 'closed' }), true);

const filter = undispatchedBookNowOfferFilter();
assert.ok(Array.isArray(filter.$or));
assert.ok(
  (filter.$or as Array<Record<string, unknown>>).some(
    (condition) =>
      (condition['assignmentOffer.stage'] as { $exists?: boolean } | undefined)
        ?.$exists === false,
  ),
  'Tasks with an offer object but no stage should be considered undispatched',
);

console.log('bookNowOfferState.test.ts: all tests passed');
