const crypto = require('crypto');

/** Giống social-service/eventBus — tái triển khai để không phụ thuộc chéo worktree microservice khác nhau. */

function mode() {
  return String(process.env.EVENT_BUS_MODE || 'both').toLowerCase().trim();
}

function streamKeyForChannel(channelName) {
  const prefix = (process.env.EVENT_BUS_STREAM_PREFIX || 'events').replace(/:$/, '');
  const ch = String(channelName || 'default').trim();
  return `${prefix}:${ch}`;
}

function maxLenApprox() {
  const n = parseInt(process.env.EVENT_BUS_STREAM_MAXLEN || '100000', 10);
  return Number.isFinite(n) && n > 0 ? n : 100000;
}

function ensureEventId(envelope) {
  if (envelope && typeof envelope === 'object' && envelope.eventId) return envelope.eventId;
  const id = crypto.randomUUID();
  if (envelope && typeof envelope === 'object') {
    envelope.eventId = id;
  }
  return id;
}

async function publishEnvelope(pubClient, channelName, envelope) {
  if (!pubClient || !pubClient.isOpen) return;
  let env =
    envelope && typeof envelope === 'object' ? envelope : { _nonObject: envelope };
  env = { ...env };
  ensureEventId(env);
  if (!env.publishedAt) env.publishedAt = new Date().toISOString();

  const m = mode();
  const json = JSON.stringify(env);

  if (m === 'pubsub' || m === 'both') {
    await pubClient.publish(String(channelName), json);
  }
  if (m === 'streams' || m === 'both') {
    const sk = streamKeyForChannel(channelName);
    await pubClient.xAdd(
      sk,
      '*',
      { payload: json },
      {
        TRIM: {
          strategy: 'MAXLEN',
          strategyModifier: '~',
          threshold: maxLenApprox(),
        },
      }
    );
  }
}

module.exports = {
  publishEnvelope,
  streamKeyForChannel,
  mode,
};
