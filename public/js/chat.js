// Chat pembeli dengan owner: data via API, real-time via Ably
(function () {
  const $ = (s) => document.querySelector(s);
  const panel = $('#chat-panel');
  const list = $('#chat-list');
  const form = $('#chat-form');
  const input = $('#chat-input');
  const title = $('#chat-title');
  const connStatus = $('#chat-status');
  const orderStatus = $('#order-status');
  const empty = $('#chat-empty');

  let cur = null;      // { id, token }
  let realtime = null; // koneksi Ably
  const seen = new Set();

  function render(m) {
    if (seen.has(m.id)) return;
    seen.add(m.id);

    const el = document.createElement('div');
    el.className = 'bubble ' + (m.role === 'customer' ? 'me' : '');

    const small = document.createElement('small');
    const who = m.role === 'owner' ? 'Owner Fanzzz' : 'Kamu';
    small.textContent = who + ' · ' + new Date(m.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    const p = document.createElement('p');
    p.textContent = m.text;

    el.append(small, p);
    list.append(el);
    list.scrollTop = list.scrollHeight;
    gsap.from(el, { y: 16, opacity: 0, scale: 0.96, duration: 0.45, ease: 'back.out(1.6)' });
  }

  function setOrderStatus(s) {
    orderStatus.textContent = 'Status: ' + s;
  }

  function subscribe(orderId, token) {
    if (realtime) realtime.close();
    realtime = new Ably.Realtime({
      authCallback: (_params, cb) => {
        fetch(`/api/realtime-token?orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`)
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            return d;
          })
          .then((t) => cb(null, t))
          .catch((e) => cb(e, null));
      },
    });
    realtime.connection.on('connected', () => (connStatus.textContent = 'Live'));
    realtime.connection.on('disconnected', () => (connStatus.textContent = 'Menyambung ulang…'));

    const channel = realtime.channels.get('order:' + orderId);
    channel.subscribe('chat', (msg) => render(msg.data));
    channel.subscribe('status', (msg) => setOrderStatus(msg.data.status));
  }

  async function open(order, token) {
    const [mRes, oRes] = await Promise.all([
      fetch(`/api/orders/${order.id}/messages?token=${encodeURIComponent(token)}`),
      fetch(`/api/orders/${order.id}?token=${encodeURIComponent(token)}`),
    ]);
    if (!mRes.ok || !oRes.ok) throw new Error('Pesanan tidak ditemukan');
    const { messages } = await mRes.json();
    const { order: latest } = await oRes.json();

    cur = { id: order.id, token };
    title.textContent = 'Chat · ' + order.id;
    setOrderStatus(latest.status);
    list.replaceChildren();
    seen.clear();
    messages.forEach(render);

    empty.hidden = true;
    panel.hidden = false;
    subscribe(order.id, token);
    gsap.fromTo(panel, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !cur) return;
    input.value = '';
    const r = await fetch(`/api/orders/${cur.id}/messages?token=${encodeURIComponent(cur.token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await r.json();
    if (r.ok) render(data.message);
  });

  window.FZChat = { open };
})();
