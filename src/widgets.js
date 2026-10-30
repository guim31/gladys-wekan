// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `cards_today`.
//
// The use case: the kitchen tablet shows the cards due today and the overdue
// ones (10 at most), and a tap finishes a card (its end date, in Wekan)
// without opening Wekan. For
// every followed board, or for one (a board device chosen in the widget
// settings).
//
// Budget (8 components, 2 texts): two tiles (due today, overdue), one status
// list (overdue first, then today's, with their time, list and board) and a
// "done" button for each of the four most urgent ones. Nothing left: a
// sentence and the next due date. The figures are values, not bound to device
// features, so the widget works before any device is added.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WekanHub, WIDGET_KEY } from './hub.js';
import { pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const DONE_ACTIONS = ['done_1', 'done_2', 'done_3', 'done_4'];
const MAX_ROWS = 10;

export const TEXT = {
  configure: {
    en: 'Enter the address of your Wekan, a username and a password in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre Wekan, un identifiant et un mot de passe dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Wekan, einen Benutzernamen und ein Passwort in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su Wekan, un usuario y una contraseña en la configuración de la integración.',
  },
  unknown: {
    en: 'This board is no longer followed: choose another device in the widget settings.',
    fr: "Ce tableau n'est plus suivi : choisissez un autre appareil dans les réglages du widget.",
    de: 'Dieses Board wird nicht mehr verfolgt: Wähle ein anderes Gerät in den Widget-Einstellungen.',
    es: 'Este tablero ya no se sigue: elija otro dispositivo en la configuración del widget.',
  },
  noAnswer: {
    en: 'Wekan does not answer: see the Configuration screen of the integration.',
    fr: "Wekan ne répond pas : voir l'écran Configuration de l'intégration.",
    de: 'Wekan antwortet nicht: Sieh dir die Konfiguration der Integration an.',
    es: 'Wekan no responde: consulte la pantalla de configuración de la integración.',
  },
  stale: {
    en: 'Wekan does not answer: last known cards.',
    fr: 'Wekan ne répond pas : dernières cartes connues.',
    de: 'Wekan antwortet nicht: zuletzt bekannte Karten.',
    es: 'Wekan no responde: últimas tarjetas conocidas.',
  },
  nothing: {
    en: 'No card due today.',
    fr: "Aucune carte due aujourd'hui.",
    de: 'Heute ist keine Karte fällig.',
    es: 'Ninguna tarjeta vence hoy.',
  },
  dueToday: { en: 'Due today', fr: "Aujourd'hui", de: 'Heute fällig', es: 'Para hoy' },
  overdue: { en: 'Overdue', fr: 'En retard', de: 'Überfällig', es: 'Atrasadas' },
  next: { en: 'Next', fr: 'Prochaine', de: 'Nächste', es: 'Próxima' },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

function format(hub, ms, language, options) {
  return new Intl.DateTimeFormat(LOCALES[language] ?? 'en-GB', {
    timeZone: hub.timeZone,
    ...options,
  }).format(new Date(ms));
}

/** The status row of a card: overdue, or its time; its list, and its board. */
function cardRow(hub, card, { now, showBoard, language }) {
  const late = card.dueAt < now;
  const when = late
    ? t(TEXT.overdue, language)
    : format(hub, card.dueAt, language, { hour: '2-digit', minute: '2-digit' });
  const where = [
    hub.listTitle(card.boardId, card.listId),
    showBoard ? hub.boardTitle(card.boardId) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    label: fit(card.name, 40),
    icon: late ? 'alert-circle' : 'clock',
    value: fit(where ? `${when} · ${where}` : when, 40),
    color: late ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
  };
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.configure, language);
  }
  if (hub.error && hub.readAt === 0) {
    return message(TEXT.noAnswer, language);
  }
  const { board, unknown } = hub.view(settings?.device || null);
  if (unknown) {
    return message(TEXT.unknown, language);
  }
  const now = hub.now();
  const summary = hub.summary(board);
  const components = [];
  if (hub.error) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.stale, language) });
  }
  components.push(
    { type: 'value', value: summary.dueToday, label: t(TEXT.dueToday, language), icon: 'calendar' },
    {
      type: 'value',
      value: summary.overdue,
      label: t(TEXT.overdue, language),
      icon: 'alert-circle',
      color: summary.overdue > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
  );
  if (summary.agenda.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.nothing, language) });
    if (summary.next) {
      const day = format(hub, summary.next.dueAt, language, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      components.push({
        type: 'status',
        items: [
          {
            label: fit(summary.next.name, 40),
            icon: 'calendar',
            value: fit(`${t(TEXT.next, language)} · ${day}`, 40),
            color: WIDGET_COLORS.NEUTRAL,
          },
        ],
      });
    }
    return { ttl_seconds: 300, components };
  }
  components.push({
    type: 'status',
    items: summary.agenda
      .slice(0, MAX_ROWS)
      .map((card) => cardRow(hub, card, { now, showBoard: !board, language })),
  });
  if (!hub.error) {
    summary.agenda.slice(0, DONE_ACTIONS.length).forEach((card, index) => {
      components.push({
        type: 'button',
        label: fit(card.name, 24),
        icon: 'check',
        style: 'secondary',
        action: { key: DONE_ACTIONS[index], params: { id: card.id } },
      });
    });
  }
  return { ttl_seconds: 300, components };
}

async function action(hub, { actionKey, params = {} }) {
  if (!DONE_ACTIONS.includes(actionKey) || typeof params.id !== 'string') {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const card = await hub.completeCard(params.id);
  return { message: WekanHub.doneMessage(card.name) };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
