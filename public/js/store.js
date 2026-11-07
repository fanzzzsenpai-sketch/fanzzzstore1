// Logika toko: pilih paket, metode bayar, buat pesanan, animasi GSAP
(function () {
  const CFG = window.FZ_CONFIG;
  const $ = (s) => document.querySelector(s);
  const pkgs = document.querySelectorAll('.pkg');
  const qtyInput = $('#qty');
  const payInfo = $('#pay-info');
  const summary = $('#summary');
  const form = $('#order-form');
  const msg = $('#form-msg');
  const rupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

  let selectedQty = null;
  let selectedPay = null;

  function showMsg(text, isErr) {
    msg.textContent = text;
    msg.classList.toggle('err', !!isErr);
  }

  function updateSummary() {
    if (!selectedQty) { summary.textContent = 'Pilih paket dulu'; return; }
    summary.textContent = `${selectedQty} followers · ${rupiah(CFG.PACKAGES[selectedQty])} · ${selectedPay || 'pilih pembayaran'}`;
  }

  function showPayInfo() {
    payInfo.replaceChildren();
    if (selectedPay === 'DANA') {
      const p = document.createElement('p');
      p.textContent = `Transfer DANA ke ${CFG.DANA_NUMBER} (a.n. ${CFG.DANA_NAME})`;
      payInfo.append(p);
    } else if (selectedPay === 'QRIS') {
      const img = document.createElement('img');
      img.src = CFG.QRIS_IMAGE;
      img.alt = 'QRIS';
      img.className = 'qris';
      const p = document.createElement('p');
      p.textContent = 'Scan QRIS, lalu kirim bukti pembayaran di chat';
      payInfo.append(img, p);
    }
    gsap.from(payInfo, { opacity: 0, y: 10, duration: 0.4 });
  }

  pkgs.forEach((btn) => {
    btn.addEventListener('click', () => {
      pkgs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedQty = Number(btn.dataset.qty);
      qtyInput.value = selectedQty;
      gsap.fromTo(btn, { scale: 0.94 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
      updateSummary();
    });

    // Efek tilt 3D mengikuti kursor
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(btn, { rotateX: -y * 12, rotateY: x * 14, transformPerspective: 800, duration: 0.4 });
    });
    btn.addEventListener('pointerleave', () => {
      gsap.to(btn, { rotateX: 0, rotateY: 0, duration: 0.7, ease: 'elastic.out(1, 0.5)' });
    });
  });

  document.querySelectorAll('input[name="payment"]').forEach((r) => {
    r.addEventListener('change', () => {
      selectedPay = r.value;
      showPayInfo();
      updateSummary();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#username').value.trim();

    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return showMsg('Username Roblox tidak valid (3-20 huruf, angka, atau _).', true);
    if (!selectedQty) return showMsg('Pilih paket followers dulu.', true);
    if (!selectedPay) return showMsg('Pilih metode pembayaran.', true);

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, qty: selectedQty, payment: selectedPay }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Gagal membuat pesanan');

      localStorage.setItem('fz_order', JSON.stringify({ order: data.order, token: data.token }));
      showMsg(`Pesanan ${data.order.id} berhasil dibuat! Silakan cek chat di bawah.`);
      await window.FZChat.open(data.order, data.token);
      document.querySelector('#chat').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      showMsg(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // Pulihkan pesanan terakhir dan chat-nya
  const saved = JSON.parse(localStorage.getItem('fz_order') || 'null');
  if (saved) {
    window.FZChat.open(saved.order, saved.token).catch(() => localStorage.removeItem('fz_order'));
  }

  // Animasi
  gsap.registerPlugin(ScrollTrigger);

  const intro = gsap.timeline({ defaults: { ease: 'power4.out' } });
  intro
    .from('.nav', { y: -40, opacity: 0, duration: 0.8 })
    .from('.hero .tag', { y: 20, opacity: 0, duration: 0.6 }, '-=0.4')
    .from('.hero .line', { yPercent: 110, opacity: 0, stagger: 0.12, duration: 1 }, '-=0.3')
    .from('.hero .sub, .hero .btn', { y: 30, opacity: 0, stagger: 0.15, duration: 0.8 }, '-=0.6');

  gsap.to('.b1', { x: 120, y: 80, duration: 12, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  gsap.to('.b2', { x: -100, y: -60, duration: 14, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  gsap.to('.b3', { x: -80, y: 120, duration: 10, repeat: -1, yoyo: true, ease: 'sine.inOut' });

  gsap.utils.toArray('.section').forEach((sec) => {
    gsap.from(sec, {
      y: 60, opacity: 0, duration: 1, ease: 'power3.out',
      scrollTrigger: { trigger: sec, start: 'top 85%' },
    });
  });

  gsap.from('.pkg', {
    y: 40, opacity: 0, stagger: 0.12, duration: 0.8,
    scrollTrigger: { trigger: '.packages', start: 'top 85%' },
  });
})();
