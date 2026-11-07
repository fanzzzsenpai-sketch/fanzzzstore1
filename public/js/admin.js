// Panel owner: lihat pesanan, balas chat, ubah status (real-time via Ably)
(function () {
  const $ = (s) => document.querySelector(s);
  const listEl = $('#order-list');
  const chatEl = $('#admin-chat');
  const rupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

  let key = sessionStorage.getItem('fz_admin_key') || '';
  let orders = [];
  let selected = null;
  let realtime = null;
  const unread = new Set();
  const seen = new Set();

  const api = async (path, opts = {}) => {
    const r = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'x-admin-key': key, ...(opts.headers || {}) },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error');
    return data;
  };

  function renderList() {
    listEl.replaceChildren();
    orders.forEach((o) => {
      const b = document.createElement('button');
      b.className = 'order-item'
        + (selected === o.id ? ' active' : '')
        + (unread.has(o.id) ? ' unread' : '');
      const strong = document.createElement('strong');
      strong.textContent = `${o.username} 路 ${o.qty} followers`;
      const small = document.createElement('small');
      small.textContent = `${o.id} 路 ${o.payment} 路 ${o.status}`;
      b.append(strong, small);
      b.addEventListener('click', () => select(o.id));
      listEl.append(b);
    });
  }

  function renderMsg(m) {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    const el = document.createElement('div');
    el.className = 'bubble ' + (m.role === 'owner' ? 'me' : '');
    const small = document.createElement('small');
    const who = m.role === 'owner' ? 'Kamu (Owner)' : 'Pembeli';
    small.textContent = who + ' 路 ' + new Date(m.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const p = document.createElement('p');
    p.textContent = m.text;
    el.append(small, p);
    chatEl.append(el);
    chatEl.scrollTop = chatEl.scrollHeight;
    gsap.from(el, { y: 12, opacity: 0, duration: 0.35 });
  }

  function showMeta(o) {
    $('#detail-title').textContent = `${o.username} 路 ${o.qty} followers 路 ${o.id}`;
    $('#detail-meta').textContent = `${rupiah(o.price)} 路 ${o.payment} 路 ${o.status}`;
    $('#status-select').value = o.status;
  }

  async function select(id) {
    selected = id;
    unread.delete(id);
    renderList();
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    showMeta(o);
    $('#detail-empty').hidden = true;
    $('#detail').hidden = false;
    const { messages } = await api(`/api/admin/orders/${id}/messages`);
    chatEl.replaceChildren();
    seen.clear();
    messages.forEach(renderMsg);
  }

  async function loadOrders() {
    const { orders: list } = await api('/api/admin/orders');
    orders = list;
    renderList();
  }

  function upsert(o) {
    const i = orders.findIndex((x) => x.id === o.id);
    if (i >= 0) orders[i] = o; else orders.unshift(o);
  }

  function connect() {
    if (realtime) realtime.close();
    realtime = new Ably.Realtime({
      authCallback: (_params, cb) => {
        fetch('/api/realtime-token', { headers: { 'x-admin-key': key } })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            return d;
          })
          .then((t) => cb(null, t))
          .catch((e) => cb(e, null));
      },
    });

    const ch = realtime.channels.get('admin');
    ch.subscribe('order', (msg) => {
      upsert(msg.data);
      renderList();
    });
    ch.subscribe('chat', (msg) => {
      const m = msg.data;
      if (m.orderId === selected) renderMsg(m);
      else if (m.role === 'customer') { unread.add(m.orderId); renderList(); }
    });
    ch.subscribe('status', (msg) => {
      const d = msg.data;
      const o = orders.find((x) => x.id === d.orderId);
      if (o) {
        o.status = d.status;
        renderList();
        if (selected === o.id) showMeta(o);
      }
    });
  }

  async function start(k) {
    key = k;
    await loadOrders();
    sessionStorage.setItem('fz_admin_key', key);
    $('#login').hidden = true;
    $('#dash').hidden = false;
    connect();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await start($('#key').value.trim());
    } catch (err) {
      $('#login-msg').textContent = err.message;
    }
  });

  $('#reply-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#reply-input');
    const text = input.value.trim();
    if (!text || !selected) return;
    input.value = '';
    try {
      const { message } = await api(`/api/admin/orders/${selected}/messages`, {
        method: 'POST', body: JSON.stringify({ text }),
      });
      renderMsg(message);
    } catch (err) {
      alert(err.message);
    }
  });

  $('#status-select').addEventListener('change', async (e) => {
    if (!selected) return;
    try {
      await api(`/api/admin/orders/${selected}/status`, {
        method: 'POST', body: JSON.stringify({ status: e.target.value }),
      });
    } catch (err) {
      alert(err.message);
    }
  });

  if (key) start(key).catch(() => sessionStorage.removeItem('fz_admin_key'));
})();
