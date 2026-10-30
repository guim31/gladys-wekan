// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+). The fields
// are strings, so a scene variable fits too (`{{triggerEvent.data.card}}`).
//
//   - `add_card`: add a card to a list, with an optional due date ("buy
//     bread" from a button, "check the smoke detectors" every month);
//   - `move_card`: move a card to a list (an NFC tag by the washing machine
//     moves "Laundry" to Done);
//   - `read_today`: the cards due today and the overdue ones as a sentence,
//     for a message or a voice announcement in the morning.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async add_card(hub, { fields = {} }) {
    return hub.addCard(fields);
  },

  async move_card(hub, { fields = {} }) {
    return hub.moveCard(fields);
  },

  async read_today(hub, { fields = {} }) {
    return hub.today(fields.board);
  },
};
