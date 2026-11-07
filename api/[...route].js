// Satu function untuk semua endpoint /api/* (serverless, cocok untuk Vercel)
const crypto = require('crypto');
const Ably = require('ably');
const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv(); // UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN
const ably = new Ably.Rest(process.env.ABLY_API_KEY);
const ADMIN_KEY = process.env.ADMIN_KEY || '';

const PACKAGES = { 100: 6000, 1000: 26000, 1500: 37000 };
const PAYMENTS = ['DANA', 'QRIS'];
const STATUSES = ['Menunggu Pembayaran', 'Pembayaran Diterima', 'Diproses', 'Selesai', 'Dibatalkan'];

const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const publicOrder = ({ token, ...rest }) => rest;

async function getOrder(id) {
  const v = await redis.get('order:' + id);
  return v ? parse(v) : null;
}

async function getMessages(orderId) {
  const list = await redis.lrange('chat:' + orderId, 0, -1);
  return list.map(parse);
}

// Kirim event ke channel pembeli (order:ID) dan channel owner (admin)
async function publish(orderId, name, data) {
  await Promise.all([
    ably.channels.get('order:' + orderId).publish(name, data),
    ably.channels.get('admin').publish(name, data),
  ]);
}

async function addMessage(orderId, role, text) {
  const msg = { id: rid(6), orderId, role, text: String(text).slice(0, 500), at: Date.now() };
  await redis.rpush('chat:' + orderId, JSON.stringify(msg));
  await publish(orderId, 'chat', msg);
  return msg;
}

module.exports = async (req, res) => {
  const send = (status, data) => res.status(status).json(data);

  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname.replace(/^\/api/, '');
    const m = req.method;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const token = url.searchParams.get('token') || '';

    // 1. Buat pesanan baru
    if (m === 'POST' && p === '/orders') {
      const username = String(body.username || '').trim();
      const qty = Number(body.qty);
      const payment = String(body.payment || '').toUpperCase();

      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return send(400, { error: 'Username Roblox tidak valid.' });
      if (PACKAGES[qty] === undefined) return send(400, { error: 'Paket tidak tersedia.' });
      if (!PAYMENTS.includes(payment)) return send(400, { error: 'Metode pembayaran tidak valid.' });

      const id = 'FZ' + rid(4).toUpperCase();
      const order = {
        id, token: rid(16), username, qty, price: PACKAGES[qty],
        payment, status: STATUSES[0], createdAt: Date.now(),
      };
      await redis.set('order:' + id, JSON.stringify(order));
      await redis.lpush('orders', id);
      await addMessage(id, 'owner', `Halo ${username}! Pesanan ${qty} followers sudah kami terima. Silakan bayar via ${payment}, lalu kirim bukti pembayaran di chat ini.`);
      await ably.channels.get('admin').publish('order', publicOrder(order));
      return send(201, { order: publicOrder(order), token: order.token });
    }

    // 2. Route pembeli (wajib token pesanan)
    const cm = p.match(/^\/orders\/(FZ[A-F0-9]+)(\/messages)?$/);
    if (cm) {
      const order = await getOrder(cm[1]);
      if (!order || !token || !safeEqual(token, order.token)) {
        return send(404, { error: 'Pesanan tidak ditemukan.' });
      }
      if (m === 'GET' && !cm[2]) return send(200, { order: publicOrder(order) });
      if (m === 'GET' && cm[2]) return send(200, { messages: await getMessages(order.id) });
      if (m === 'POST' && cm[2]) {
        const text = String(body.text || '').trim();
        if (!text) return send(400, { error: 'Pesan kosong.' });
        // Role selalu 'customer', pembeli tidak bisa mengaku sebagai owner
        return send(201, { message: await addMessage(order.id, 'customer', text) });
      }
    }

    // 3. Token realtime Ably (dibatasi per channel)
    if (m === 'GET' && p === '/realtime-token') {
      const key = req.headers['x-admin-key'] || '';
      let capability;
      if (ADMIN_KEY && key && safeEqual(key, ADMIN_KEY)) {
        capability = { admin: ['subscribe'] };
      } else {
        const orderId = url.searchParams.get('orderId') || '';
        const order = /^FZ[A-F0-9]+$/.test(orderId) ? await getOrder(orderId) : null;
        if (!order || !token || !safeEqual(token, order.token)) {
          return send(401, { error: 'Tidak diizinkan.' });
        }
        capability = { ['order:' + orderId]: ['subscribe'] };
      }
      const tokenRequest = await ably.auth.createTokenRequest({
        capability: JSON.stringify(capability),
        ttl: 60 * 60 * 1000,
      });
      return send(200, tokenRequest);
    }

    // 4. Route owner (wajib header x-admin-key)
    if (p.startsWith('/admin/')) {
      const key = req.headers['x-admin-key'] || '';
      if (!ADMIN_KEY || !safeEqual(key, ADMIN_KEY)) return send(401, { error: 'Kunci owner salah.' });

      if (m === 'GET' && p === '/admin/orders') {
        const ids = await redis.lrange('orders', 0, -1);
        const list = await Promise.all(ids.map((id) => getOrder(id)));
        return send(200, { orders: list.filter(Boolean).map(publicOrder) });
      }

      const am = p.match(/^\/admin\/orders\/(FZ[A-F0-9]+)\/(messages|status)$/);
      if (am) {
        const order = await getOrder(am[1]);
        if (!order) return send(404, { error: 'Pesanan tidak ditemukan.' });

        if (m === 'GET' && am[2] === 'messages') return send(200, { messages: await getMessages(order.id) });

        if (m === 'POST' && am[2] === 'messages') {
          const text = String(body.text || '').trim();
          if (!text) return send(400, { error: 'Pesan kosong.' });
          return send(201, { message: await addMessage(order.id, 'owner', text) });
        }

        if (m === 'POST' && am[2] === 'status') {
          if (!STATUSES.includes(body.status)) return send(400, { error: 'Status tidak valid.' });
          order.status = body.status;
          await redis.set('order:' + order.id, JSON.stringify(order));
          await publish(order.id, 'status', { orderId: order.id, status: order.status });
          return send(200, { order: publicOrder(order) });
        }
      }
    }

    return send(404, { error: 'Endpoint tidak ditemukan.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
};
