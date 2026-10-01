/**
 * config-schema.mjs — the plugin's `Config` (0.1.7 settings schema).
 *
 * 0.1.7's settings surface derives ONE form per active profile entry from
 * `entry.fiber.runtime.Config` (see `@deepseek-ai/dsh-settings`:
 * `SettingsForms#schema` returns `entry.fiber.runtime.Config`), and only fields
 * marked `.volatile()` are editable — an entry whose Config has no volatile
 * field is not configurable at all and its legacy `settings.yaml` section is
 * dropped on import.
 *
 * Volatile fields are handed to `apply()` as LIVE REFERENCES (objects exposing
 * `get()`/`set()`), and the Loader commits a settings edit into them in place
 * and then emits `loader/volatile-update`, so a change applies without
 * remounting the plugin. `readLive()` below reads either form.
 *
 * The schema deliberately mirrors the shape `config.mjs` already accepts, so
 * the same object feeds both the CLI/tests (plain JSON) and the settings form.
 */
import Schema from '@deepseek-ai/schemastery';

/** Channel section keys, in the order the settings page shows them. */
export const CHANNEL_KEYS = Object.freeze(['bark', 'ntfy', 'serverchan', 'webhook']);

/** A server URL; empty means "use the channel's built-in default". */
const serverField = (fallback) => Schema.string().default(fallback).volatile();

/**
 * One webhook-family channel section. `kind` is kept so an existing config that
 * spells the preset out explicitly still round-trips.
 *
 * `sounds` — the per-event ringtone map — is deliberately NOT a nested dict:
 * schemastery rejects volatile fields inside a dict (their keys are not fixed
 * at schema time), and a non-volatile dict would be invisible to the settings
 * form. The event names are a closed set (`format.mjs` EVENT_META), so each one
 * gets its own optional scalar field and `apply()` folds them back into the
 * `sounds` map the channel layer already understands.
 */
const BARK_SOUNDS = Schema.object({
  'awaiting-approval': Schema.string().default('').volatile(),
  'awaiting-answer': Schema.string().default('').volatile(),
  error: Schema.string().default('').volatile(),
  stopped: Schema.string().default('').volatile(),
  interrupted: Schema.string().default('').volatile(),
  truncated: Schema.string().default('').volatile(),
  blocked: Schema.string().default('').volatile(),
  idle: Schema.string().default('').volatile(),
}).default({});

const barkSchema = Schema.object({
  enabled: Schema.boolean().default(false).volatile(),
  server: serverField('https://api.day.app'),
  deviceKey: Schema.string().role('secret').default('').volatile(),
  sound: Schema.string().default('').volatile(),
  sounds: BARK_SOUNDS,
  // Bark's notification group. Several machines may share one Bark server, in
  // which case an unset group lumps every push into the app's "默认" bucket and
  // they cannot be told apart. Left empty here because the value depends on the
  // running host; `config.mjs` fills it with the machine's hostname.
  group: Schema.string().default('').volatile(),
  kind: Schema.string().default('bark').volatile(),
});

/**
 * Notification titles, one field per event.
 *
 * The title is what every channel puts on the notification (`title` in the Bark
 * and ntfy JSON bodies, the Toast heading on Windows, the subject line of a
 * generic webhook). `format.mjs` ships a built-in title per event; a non-empty
 * value here overrides it, and an empty value falls back to the built-in. That
 * keeps the shipped wording as the default while letting the user rename the
 * notification without editing code.
 *
 * Same reasoning as {@link BARK_SOUNDS}: a `dict` cannot hold volatile fields
 * and a non-volatile one is invisible to the settings form, so the closed event
 * set is spelled out field by field.
 */
const TITLE_BY_EVENT_FIELDS = Schema.object({
  idle: Schema.string().default('').volatile(),
  error: Schema.string().default('').volatile(),
  blocked: Schema.string().default('').volatile(),
  'goal-completed': Schema.string().default('').volatile(),
  stopped: Schema.string().default('').volatile(),
  interrupted: Schema.string().default('').volatile(),
  truncated: Schema.string().default('').volatile(),
  'awaiting-approval': Schema.string().default('').volatile(),
  'awaiting-answer': Schema.string().default('').volatile(),
}).default({});

const ntfySchema = Schema.object({
  enabled: Schema.boolean().default(false).volatile(),
  server: serverField('https://ntfy.sh'),
  topic: Schema.string().default('').volatile(),
  token: Schema.string().role('secret').default('').volatile(),
  kind: Schema.string().default('ntfy').volatile(),
});

const serverchanSchema = Schema.object({
  enabled: Schema.boolean().default(false).volatile(),
  sendKey: Schema.string().role('secret').default('').volatile(),
  kind: Schema.string().default('serverchan').volatile(),
});

const webhookSchema = Schema.object({
  enabled: Schema.boolean().default(false).volatile(),
  url: Schema.string().default('').volatile(),
  headers: Schema.dict(Schema.string()).default({}).volatile(),
  kind: Schema.string().default('generic').volatile(),
});

/**
 * The plugin's editable configuration.
 *
 * Every `.volatile()` mark sits on a LEAF at a fixed object path — schemastery
 * rejects a volatile field with an enclosing volatile field
 * ("volatile fields require a fixed object path without an enclosing volatile
 * field"), and it rejects `dict`/`array` members too, because their keys are not
 * fixed at schema time. Section objects therefore stay plain and only their
 * scalar fields are volatile.
 *
 * `notifyOn` is an array (not a set) because the settings surface edits arrays
 * by index; `format.time` is a plain string so a user can type any of the
 * documented styles rather than only the currently-listed ones.
 */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).volatile(),
  notifyOn: Schema.array(Schema.union(['idle', 'error', 'blocked', 'goal-completed']))
    .default(['idle', 'error', 'blocked'])
    .volatile(),
  agents: Schema.union(['root', 'all']).default('root').volatile(),
  coalesceWindowMs: Schema.number().step(1).min(0).max(60000).default(2000).volatile(),
  maxBodyLength: Schema.number().step(1).min(1).max(4096).default(120).volatile(),
  desktop: Schema.object({
    enabled: Schema.union(['auto', 'on', 'off']).default('auto').volatile(),
    sound: Schema.boolean().default(true).volatile(),
  }).default({ enabled: 'auto', sound: true }),
  icons: Schema.object({
    enabled: Schema.boolean().default(true).volatile(),
    urlTemplate: Schema.string().default('').volatile(),
  }).default({ enabled: true, urlTemplate: '' }),
  format: Schema.object({
    time: Schema.union(['hidden', 'short', 'full']).default('short').volatile(),
    showDuration: Schema.boolean().default(true).volatile(),
  }).default({ time: 'short', showDuration: true }),
  titles: TITLE_BY_EVENT_FIELDS,
  bark: barkSchema,
  ntfy: ntfySchema,
  serverchan: serverchanSchema,
  webhook: webhookSchema,
});
