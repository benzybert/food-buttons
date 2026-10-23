// Activity log. Everything that happens in the system is recorded here, and the
// same record is what gets pushed to Instinct.
const { state, save, newId } = require("./state");
const instinct = require("./instinct");

const MAX_EVENTS = 500;

function record(type, actor, summary, data = {}) {
  const event = { id: newId(), type, at: new Date().toISOString(), actor, summary, data };
  if (instinct.enabled) event.pending = true;
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  state.rev++;
  save();
  instinct.flush();
  return event;
}

module.exports = { record };
