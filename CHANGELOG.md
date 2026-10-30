# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-30

### Added

- Wekan boards in Gladys: one device per followed board, with the open cards,
  the cards due today, the overdue cards, the done cards, the cards of each of
  the first five lists and the next due date.
- A choice of the followed boards, by name or id (all by default, 20 at
  most), and of the "done" lists (a card with an end date is done too).
- Login with the username (or e-mail) and password of a Wekan user.
- Dashboard widget "Today's cards": the cards due by tonight (10 at most),
  overdue first, with a button to finish each of the four most urgent; for
  every board or one, and a setting to hide the buttons on a shared screen.
- Scene triggers "New Wekan card" and "Wekan card moved" (board and list
  filters), "Wekan card due" and "Wekan card overdue" (at midnight), with the
  card, its board, its list and its due date as variables.
- Scene actions "Add a Wekan card" (board, list, title, optional due date),
  "Move a Wekan card" and "Read today's Wekan cards" (a sentence for a message
  or a voice announcement).
- Counters and events on time at each due time and local midnight, whatever
  the refresh interval (1 to 10 minutes).
- A "Test the connection" button and a connection status naming the problem.
- Every text in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-wekan/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-wekan/releases/tag/v1.0.0
