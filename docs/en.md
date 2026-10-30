# Wekan

Bring the kanban boards of your [Wekan](https://wekan.fi) into Gladys: the
cards due today, the overdue ones, the done ones, the next due date and the
number of cards in each list of a board. A scene reacts when a card is added,
arrives in a list (`Done`, `To check`…) or falls due, another one adds "buy
bread" from a button or moves a card from an NFC tag, a tap on the dashboard
finishes a card, and Gladys can read out the cards of the day every morning.

> **Feedback welcome.** This integration was tested against a real Wekan
> server (Docker image `wekanteam/wekan` of 30 October 2026, with MongoDB 7),
> not yet in everyday use. If something does not work as described, please say
> so on the [Gladys forum](https://community.gladysassistant.com) or in the
> [issues](https://github.com/guim31/gladys-wekan/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- A **self-hosted Wekan**, reachable from Gladys, with its REST API on
  (`WITH_API=true`, the default of the Docker image and of the Snap).
- The **username** (or e-mail) and **password** of a Wekan user who is a
  member of the boards to follow. It must be a **password account**: a user
  who logs in through LDAP, OAuth2 or another single sign-on cannot log in
  from Gladys. A dedicated user, added as a member of the boards, is a good
  idea.

The integration sees the boards this user sees, and acts **as this user**: the
cards added from Gladys show them as their author. A read-only member of a
board can follow it, but cannot add or move its cards.

## Set up

1. In Gladys, **Integrations** → install **Wekan**.
2. In the **Configuration** screen, fill in:
   - **Address**: the address of Wekan as in the browser, for example
     `http://192.168.1.20:8080`, or `https://kanban.example.org` behind a
     reverse proxy (a path prefix such as `/wekan` is kept);
   - **Username or e-mail** and **Password**.
3. Options:
   - **Followed boards**: names separated by commas (`Home, Shopping`), or
     the id of a board (in its address, after `/b/`). Empty: every board of the
     user, 20 at most;
   - **"Done" lists**: the lists whose cards count as done, by name, separated
     by commas. By default `Done, Fait, Terminé, Erledigt, Hecho`; case and
     accents do not matter. Empty: only the end dates count;
   - **Accept self-signed certificates**: for an `https://` address with a
     self-signed certificate, on your own server only;
   - **Refresh interval**: 1 to 10 minutes (5 by default). Due dates and
     midnight are always followed on time, whatever the interval;
   - **Language of the feature names**: the names given to the features when
     a device is added (French by default), and the texts sent to scenes.
4. Save, then **Test the connection**: it reads Wekan and gives the number of
   open cards and of followed boards.
5. In the **Discovery** tab, add the devices you want.

## Devices

**Wekan _board_** for each followed board, with these features:

| Feature           | What it says                                                                           |
| ----------------- | -------------------------------------------------------------------------------------- |
| `Open cards`      | the cards that are not done, nor archived                                              |
| `Cards due today` | open cards whose due date falls today, passed or not                                   |
| `Overdue cards`   | open cards whose due date has passed                                                   |
| `Done cards`      | the cards with an end date, or in a "done" list (archived cards are not counted)       |
| one per list      | the number of cards of each of the first five lists that are not "done" lists          |
| `Next due date`   | the card with the earliest due date still ahead, and its date; `None` if there is none |

A card is **done** when it has an **end date** (Wekan's "End" date), or when
it sits in one of the "done" lists of the configuration. "Today" is the day in
the time zone of Gladys. Cards of every swimlane are counted. Feature names
are set when the device is added: a list renamed later keeps its old name in
Gladys. A new list among the first five makes Gladys offer to update the
device in the **Discovery** tab.

## Dashboard

The **Today's cards** widget shows two tiles (due today, overdue), the list of
the cards due by tonight (10 at most), overdue first, with their time, their
list and their board, and a button for each of the four most urgent: a tap
**finishes the card** in Wekan (its end date becomes now). Choose a board
device in the widget settings to see only its cards; leave it empty for every
followed board. When nothing is due, the widget says so and gives the next
due date.

The counters can also go on the dashboard as any device feature.

## Scenes

### Triggers

- **New Wekan card**: a card appeared on a followed board: created, restored
  from the archive, or brought from another board. Filters: the board (a board
  device), the **list name**, exactly as written in Wekan (`To do`).
- **Wekan card moved**: a card arrived in another list of its board. Same
  filters. Information passed on to the actions also gives the previous list.
- **Wekan card due**: an open card reached its due time.
- **Wekan card overdue**: at midnight, a card due that day is still not done.
  Once per card and due date.

Filters of the last two: the board, the card name. Information passed on to
the actions: the card, its id, its board, its list, its due date.

A new card or a move is seen at the next reading: within the refresh interval.
A board just added to the followed ones brings no "new card". A card done
before its due time fires nothing, and a due date moved by hand to a moment
before the previous reading fires nothing either. A restart does not fire
anything twice; a card added or moved while the integration was stopped fires
when it starts again, and so does a due time less than an hour old.

### Actions

- **Add a Wekan card**: a title; the board by name (empty: the first followed
  board); the list by name (empty: its first list that is not a "done" list);
  an optional **due date**, in the time of Gladys: `2026-10-24 18:00`,
  `2026-10-24` (noon), or from now `+30m`, `+2h`, `+3d`. The card goes in the
  first swimlane of the board. Results: the card, its id, its board, its list,
  its due date.
- **Move a Wekan card**: the card by its exact name (case and accents
  ignored) or its id, the destination list by name, and the board if two
  boards hold a card of that name. Wekan puts it at the top of the list; a
  card in a "done" list can come back. Results: the card, its id, its board,
  its list, the previous list.
- **Read today's Wekan cards**: the cards due by tonight as a sentence
  (`3 card(s) due by tonight: …. 2 overdue.`), for every followed board or one
  of them. Results: the sentence, the number of cards due by tonight, of
  overdue cards. Send the sentence in a message, or have Gladys say it.

The fields accept scene variables: `{{triggerEvent.data.card}}` moves the card
that triggered the scene.

### Scene ideas

- At 7:30, **Read today's Wekan cards**, then send the sentence on Telegram.
- **New Wekan card** in the `Shopping` board: send it to the person doing the
  shopping.
- **Wekan card moved** to the `Done` list of the `Home` board: send "well done"
  to the family, or turn off the reminder light.
- When the washing machine stops, **Add a Wekan card** `Hang the laundry` in
  `To do`, due `+1h`.
- An NFC tag on the bins runs **Move a Wekan card** `Take out the bins` to
  `Done`.

## Troubleshooting

- **"Wekan does not answer"**: check the address and the port from the Gladys
  machine (the address opens Wekan in a browser).
- **"Username or password refused"**: the password changed, or the user logs
  in through LDAP or OAuth2: use a user with a password account.
- **"No Wekan API at this address"**: the address answers, but not with the
  Wekan REST API: check the port, the path prefix, and that `WITH_API` is not
  `false` in the Wekan settings.
- **"The address redirects"**: enter the `https://` address.
- **"This user may not do this"**: the user is only a read-only member of the
  board.
- **A board is missing**: the user must be a member of the board; a name typed
  in **Followed boards** that matches no board is ignored, and **Test the
  connection** lists it. Archived boards and templates are left out. Beyond
  20 boards, list the ones to follow.
- **A done card still counts as open**: give it an end date in Wekan, or add
  its list to the **"Done" lists**.
- **"Several cards have this name"**: give the board, or the id of the card.
- Logs: `LOG_LEVEL=debug` on the container shows every reading.

## Limits

- Wekan is read every 1 to 10 minutes (and at each due time and at midnight):
  a change in Wekan shows up in Gladys within that delay. Wekan's outgoing
  webhooks are not used.
- At each reading: the list of boards, then for each followed board its lists,
  its swimlanes and one request per swimlane. The login is kept in memory
  (Wekan gives it for 90 days) and done again only when Wekan refuses it.
- The integration adds cards, moves them and finishes them (end date); it does
  not edit, archive, delete or assign them, nor read their checklists, labels
  or comments.
- Archived cards, and the cards of archived lists, are left out: Wekan's API
  does not give them.
- Only the first five lists of a board that are not "done" lists get a
  counter.
- Gladys keeps no Wekan data beyond `/data/wekan-state.json` (the time of the
  last reading and the list of each card, so that no event fires twice).
- Not affiliated with Wekan or its authors.
