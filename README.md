# Wekan for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the kanban boards of a self-hosted [Wekan](https://wekan.fi) into
Gladys, over the local network: the cards due today, the overdue ones, the
done ones, the number of cards in each list, scene triggers when a card is
added, arrives in a list or falls due, and cards added or moved from a scene
or finished from the dashboard.

> **Feedback welcome.** The integration was checked against a real Wekan
> server (Docker image `wekanteam/wekan` of 30 October 2026, with MongoDB 7),
> but not yet in everyday use with a real Gladys. Please report what works and
> what does not in the [issues](https://github.com/guim31/gladys-wekan/issues).

## Features

- **One device per followed board** (all by default, or a list of names),
  with _open cards_, _cards due today_, _overdue cards_, _done cards_, one
  counter per list (the first five that are not "done" lists) and the _next
  due date_ (text). A card is done when it has an end date, or sits in one of
  the "done" lists of the configuration (`Done, Fait, Terminé, Erledigt,
Hecho` by default).
- **Dashboard widget** "Today's cards": two tiles, the cards due by tonight
  (10 at most, overdue first, time, list, board) and a button to finish each
  of the four most urgent (end date set to now); for every board or one.
- **Scene triggers**: _New Wekan card_ and _Wekan card moved_ (filters on the
  board and the list), _Wekan card due_ and _Wekan card overdue_ (at midnight,
  the card of the day still undone); the card, its board, its list (and the
  previous one) and its due date as variables. Once each, across restarts.
- **Scene actions**: _Add a Wekan card_ (board, list, title, optional due
  date such as `2026-10-24 18:00` or `+2h`), _Move a Wekan card_ (by name, to
  a list by name) and _Read today's Wekan cards_ (a sentence for a message or
  a voice announcement).
- On time: besides the refresh interval (1 to 10 minutes, 5 by default), the
  integration reads Wekan at each due time and at local midnight (the time
  zone of Gladys).
- A **Test the connection** button, a connection status that names the
  problem (password refused, no Wekan API at this address, certificate…), and
  a transport badge per device.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- A **self-hosted Wekan**, reachable from Gladys, with its REST API on
  (`WITH_API=true`, the default), and the **username (or e-mail) and
  password** of a Wekan user with a password account (not LDAP or OAuth2),
  member of the boards to follow. The integration acts as this user.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-wekan`
   (or install **Wekan** from the catalog once it is listed).
2. In **Configuration**, enter the address of Wekan
   (`http://192.168.1.20:8080`, `https://kanban.example.org`…), the username
   and the password. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

The integration uses the REST API of Wekan, with a login token
(`POST /users/login`, valid 90 days) in `Authorization: Bearer`:

| Request                                              | Use                                                   |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `POST /users/login`                                  | login (once, and again when Wekan refuses the token)  |
| `GET /api/users/{user}/boards`                       | the boards of the user                                |
| `GET /api/boards/{board}/lists`                      | the lists of a followed board (not archived)          |
| `GET /api/boards/{board}/swimlanes`                  | its swimlanes                                         |
| `GET /api/boards/{board}/swimlanes/{swimlane}/cards` | its cards, with their list, due date and end date     |
| `POST /api/boards/{board}/lists/{list}/cards`        | add a card (first swimlane)                           |
| `PUT /api/boards/{board}/lists/{list}/cards/{card}`  | set a due date, move a card (`listId`), finish a card |

The cards are read per swimlane: the list endpoint of Wekan gives neither the
due date nor the end date. Wekan is read on a timer of the container; the
devices are published with `should_poll: false`. States are published only
when they change, and every 12 hours otherwise. A new card is a card unknown
at the previous reading on a board already read; a move is a card whose list
changed between two readings; the due events are the moments (due time, end of
the due day) crossed since the previous reading. The time of the last reading
and the list of each card are kept in `/data/wekan-state.json`. Wekan's
outgoing webhooks are not used: a reading every few minutes is enough for
these uses, and needs no change on the Wekan side.

## Checked on a real Wekan, and what was not

Checked against `wekanteam/wekan` (image `latest` of 30 October 2026) with
MongoDB 7 in a Docker network: a user registered and logged in through the
API (by username and by e-mail), two boards, four lists, two swimlanes, cards
due in the past, today (one with an end date), tomorrow, later and never, one
in a "done" list, one archived; cards created, moved and finished through the
API; the error answers (wrong password, wrong token, missing board, list of
another board, missing card, the HTML page outside the API). The real answers
are in `test/fixtures/wekan/` and drive the tests; the integration ran in its
own container under the Gladys sandbox limits (read-only root, no
capabilities, 256 MB) against that server, against the SDK's fake Gladys.

Not checked: a real Gladys instance, a read-only board member (the 403 is
assumed), Wekan behind a reverse proxy with a path prefix, older Wekan
versions (the routes used have existed for years, the due and end dates on
the swimlane cards were checked on the recent image only).

## Limitations

- Adds cards, moves them and finishes them (end date); does not edit,
  archive, delete or assign them, nor read their checklists, labels or
  comments.
- A change made in Wekan shows up within the refresh interval.
- Up to 20 boards are read; per board, two requests and one per swimlane at
  each reading.
- Archived cards, and the cards of archived lists, are not seen (the API does
  not give them).

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Wekan (`test/helpers/fakeWekan.js`) built from real answers.
See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Wekan](https://github.com/wekan/wekan) by Lauri Ojansivu and its
  contributors (MIT): the integration only talks to its API; no code was
  copied. The cover uses the official Wekan logo shipped with the web app
  (`public/wekan-logo.svg`), to name the service.
- The architecture, the scene triggers and actions, the widget and the
  conformity tests follow [gladys-planka](https://github.com/guim31/gladys-planka),
  itself built on [gladys-vikunja](https://github.com/guim31/gladys-vikunja)
  and [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Wekan or its
authors. The Wekan name and logo belong to their owners.

## License

Apache-2.0
