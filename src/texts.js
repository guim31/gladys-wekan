// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene action
// errors and results. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './wekan/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Wekan in the configuration.',
    fr: "Saisissez l'adresse de votre Wekan dans la configuration.",
    de: 'Gib die Adresse deines Wekan in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Wekan en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.20:3000',
    fr: 'Adresse incomprise, ex. http://192.168.1.20:3000',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.20:3000',
    es: 'Dirección no válida, p. ej. http://192.168.1.20:3000',
  },
  noCredentials: {
    en: 'Enter the username and password of a Wekan user in the configuration.',
    fr: "Saisissez l'identifiant et le mot de passe d'un utilisateur de Wekan dans la configuration.",
    de: 'Gib in der Konfiguration Benutzername und Passwort eines Wekan-Benutzers ein.',
    es: 'Introduzca el usuario y la contraseña de un usuario de Wekan en la configuración.',
  },
};

// One short explanation per error kind (src/wekan/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Wekan does not answer',
    fr: 'Wekan ne répond pas',
    de: 'Wekan antwortet nicht',
    es: 'Wekan no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'username or password refused (a password account, not LDAP or OAuth?)',
    fr: 'identifiant ou mot de passe refusé (un compte à mot de passe, pas LDAP ni OAuth ?)',
    de: 'Benutzername oder Passwort abgelehnt (ein Passwortkonto, nicht LDAP oder OAuth?)',
    es: 'usuario o contraseña rechazados (¿una cuenta con contraseña, no LDAP ni OAuth?)',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'this user may not do this (read-only board member?)',
    fr: "cet utilisateur n'a pas ce droit (membre en lecture seule ?)",
    de: 'dieser Benutzer darf das nicht (nur lesendes Board-Mitglied?)',
    es: 'este usuario no tiene este permiso (¿miembro de solo lectura?)',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'board, list or card not found',
    fr: 'tableau, liste ou carte introuvable',
    de: 'Board, Liste oder Karte nicht gefunden',
    es: 'tablero, lista o tarjeta no encontrados',
  },
  [ERROR_KINDS.NOT_WEKAN]: {
    en: 'no Wekan API at this address (WITH_API turned off?)',
    fr: 'aucune API Wekan à cette adresse (WITH_API désactivé ?)',
    de: 'keine Wekan-API unter dieser Adresse (WITH_API deaktiviert?)',
    es: 'no hay ninguna API de Wekan en esta dirección (¿WITH_API desactivado?)',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'too many requests, retrying later',
    fr: 'trop de requêtes, nouvel essai plus tard',
    de: 'zu viele Anfragen, neuer Versuch später',
    es: 'demasiadas solicitudes, se reintentará más tarde',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: (cards, boards) => `Wekan OK: ${cards} open card(s) in ${boards} followed board(s).`,
    failed: (reason) => `Wekan: ${reason}.`,
  },
  fr: {
    ok: (cards, boards) =>
      `Wekan OK : ${cards} carte(s) ouverte(s) dans ${boards} tableau(x) suivi(s).`,
    failed: (reason) => `Wekan : ${reason}.`,
  },
  de: {
    ok: (cards, boards) => `Wekan OK: ${cards} offene Karte(n) in ${boards} verfolgten Board(s).`,
    failed: (reason) => `Wekan: ${reason}.`,
  },
  es: {
    ok: (cards, boards) =>
      `Wekan OK: ${cards} tarjeta(s) abierta(s) en ${boards} tablero(s) seguido(s).`,
    failed: (reason) => `Wekan: ${reason}.`,
  },
};

// Logged and shown when a board typed in the configuration does not exist.
export const UNKNOWN_BOARDS = {
  en: (names) => `Unknown board(s) ignored: ${names}.`,
  fr: (names) => `Tableau(x) inconnu(s) ignoré(s) : ${names}.`,
  de: (names) => `Unbekannte(s) Board(s) ignoriert: ${names}.`,
  es: (names) => `Tablero(s) desconocido(s) ignorado(s): ${names}.`,
};

