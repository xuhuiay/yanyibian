/* ============================================================
   Sheenova 汐星札记 — main.js（深空星潮版）
   群星：闪烁星点 / 旋转星轨 / 流星 / 鼠标视差
   潮汐：发光流动光波 · 鼠标光晕 · 滚动动效
   ============================================================ */
(() => {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rand = (a, b) => a + Math.random() * (b - a);

  /* ============================================================
     1. 全局星空 #cosmos（fixed 背景层）
     ============================================================ */
  (function initCosmos() {
    const canvas = document.getElementById("cosmos");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let W = 0, H = 0;
    let stars = [], trails = [], meteors = [];
    let mx = 0.5, my = 0.5;          // 鼠标视差
    let nextMeteor = 2500;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function seed() {
      stars = [];
      const n = Math.min(170, Math.max(90, Math.round((W * H) / 11000)));
      for (let i = 0; i < n; i++) {
        stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: rand(0.5, 1.5),
          a: rand(0.3, 0.9),
          tw: rand(0.4, 1.4),
          ph: rand(0, Math.PI * 2),
          depth: rand(0.3, 1),
          glow: Math.random() < 0.12
        });
      }
      const R = Math.min(W, H);
      trails = [
        { cx: W * 0.8,  cy: H * 0.26, r: R * 0.34, len: 1.15, ang: rand(0, 6), speed: 0.00006,  alpha: 0.5,  color: "111,227,232" },
        { cx: W * 0.8,  cy: H * 0.26, r: R * 0.47, len: 0.85, ang: rand(0, 6), speed: -0.00004, alpha: 0.32, color: "91,134,255" },
        { cx: W * 0.13, cy: H * 0.78, r: R * 0.4,  len: 0.95, ang: rand(0, 6), speed: 0.00005,  alpha: 0.3,  color: "187,140,255" }
      ];
      meteors = [];
    }

    window.addEventListener("mousemove", e => {
      mx = e.clientX / W;
      my = e.clientY / H;
    }, { passive: true });

    function spawnMeteor() {
      const fromLeft = Math.random() < 0.5;
      const x = fromLeft ? rand(-50, W * 0.4) : rand(W * 0.6, W + 50);
      const y = rand(-30, H * 0.42);
      const ang = fromLeft ? rand(0.45, 0.85) : Math.PI - rand(0.45, 0.85);
      const sp = rand(0.5, 0.85);
      meteors.push({
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        len: rand(120, 210),
        life: 0,
        maxLife: rand(1200, 2000)
      });
    }

    let last = 0;
    function draw(now, dt) {
      ctx.clearRect(0, 0, W, H);
      const px = mx - 0.5, py = my - 0.5;

      /* 星点 */
      for (const s of stars) {
        const tw = s.a * (0.55 + 0.45 * Math.sin(now * 0.001 * s.tw + s.ph));
        const x = s.x + px * 18 * s.depth;
        const y = s.y + py * 18 * s.depth;
        if (s.glow) {
          const R = s.r * 5 * tw + 1;
          ctx.strokeStyle = `rgba(200,220,255,${0.5 * tw})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x - R, y); ctx.lineTo(x + R, y);
          ctx.moveTo(x, y - R); ctx.lineTo(x, y + R);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(220,232,255,${tw})`;
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, 7);
        ctx.fill();
      }

      /* 星轨 */
      for (const tr of trails) {
        tr.ang += tr.speed * dt;
        const ox = tr.cx + px * 12, oy = tr.cy + py * 12;
        const segs = 42;
        for (let i = 0; i < segs; i++) {
          const a1 = tr.ang - tr.len * (i / segs);
          const a2 = tr.ang - tr.len * ((i + 1) / segs);
          ctx.strokeStyle = `rgba(${tr.color},${tr.alpha * (1 - i / segs) * 0.55})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(ox, oy, tr.r, a1, a2);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(${tr.color},${tr.alpha})`;
        ctx.beginPath();
        ctx.arc(ox + Math.cos(tr.ang) * tr.r, oy + Math.sin(tr.ang) * tr.r, 1.8, 0, 7);
        ctx.fill();
      }

      /* 流星 */
      if (now > nextMeteor) {
        spawnMeteor();
        nextMeteor = now + rand(3500, 8000);
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.life += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const t = 1 - m.life / m.maxLife;
        if (t <= 0 || m.x < -m.len || m.x > W + m.len || m.y > H + m.len) {
          meteors.splice(i, 1);
          continue;
        }
        const tailX = m.x - m.vx * m.len;
        const tailY = m.y - m.vy * m.len;
        const g = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        g.addColorStop(0, `rgba(240,248,255,${0.9 * t})`);
        g.addColorStop(1, "rgba(240,248,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${t})`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 1.8, 0, 7);
        ctx.fill();
      }
      ctx.lineCap = "butt";
    }

    function tick(now) {
      const dt = Math.min(now - last, 50);
      last = now;
      draw(now, dt);
      requestAnimationFrame(tick);
    }

    resize();
    window.addEventListener("resize", resize);
    if (reduced) {
      draw(3200, 16);
    } else {
      requestAnimationFrame(ts => { last = ts; tick(ts); });
    }
  })();

  /* ============================================================
     2. Hero 潮汐光波 #tide
     ============================================================ */
  (function initTide() {
    const canvas = document.getElementById("tide");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let W = 0, H = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const STOPS = [[0, "91,134,255"], [0.5, "111,227,232"], [1, "187,140,255"]];
    function grad(alpha) {
      const g = ctx.createLinearGradient(0, 0, W, 0);
      STOPS.forEach(([p, c]) => g.addColorStop(p, `rgba(${c},${alpha})`));
      return g;
    }

    function y(x, w, t) {
      const u = x / W;
      return w.base * H
        + (u - 0.5) * w.tilt * H
        + w.amp * Math.sin(w.k * u * Math.PI * 2 + w.phase + t * w.speed)
        + w.amp * 0.4 * Math.sin(w.k * 1.7 * u * Math.PI * 2 - t * w.speed * 0.7 + w.phase * 2);
    }

    function fillPath(w, t) {
      ctx.beginPath();
      const step = 10;
      for (let x = -step; x <= W + step; x += step) {
        if (x === -step) ctx.moveTo(x, y(x, w, t)); else ctx.lineTo(x, y(x, w, t));
      }
      ctx.lineTo(W + step, H + step);
      ctx.lineTo(-step, H + step);
      ctx.closePath();
    }
    function topPath(w, t) {
      ctx.beginPath();
      const step = 8;
      for (let x = -step; x <= W + step; x += step) {
        if (x === -step) ctx.moveTo(x, y(x, w, t)); else ctx.lineTo(x, y(x, w, t));
      }
    }

    const WAVES = [
      { base: 0.66, tilt: -0.16, amp: 26, k: 1.6, phase: 0.0, speed: 0.00022, a: 0.10, la: 0.35 },
      { base: 0.72, tilt: -0.10, amp: 34, k: 1.1, phase: 2.1, speed: 0.00016, a: 0.08, la: 0.28 },
      { base: 0.78, tilt: -0.20, amp: 22, k: 2.3, phase: 4.4, speed: 0.00028, a: 0.07, la: 0.3 },
      { base: 0.60, tilt: -0.08, amp: 18, k: 2.9, phase: 1.2, speed: 0.00034, a: 0.05, la: 0.2 }
    ];

    function draw(t) {
      ctx.clearRect(0, 0, W, H);

      // 深层蓝色辉光
      const rg = ctx.createRadialGradient(W * 0.32, H * 0.78, 0, W * 0.32, H * 0.78, Math.max(W, H) * 0.72);
      rg.addColorStop(0, "rgba(91,134,255,0.15)");
      rg.addColorStop(0.5, "rgba(91,134,255,0.05)");
      rg.addColorStop(1, "rgba(91,134,255,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = "lighter";
      WAVES.forEach(w => {
        // 潮汐体（渐变填充）
        fillPath(w, t);
        ctx.fillStyle = grad(w.a);
        ctx.fill();
        // 顶部光波描边（光晕 + 主线）
        topPath(w, t);
        ctx.strokeStyle = grad(w.la * 0.35);
        ctx.lineWidth = 6;
        ctx.stroke();
        topPath(w, t);
        ctx.strokeStyle = grad(w.la);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      });
      ctx.globalCompositeOperation = "source-over";
    }

    function tick(now) {
      draw(now);
      requestAnimationFrame(tick);
    }

    resize();
    window.addEventListener("resize", resize);
    if (reduced) {
      draw(4200);
    } else {
      requestAnimationFrame(tick);
    }
  })();

  /* ---------------- 3. 导航状态 ---------------- */
  const nav = document.getElementById("nav");
  function onScroll() {
    nav.classList.toggle("is-scrolled", window.scrollY > 30);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const toggle = document.querySelector(".nav-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
    });
    nav.querySelectorAll(".nav-links a").forEach(a =>
      a.addEventListener("click", () => nav.classList.remove("is-open"))
    );
  }

  /* ---------------- 4. 滚动显现 ---------------- */
  const revealIO = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        revealIO.unobserve(e.target);
      }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach(el => revealIO.observe(el));

  /* ---------------- 5. 能力卡片光标聚光 ---------------- */
  document.querySelectorAll(".cap-card").forEach(card => {
    card.addEventListener("mousemove", e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });

  /* ---------------- 6. 方法论潮汐曲线 ---------------- */
  const mBase = document.getElementById("method-path");
  const mFlow = document.getElementById("method-path-flow");
  if (mBase) {
    let d = "";
    for (let x = 0; x <= 1200; x += 12) {
      const yy = 60 + 34 * Math.sin((x / 1200 - 0.1) * Math.PI * 5);
      d += (x === 0 ? "M" : "L") + x.toFixed(1) + " " + yy.toFixed(1);
    }
    mBase.setAttribute("d", d);
    if (mFlow) mFlow.setAttribute("d", d);
  }

  /* ---------------- 8. 鼠标跟随光晕 ---------------- */
  (function initCursorGlow() {
    const el = document.querySelector(".cursor-glow");
    if (!el || reduced) return;
    let tx = window.innerWidth / 2, ty = window.innerHeight / 2;
    let x = tx, y = ty;
    window.addEventListener("mousemove", e => {
      tx = e.clientX;
      ty = e.clientY;
    }, { passive: true });
    (function loop() {
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      requestAnimationFrame(loop);
    })();
  })();

  /* ---------------- 9. 页脚年份 ---------------- */
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();
