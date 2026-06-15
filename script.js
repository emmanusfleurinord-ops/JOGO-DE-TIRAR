// ═══════════════════════════════════════════
//  NOVA STRIKE — script.js
//  Nave espacial 2D — sem erros, sem travamentos
// ═══════════════════════════════════════════

(function () {
  'use strict';

  // ── Canvas ──────────────────────────────
  const canvas = document.getElementById('c');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width  = 480;
  const H = canvas.height = 620;

  // ── UI refs ─────────────────────────────
  const hudScore    = document.getElementById('hudScore');
  const hudLives    = document.getElementById('hudLives');
  const screenMenu  = document.getElementById('screenMenu');
  const screenPause = document.getElementById('screenPause');
  const screenOver  = document.getElementById('screenOver');
  const overScore   = document.getElementById('overScore');
  const overBest    = document.getElementById('overBest');

  document.getElementById('btnStart').addEventListener('click',   startGame);
  document.getElementById('btnResume').addEventListener('click',  resumeGame);
  document.getElementById('btnRestart').addEventListener('click', startGame);

  // ── Tela ativa ──────────────────────────
  function showScreen(el) {
    [screenMenu, screenPause, screenOver].forEach(s => s.classList.remove('active'));
    if (el) el.classList.add('active');
  }

  // ── Audio (Web Audio API) ───────────────
  let AC = null;
  function initAudio() {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
  }

  function beep(freq, type, vol, dur, freqEnd) {
    if (!AC) return;
    try {
      const g = AC.createGain();
      const o = AC.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, AC.currentTime);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, AC.currentTime + dur);
      g.gain.setValueAtTime(vol, AC.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
      o.connect(g); g.connect(AC.destination);
      o.start(); o.stop(AC.currentTime + dur + 0.01);
    } catch(e) {}
  }

  function noise(vol, dur, cutoff) {
    if (!AC) return;
    try {
      const sz  = Math.floor(AC.sampleRate * dur);
      const buf = AC.createBuffer(1, sz, AC.sampleRate);
      const d   = buf.getChannelData(0);
      for (let i = 0; i < sz; i++) d[i] = Math.random() * 2 - 1;
      const src = AC.createBufferSource();
      src.buffer = buf;
      const f = AC.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = cutoff;
      const g = AC.createGain();
      g.gain.setValueAtTime(vol, AC.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
      src.connect(f); f.connect(g); g.connect(AC.destination);
      src.start();
    } catch(e) {}
  }

  const sfx = {
    shoot:     () => beep(900, 'sine', 0.12, 0.12, 200),
    hit:       () => { noise(0.3, 0.18, 500); beep(180, 'sawtooth', 0.15, 0.15); },
    explode:   () => { noise(0.5, 0.3, 800);  beep(100, 'sawtooth', 0.1, 0.25, 40); },
    playerHit: () => { noise(0.4, 0.25, 300); beep(120, 'square', 0.2, 0.2); },
    gameover:  () => [330,277,220,185,147].forEach((f,i) =>
                   setTimeout(() => beep(f, 'square', 0.08, 0.18), i * 180)),
    levelup:   () => [440,550,660,880].forEach((f,i) =>
                   setTimeout(() => beep(f, 'sine', 0.1, 0.12), i * 80)),
  };

  // ── Estrelas de fundo ───────────────────
  const STARS = Array.from({ length: 100 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() * 1.6 + 0.2,
    spd: Math.random() * 1.2 + 0.15,
    a: Math.random() * 0.8 + 0.2,
  }));

  function tickStars() {
    STARS.forEach(s => {
      s.y += s.spd;
      if (s.y > H + 2) { s.y = -2; s.x = Math.random() * W; }
    });
  }

  function drawStars() {
    ctx.save();
    STARS.forEach(s => {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Constantes ──────────────────────────
  const COLORS = ['#ff3cac','#784ba0','#00ffcc','#ff8c00','#ffe600','#4fc3f7'];

  // ── Estado do jogo ──────────────────────
  let G = null;         // game state
  let RAF = 0;          // requestAnimationFrame id
  let paused = false;
  let best = 0;

  function newState() {
    return {
      score: 0,
      lives: 3,
      level: 1,
      nextLevelAt: 300,
      frame: 0,
      shootCooldown: 0,
      spawnInterval: 90,
      spawnTimer: 0,
      invFrames: 0,        // frames de invencibilidade do jogador
      player: { x: W / 2, y: H - 90, w: 40, h: 44, speed: 5 },
      bullets: [],         // balas do jogador
      eBullets: [],        // balas inimigas
      enemies: [],
      particles: [],
      keys: { left: false, right: false, space: false },
    };
  }

  // ── Input ────────────────────────────────
  const HANDLED = new Set(['ArrowLeft','ArrowRight',' ','p','P']);
  window.addEventListener('keydown', e => {
    if (HANDLED.has(e.key)) e.preventDefault();
    if (!G) return;
    if (e.key === 'ArrowLeft')       G.keys.left  = true;
    if (e.key === 'ArrowRight')      G.keys.right = true;
    if (e.key === ' ')               G.keys.space = true;
    if ((e.key === 'p' || e.key === 'P') && !screenOver.classList.contains('active')) {
      paused ? resumeGame() : pauseGame();
    }
  });
  window.addEventListener('keyup', e => {
    if (!G) return;
    if (e.key === 'ArrowLeft')  G.keys.left  = false;
    if (e.key === 'ArrowRight') G.keys.right = false;
    if (e.key === ' ')          G.keys.space = false;
  });

  // ── Iniciar ──────────────────────────────
  function startGame() {
    cancelAnimationFrame(RAF);
    paused = false;
    G = newState();
    initAudio();
    showScreen(null);
    loop();
  }

  function pauseGame() {
    if (!G || paused) return;
    paused = true;
    cancelAnimationFrame(RAF);
    showScreen(screenPause);
  }

  function resumeGame() {
    if (!paused) return;
    paused = false;
    showScreen(null);
    loop();
  }

  // ── Game Over ────────────────────────────
  function doGameOver() {
    cancelAnimationFrame(RAF);
    if (G.score > best) best = G.score;
    overScore.textContent = G.score;
    overBest.textContent  = best;
    sfx.gameover();
    showScreen(screenOver);
    G = null;
  }

  // ── Loop ─────────────────────────────────
  function loop() {
    RAF = requestAnimationFrame(loop);
    tick();
    render();
  }

  // ── Tick (lógica) ────────────────────────
  function tick() {
    G.frame++;
    const p = G.player;

    // Movimento do jogador
    if (G.keys.left  && p.x - p.w / 2 > 8)     p.x -= p.speed;
    if (G.keys.right && p.x + p.w / 2 < W - 8)  p.x += p.speed;

    // Tiro do jogador
    G.shootCooldown = Math.max(0, G.shootCooldown - 1);
    if (G.keys.space && G.shootCooldown === 0) {
      G.bullets.push({ x: p.x, y: p.y - p.h / 2 - 2, vy: -11 });
      sfx.shoot();
      G.shootCooldown = 12;
    }

    // Mover balas do jogador
    G.bullets.forEach(b => b.y += b.vy);
    G.bullets = G.bullets.filter(b => b.y > -20);

    // Spawn inimigos
    G.spawnTimer++;
    if (G.spawnTimer >= G.spawnInterval) {
      spawnEnemy();
      G.spawnTimer = 0;
    }

    // Mover inimigos + tiro deles
    G.enemies.forEach(e => {
      e.y += e.vy;
      // movimento lateral sinusoidal para inimigos especiais
      if (e.sway) e.x += Math.sin(G.frame * e.swaySpeed) * e.swayAmp;
      e.x = Math.max(e.w / 2 + 4, Math.min(W - e.w / 2 - 4, e.x));

      e.shootTimer--;
      if (e.shootTimer <= 0 && e.y > 0) {
        shootEnemy(e);
        e.shootTimer = 60 + Math.floor(Math.random() * 80);
      }
    });

    // Mover balas inimigas
    G.eBullets.forEach(b => { b.x += b.vx; b.y += b.vy; });
    G.eBullets = G.eBullets.filter(b => b.y < H + 20 && b.x > -20 && b.x < W + 20);

    // Colisão: bala jogador × inimigo
    for (let bi = G.bullets.length - 1; bi >= 0; bi--) {
      const b = G.bullets[bi];
      let hit = false;
      for (let ei = G.enemies.length - 1; ei >= 0; ei--) {
        const e = G.enemies[ei];
        if (circleHit(b.x, b.y, 4, e.x, e.y, e.r)) {
          hit = true;
          e.hp--;
          addParticles(e.x, e.y, '#fff', 4, 1.5);
          if (e.hp <= 0) {
            addParticles(e.x, e.y, e.color, 18, 3.5);
            sfx.explode();
            G.score += e.pts;
            G.enemies.splice(ei, 1);
          } else {
            sfx.hit();
          }
          break;
        }
      }
      if (hit) G.bullets.splice(bi, 1);
    }

    // Colisão: inimigo passou da tela (perde vida)
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      if (G.enemies[i].y - G.enemies[i].r > H + 10) {
        addParticles(G.enemies[i].x, H - 10, G.enemies[i].color, 10, 2.5);
        G.enemies.splice(i, 1);
        loseLife();
        if (!G) return;
      }
    }

    // Colisão: bala inimiga × jogador
    if (G.invFrames === 0) {
      for (let i = G.eBullets.length - 1; i >= 0; i--) {
        const b = G.eBullets[i];
        if (circleHit(b.x, b.y, 5, p.x, p.y, 14)) {
          G.eBullets.splice(i, 1);
          addParticles(p.x, p.y, '#00ffcc', 14, 3);
          sfx.playerHit();
          loseLife();
          if (!G) return;
          break;
        }
      }
    }

    // Invencibilidade após dano
    if (G.invFrames > 0) G.invFrames--;

    // Level up
    if (G.score >= G.nextLevelAt) {
      G.level++;
      G.nextLevelAt += 300 + G.level * 100;
      G.spawnInterval = Math.max(28, G.spawnInterval - 8);
      sfx.levelup();
    }

    // Partículas
    G.particles.forEach(pt => {
      pt.x  += pt.vx; pt.y  += pt.vy;
      pt.vy += 0.08;
      pt.life--;
    });
    G.particles = G.particles.filter(pt => pt.life > 0);

    // Estrelas
    tickStars();

    // HUD
    hudScore.textContent = String(G.score).padStart(6, '0');
    hudLives.textContent = '♥ '.repeat(Math.max(0, G.lives)).trim();
  }

  // ── Perder vida ──────────────────────────
  function loseLife() {
    G.lives--;
    G.invFrames = 90;
    if (G.lives <= 0) { doGameOver(); }
  }

  // ── Spawn de inimigo ─────────────────────
  function spawnEnemy() {
    const roll  = Math.random();
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const lvl   = G.level;

    let e;
    if (roll < 0.15 && lvl >= 3) {
      // Inimigo BOSS (mini)
      e = {
        x: 80 + Math.random() * (W - 160),
        y: -50, r: 26, hp: 5 + lvl, maxHp: 5 + lvl,
        vy: 0.8 + Math.random() * 0.4,
        color, pts: 100, type: 'boss',
        sway: true, swaySpeed: 0.03, swayAmp: 1.8,
        shootTimer: 40,
      };
    } else if (roll < 0.35) {
      // Inimigo TANK
      e = {
        x: 60 + Math.random() * (W - 120),
        y: -40, r: 20, hp: 3, maxHp: 3,
        vy: 1.0 + Math.random() * 0.5 * (lvl * 0.2 + 1),
        color, pts: 30, type: 'tank',
        sway: false,
        shootTimer: 50 + Math.floor(Math.random() * 60),
      };
    } else {
      // Inimigo NORMAL
      e = {
        x: 40 + Math.random() * (W - 80),
        y: -30, r: 14, hp: 1, maxHp: 1,
        vy: 1.4 + Math.random() * 0.8 + lvl * 0.15,
        color, pts: 10, type: 'normal',
        sway: Math.random() < 0.4,
        swaySpeed: 0.04 + Math.random() * 0.03,
        swayAmp: 0.8 + Math.random() * 1.2,
        shootTimer: 80 + Math.floor(Math.random() * 80),
      };
    }
    G.enemies.push(e);
  }

  // ── Tiro do inimigo ──────────────────────
  function shootEnemy(e) {
    if (!G.player) return;
    const dx = G.player.x - e.x;
    const dy = G.player.y - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const spd  = e.type === 'boss' ? 4.5 : 3.2;
    G.eBullets.push({
      x: e.x, y: e.y + e.r,
      vx: (dx / dist) * spd,
      vy: (dy / dist) * spd,
      color: e.color,
    });
  }

  // ── Colisão circular ─────────────────────
  function circleHit(ax, ay, ar, bx, by, br) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy < (ar + br) * (ar + br);
  }

  // ── Partículas ───────────────────────────
  function addParticles(x, y, color, count, maxV) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.5 + Math.random() * maxV;
      G.particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 20 + Math.floor(Math.random() * 24),
        maxLife: 44,
        r: 1.5 + Math.random() * 3,
        color,
      });
    }
  }

  // ── Render ───────────────────────────────
  function render() {
    // Fundo
    ctx.fillStyle = '#080a12';
    ctx.fillRect(0, 0, W, H);

    drawStars();

    if (!G) return;

    const p = G.player;

    // Balas do jogador
    G.bullets.forEach(b => {
      ctx.save();
      ctx.shadowColor = '#00ffcc';
      ctx.shadowBlur  = 14;
      // corpo da bala
      const grad = ctx.createLinearGradient(b.x, b.y - 12, b.x, b.y + 4);
      grad.addColorStop(0, '#00ffcc');
      grad.addColorStop(1, '#004433');
      ctx.fillStyle = grad;
      roundRect(ctx, b.x - 3, b.y - 14, 6, 18, 3);
      ctx.fill();
      ctx.restore();
    });

    // Balas inimigas
    G.eBullets.forEach(b => {
      ctx.save();
      ctx.shadowColor = b.color;
      ctx.shadowBlur  = 12;
      ctx.fillStyle   = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // Inimigos
    G.enemies.forEach(e => drawEnemy(e));

    // Nave do jogador (pisca quando invencível)
    const showPlayer = G.invFrames === 0 || Math.floor(G.invFrames / 5) % 2 === 0;
    if (showPlayer) drawPlayer(p);

    // Partículas
    ctx.save();
    G.particles.forEach(pt => {
      const a = pt.life / pt.maxLife;
      ctx.globalAlpha = a;
      ctx.shadowColor = pt.color;
      ctx.shadowBlur  = 8;
      ctx.fillStyle   = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r * a, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.restore();

    // Nível
    ctx.save();
    ctx.font = '11px "Share Tech Mono", monospace';
    ctx.fillStyle = '#334';
    ctx.fillText(`LVL ${G.level}`, 10, H - 10);
    ctx.restore();
  }

  // ── Desenhar nave do jogador ─────────────
  function drawPlayer(p) {
    ctx.save();
    ctx.translate(p.x, p.y);

    // Chama do motor
    ctx.shadowColor = '#784ba0';
    ctx.shadowBlur  = 22;
    ctx.fillStyle   = '#784ba0';
    ctx.beginPath();
    ctx.ellipse(0, 22, 7, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = '#ff3cac';
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = '#ff3cac';
    ctx.beginPath();
    ctx.ellipse(0, 20, 3, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Corpo
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur  = 18;
    ctx.fillStyle   = '#00ffcc';
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(-16, 14);
    ctx.lineTo(-8, 10);
    ctx.lineTo(0, 14);
    ctx.lineTo(8, 10);
    ctx.lineTo(16, 14);
    ctx.closePath();
    ctx.fill();

    // Interior escuro
    ctx.fillStyle = '#080a12';
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(-7, 10);
    ctx.lineTo(7, 10);
    ctx.closePath();
    ctx.fill();

    // Cockpit
    ctx.shadowColor = '#ffe600';
    ctx.shadowBlur  = 14;
    ctx.fillStyle   = '#ffe600';
    ctx.beginPath();
    ctx.arc(0, -2, 5, 0, Math.PI * 2);
    ctx.fill();

    // Asas
    ctx.shadowBlur = 0;
    ctx.fillStyle  = '#006655';
    ctx.beginPath(); ctx.moveTo(-16,14); ctx.lineTo(-28,22); ctx.lineTo(-12,14); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo( 16,14); ctx.lineTo( 28,22); ctx.lineTo( 12,14); ctx.closePath(); ctx.fill();

    // Canhões
    ctx.fillStyle = '#00ffcc88';
    ctx.fillRect(-14, -6, 4, 14);
    ctx.fillRect( 10, -6, 4, 14);

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ── Desenhar inimigo ─────────────────────
  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);

    ctx.shadowColor = e.color;
    ctx.shadowBlur  = e.type === 'boss' ? 28 : 14;

    if (e.type === 'boss') {
      // Hexágono grande
      ctx.fillStyle = e.color;
      polygon(ctx, 0, 0, e.r, 6, -Math.PI / 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      polygon(ctx, 0, 0, e.r * 0.55, 6, -Math.PI / 6);
      ctx.fill();
      // Olho
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(0, 0, e.r * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.arc(0, 0, e.r * 0.1, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'tank') {
      // Octógono
      ctx.fillStyle = e.color;
      polygon(ctx, 0, 0, e.r, 8, 0);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      polygon(ctx, 0, 0, e.r * 0.5, 8, 0);
      ctx.fill();
    } else {
      // Losango
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.moveTo(0, -e.r);
      ctx.lineTo(e.r * 0.8, 0);
      ctx.lineTo(0, e.r);
      ctx.lineTo(-e.r * 0.8, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.arc(0, 0, e.r * 0.35, 0, Math.PI * 2); ctx.fill();
    }

    // Barra de vida (só se hp > 1)
    if (e.maxHp > 1) {
      const bw = e.r * 2 + 10;
      const bh = 4;
      const by = -e.r - 10;
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#111';
      ctx.fillRect(-bw / 2, by, bw, bh);
      ctx.fillStyle = e.hp / e.maxHp > 0.5 ? '#00ff88' : e.hp / e.maxHp > 0.25 ? '#ffe600' : '#ff3cac';
      ctx.fillRect(-bw / 2, by, bw * (e.hp / e.maxHp), bh);
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ── Helpers ──────────────────────────────
  function polygon(ctx, x, y, r, sides, startAngle) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = startAngle + (Math.PI * 2 / sides) * i;
      i === 0 ? ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
              : ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Renderiza o fundo de estrelas enquanto no menu
  (function menuStars() {
    ctx.fillStyle = '#080a12';
    ctx.fillRect(0, 0, W, H);
    drawStars();
    tickStars();
    if (!G) requestAnimationFrame(menuStars);
  })();

})();