// Errors of the scene actions and the widget buttons (shown in Gladys).
export const ACTION_TEXT = {
  notConfigured: {
    en: 'Wekan is not configured.',
    fr: "Wekan n'est pas configuré.",
    de: 'Wekan ist nicht konfiguriert.',
    es: 'Wekan no está configurado.',
  },
  emptyTitle: {
    en: 'Give the title of the new card.',
    fr: 'Indiquez le titre de la nouvelle carte.',
    de: 'Gib den Titel der neuen Karte an.',
    es: 'Indique el título de la nueva tarjeta.',
  },
  emptyCard: {
    en: 'Give the name of the card to move.',
    fr: 'Indiquez le nom de la carte à déplacer.',
    de: 'Gib den Namen der zu verschiebenden Karte an.',
    es: 'Indique el nombre de la tarjeta que se va a mover.',
  },
  emptyList: {
    en: 'Give the list to move the card to.',
    fr: 'Indiquez la liste où déplacer la carte.',
    de: 'Gib die Liste an, in die die Karte soll.',
    es: 'Indique la lista a la que mover la tarjeta.',
  },
  badDue: {
    en: 'Due date not understood: 2026-10-24 18:00, 2026-10-24, +2h or +3d.',
    fr: 'Échéance incomprise : 2026-10-24 18:00, 2026-10-24, +2h ou +3d.',
    de: 'Fälligkeit nicht verstanden: 2026-10-24 18:00, 2026-10-24, +2h oder +3d.',
    es: 'Vencimiento no válido: 2026-10-24 18:00, 2026-10-24, +2h o +3d.',
  },
  boardNotFound: {
    en: 'No board has this name in Wekan (or it is not followed).',
    fr: "Aucun tableau ne porte ce nom dans Wekan (ou il n'est pas suivi).",
    de: 'Kein Board in Wekan hat diesen Namen (oder es wird nicht verfolgt).',
    es: 'Ningún tablero tiene este nombre en Wekan (o no se sigue).',
  },
  boardAmbiguous: {
    en: 'Several boards have this name: give its id (in its address) instead.',
    fr: 'Plusieurs tableaux portent ce nom : indiquez plutôt son identifiant (dans son adresse).',
    de: 'Mehrere Boards haben diesen Namen: Gib stattdessen seine ID an (in seiner Adresse).',
    es: 'Varios tableros tienen este nombre: indique su identificador (en su dirección).',
  },
  noBoard: {
    en: 'Wekan has no board to add the card to.',
    fr: "Wekan n'a aucun tableau où ajouter la carte.",
    de: 'Wekan hat kein Board, in das die Karte kann.',
    es: 'Wekan no tiene ningún tablero donde añadir la tarjeta.',
  },
  listNotFound: {
    en: 'No list of this board has this name.',
    fr: 'Aucune liste de ce tableau ne porte ce nom.',
    de: 'Keine Liste dieses Boards hat diesen Namen.',
    es: 'Ninguna lista de este tablero tiene este nombre.',
  },
  listAmbiguous: {
    en: 'Several lists of this board have this name: give its id instead.',
    fr: 'Plusieurs listes de ce tableau portent ce nom : indiquez plutôt son identifiant.',
    de: 'Mehrere Listen dieses Boards haben diesen Namen: Gib stattdessen ihre ID an.',
    es: 'Varias listas de este tablero tienen este nombre: indique su identificador.',
  },
  noList: {
    en: 'This board has no list (or no swimlane).',
    fr: "Ce tableau n'a aucune liste (ou aucun couloir).",
    de: 'Dieses Board hat keine Liste (oder keine Swimlane).',
    es: 'Este tablero no tiene ninguna lista (o ningún carril).',
  },
  cardNotFound: {
    en: 'No card of the followed boards has this name.',
    fr: 'Aucune carte des tableaux suivis ne porte ce nom.',
    de: 'Keine Karte der verfolgten Boards hat diesen Namen.',
    es: 'Ninguna tarjeta de los tableros seguidos tiene este nombre.',
  },
  cardAmbiguous: {
    en: 'Several cards have this name: give the board, or the id of the card.',
    fr: "Plusieurs cartes portent ce nom : indiquez le tableau, ou l'identifiant de la carte.",
    de: 'Mehrere Karten haben diesen Namen: Gib das Board oder die ID der Karte an.',
    es: 'Varias tarjetas tienen este nombre: indique el tablero o el identificador de la tarjeta.',
  },
  alreadyDone: {
    en: 'This card was already done meanwhile: the list is refreshed.',
    fr: 'Cette carte a déjà été terminée entre-temps : la liste est mise à jour.',
    de: 'Diese Karte wurde inzwischen schon erledigt: Die Liste wird aktualisiert.',
    es: 'Esta tarjeta ya se ha terminado entretanto: la lista se actualiza.',
  },
};

// Toast of a widget button (≤ 200 characters).
export const DONE_TEXT = {
  en: (name) => `"${name}": done.`,
  fr: (name) => `« ${name} » : terminée.`,
  de: (name) => `„${name}“: erledigt.`,
  es: (name) => `«${name}»: terminada.`,
};

// The sentence of the "Read today's cards" scene action, for a message or a
// voice announcement.
const join = (names, and) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`;

export const TODAY_TEXT = {
  en: {
    none: 'No card due today.',
    list: (count, names) => `${count} card(s) due by tonight: ${join(names, 'and')}.`,
    overdue: (count) => ` ${count} overdue.`,
  },
  fr: {
    none: "Aucune carte due aujourd'hui.",
    list: (count, names) => `${count} carte(s) à finir ce soir : ${join(names, 'et')}.`,
    overdue: (count) => ` ${count} en retard.`,
  },
  de: {
    none: 'Heute ist keine Karte fällig.',
    list: (count, names) => `${count} Karte(n) bis heute Abend fällig: ${join(names, 'und')}.`,
    overdue: (count) => ` ${count} überfällig.`,
  },
  es: {
    none: 'Ninguna tarjeta vence hoy.',
    list: (count, names) => `${count} tarjeta(s) para esta noche: ${join(names, 'y')}.`,
    overdue: (count) => ` ${count} atrasada(s).`,
  },
};

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A multi-language object from a function of the language. */
export const allLanguages = (render) =>
  Object.fromEntries(Object.keys(INIT_FAILED).map((language) => [language, render(language)]));
