# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the **username and password** of a Wekan user, stored by Gladys in the
  integration configuration (`secret` field for the password), sent only to
  the configured Wekan address (`POST /users/login`), and never logged. The
  login token Wekan answers is kept in memory only;
- under `/data`, only `wekan-state.json`: the configured address, the time of
  the last reading, the ids of the followed boards and, for each of their
  cards, its id and the ids of its board and list (no secret, no card name);
- network: outgoing HTTP(S) requests to the configured Wekan address only.
  With "Accept self-signed certificates" ticked, the certificate of that
  address is not verified.

Prefer a dedicated Wekan user, member of the followed boards only: its
password opens nothing else.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Wekan itself.
