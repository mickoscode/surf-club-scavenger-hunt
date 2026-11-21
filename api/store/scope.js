'use strict';
// The name a store keeps an event's player data under. Event names are validated (lower case letters, digits, hyphens), so a name
// can never contain the "#" that separates parts of a key. A game loaded from no event (only tests do that) uses "_none".
const { isEventName } = require('../lib/events');

const NO_EVENT = '_none';

function eventScope(event) {
  if (event === null || event === undefined) return NO_EVENT;
  if (!isEventName(event)) throw new Error('not a valid event name');
  return event;
}

module.exports = { eventScope, NO_EVENT };
