// src/main.js — 2.5D 立体昂首水晶灵龙 + 360° 全景环绕天穹引擎
import { HandTracker } from './input/HandTracker.js';

export const PALETTES = {
  JADE:   { name: '翡翠玉龙', body: '#34d399', dark: '#064e3b', belly: '#a7f3d0', horn: '#fde047', fin: 'rgba(167,243,208,0.32)', glow: 'rgba(52,211,153,0.35)' },
  SAKURA: { name: '落樱粉晶', body: '#f472b6', dark: '#831843', belly: '#fbcfe8', horn: '#fde047', fin: 'rgba(251,207,232,0.32)', glow: 'rgba(244,114,182,0.35)' },
  CYBER:  { name: '赛博霓虹', body: '#00f2fe', dark: '#0c4a6e', belly: '#bae6fd', horn: '#ff007f', fin: 'rgba(0,242,254,0.30)',   glow: 'rgba(0,242,254,0.35)' },
  LAVA:   { name: '熔岩赤金', body: '#fb923c', dark: '#7c2d12', belly: '#fef08a', horn: '#fff7ed', fin: 'rgba(254,240,138,0.30)', glow: 'rgba(251,146,60,0.35)' },
  AURORA: { name: '全息极光', body: '#818cf8', dark: '#312e81', belly: '#ddd6fe', horn: '#34d399', fin: 'rgba(199,210,254,0.32)', glow: 'rgba(129,140,248,0.35)' }
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

class SecondOrder2D {
  constructor(f = 3.2, zeta = 0.88, x0 = 0, y0 = 0) {
    this.x = x0; this.y = y0;
    this.vx = 0; this.vy = 0;
    this.setParams(f, zeta);
  }
  setParams(f, zeta) {
    this.f = Math.max(0.5, f);
    this.zeta = Math.max(0.2, zeta);
    this.k1 = this.zeta / (Math.PI * this.f);
    this.k2 = 1 / ((2 * Math.PI * this.f) ** 2);
  }
  update(tx, ty, dt) {
    if (dt <= 0) return;
    const k2s = Math.max(this.k2, (dt * dt) * 0.5 + dt * this.k1 * 0.5, dt * this.k1);
    this.x += dt * this.vx;
    this.y += dt * this.vy;
    this.vx += dt * (tx - this.x - this.k1 * this.vx) / k2s;
    this.vy += dt * (ty - this.y - this.k1 * this.vy) / k2s;
  }
}

function traceSmoothClosedSpline(ctx, pts) {
  const n = pts.length;
  if (n < 3) return;
  ctx.beginPath();
  ctx.moveTo((pts[n - 1].x + pts[0].x) * 0.5, (pts[n - 1].y + pts[0].y) * 0.5);
  for (let i = 0; i < n; i++) {
    const next = pts[(i + 1) % n];
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + next.x) * 0.5, (pts[i].y + next.y) * 0.5);
  }
  ctx.closePath();
}

class Dragon25DPanoramaApp {
  constructor() {
    this.canvas = document.createElement('canvas');
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.paletteKey = 'JADE';
    this.form = 'CRAWL'; // 'CRAWL' (2.5D 昂首行进) | 'SWIM' (360° 腾云游龙)
    this.mode = 'MOUSE';
    this.state = 'FOLLOW';
    this.time = 0;
    this.alertLevel = 0;
    this.pettingGlow = 0;
    this.pulseProgress = -1;
    // 背鳍统一侧向系数（全场共用，避免逐节 upY 翻转导致身体断裂）
    this.dorsalSign = -1;
    this.targetDorsalSign = -1;

    // 360° 全景相机状态 (camYaw: 0 ~ 2π 全景水平角, camPitch: 俯仰倾角)
    this.camYaw = 0;
    this.camYawVel = 0;
    this.camPitch = 0.22;
    this.autoOrbit = true;
    this.isPanningSky = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.keysDown = { left: false, right: false };

    this.initPanoramaElements();

    // 指针与交互状态
    this.pointer = { x: this.width * 0.6, y: this.height * 0.52 };
    this.lastInputTime = performance.now();
    this.isRightDown = false;
    this.isKeyAlert = false;
    this.wanderPhase = 0;

    // 1. 2.5D 解耦双层脊椎链 (含 groundX, groundY 以及离地昂首高度 z)
    this.numSegs = 24;
    this.segLen = 16;
    this.radii = [
      15, 12.5, 13.5, 17.5, 20.5, 21.5, 20.5, 18.5, 16.5, 14.8, 13.2, 11.8,
      10.4, 9.0, 7.8, 6.7, 5.7, 4.8, 4.0, 3.3, 2.7, 2.1, 1.6, 1.2
    ];
    const sx = this.width * 0.5;
    const sy = this.height * 0.58;
    this.headDyn = new SecondOrder2D(3.2, 0.88, sx, sy);
    this.baseSpine = [];
    this.renderSpine = [];
    for (let i = 0; i < this.numSegs; i++) {
      const zLift = this.computePostureElevation(i, 0);
      this.baseSpine.push({ x: sx - i * this.segLen, y: sy, z: zLift, angle: 0 });
      this.renderSpine.push({ x: sx - i * this.segLen, y: sy - zLift, groundY: sy, z: zLift, angle: 0 });
    }
    this.speed = 0;
    this.wavePhase = 0;

    // 2. 零延迟刚体伴随龙须链 (左右各 6 节)
    this.whiskers = [this.createWhisker(-1), this.createWhisker(1)];

    // 3. 2.5D 腹下支撑四足 IK (告别青蛙平摊，改为腹下前后错落支撑)
    this.limbs = [
      this.createLimb(4,  -1, 0, true),  // 远侧前腿
      this.createLimb(4,   1, 1, true),  // 近侧前腿
      this.createLimb(11, -1, 1, false), // 远侧后腿
      this.createLimb(11,  1, 0, false)  // 近侧后腿
    ];

    // 4. 弹射舌头与灵蝶生态
    this.tongue = { state: 'IDLE', progress: 0, tx: 0, ty: 0, targetPrey: null };
    this.butterflies = [];
    this.particles = [];
    this.blinkTimer = 3.0;
    this.blinkAmount = 0;

    this.spawnSwarm();
    this.initInput();
    this.initUI();

    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.animate(t));
  }

  /**
   * 初始化 360° 全景星穹、浮空仙山与穿云层数据
   */
  initPanoramaElements() {
    this.panoStars = [];
    for (let i = 0; i < 110; i++) {
      this.panoStars.push({
        az: Math.random() * Math.PI * 2, // 0 ~ 360° 全景方位角
        el: 0.05 + Math.random() * 0.58, // 高度比例
        size: 0.8 + Math.random() * 2.0,
        twinkle: Math.random() * 10
      });
    }

    // 360° 浮空灵岛与穿云丝带
    this.panoClouds = [];
    for (let i = 0; i < 14; i++) {
      this.panoClouds.push({
        az: (i / 14) * Math.PI * 2 + Math.random() * 0.3,
        el: 0.18 + Math.random() * 0.35,
        w: 90 + Math.random() * 110,
        h: 16 + Math.random() * 18,
        speed: 0.015 + Math.random() * 0.025,
        depth: 0.5 + Math.random() * 0.7
      });
    }
  }

  /**
   * 计算第 i 节脊椎的 2.5D 离地昂首高度 z (彻底告别趴在地板上的壁虎感！)
   */
  computePostureElevation(i, time) {
    const t = i / (this.numSegs - 1);
    const breath = Math.sin(time * 2.6 - i * 0.2) * 3.5;
    if (this.form === 'SWIM') {
      // 腾云游龙模式：整条龙高高悬浮于云海之上，呈三维波浪起伏
      return 65 + Math.sin(time * 3.2 - i * 0.35) * 18 + breath;
    }
    // 陆地昂首模式：龙头与天鹅颈高高昂起 (54px)，前胸挺拔 (30px)，腰腹支撑 (22px)，尾尖轻盈盘地
    const neckArch = Math.exp(-t * 4.2) * 38;
    const bodyStand = Math.sin(Math.pow(t, 0.7) * Math.PI) * 24;
    const crouchOffset = -this.alertLevel * (1 - t) * 14; // 警戒时前胸蓄力伏低，龙角竖起
    return Math.max(3, neckArch + bodyStand + breath + crouchOffset);
  }

  createWhisker(side) {
    const pts = [];
    for (let i = 0; i < 6; i++) pts.push({ x: this.width * 0.5, y: this.height * 0.5 });
    return { side, pts };
  }

  createLimb(spineIdx, side, group, isFront) {
    const s = this.baseSpine[spineIdx];
    return {
      spineIdx, side, group, isFront,
      L1: isFront ? 25 : 27,
      L2: isFront ? 25 : 27,
      footX: s.x, footY: s.y + 18,
      startX: s.x, startY: s.y + 18,
      targetX: s.x, targetY: s.y + 18,
      stepProg: 1.0,
      lift: 0
    };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  spawnButterfly(x, y) {
    if (this.butterflies.length >= 7) this.butterflies.shift();
    this.butterflies.push({
      ox: x, oy: y, x, y,
      phase: Math.random() * Math.PI * 2,
      wing: Math.random() * 10,
      caught: false
    });
    this.emitParticles(x, y, '#38bdf8', 10);
  }

  spawnSwarm() {
    for (let i = 0; i < 3; i++) {
      this.spawnButterfly(
        this.width * (0.28 + Math.random() * 0.55),
        this.height * (0.22 + Math.random() * 0.52)
      );
    }
  }

  emitParticles(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 35 + Math.random() * 130;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: 1.0,
        size: 2.5 + Math.random() * 3.0,
        color
      });
    }
  }

  initInput() {
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (this.isPanningSky) {
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.camYaw = wrapAngle(this.camYaw - dx * 0.005);
        this.camPitch = clamp(this.camPitch + dy * 0.003, 0.06, 0.48);
        return;
      }

      if (this.mode !== 'MOUSE') return;
      this.lastInputTime = performance.now();
      const dx = e.clientX - this.pointer.x;
      const dy = e.clientY - this.pointer.y;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      const moveSpd = Math.hypot(dx, dy);

      // 抚摸检测
      if (!this.isRightDown && moveSpd > 1.5 && moveSpd < 28) {
        for (let i = 1; i < 16; i++) {
          const seg = this.renderSpine[i];
          if (Math.hypot(this.pointer.x - seg.x, this.pointer.y - seg.y) < this.radii[i] + 18) {
            this.pettingGlow = 1.0;
            this.state = 'PETTING';
            if (Math.random() < 0.25) this.emitParticles(seg.x, seg.y, PALETTES[this.paletteKey].horn, 2);
            return;
          }
        }
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (e.target.closest('#ui-container')) return;
      // 按住中键 或 Alt+左键 可自由拖拽 360° 全景天穹
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this.isPanningSky = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        return;
      }
      if (this.mode !== 'MOUSE') return;
      this.lastInputTime = performance.now();
      if (e.button === 0) {
        this.triggerTongueStrike();
      } else if (e.button === 2) {
        this.isRightDown = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      this.isPanningSky = false;
      if (e.button === 2) this.isRightDown = false;
    });

    // 滚轮可调节 2.5D 俯仰视角 (camPitch)
    window.addEventListener('wheel', (e) => {
      this.camPitch = clamp(this.camPitch + e.deltaY * 0.0003, 0.08, 0.48);
    }, { passive: true });

    window.addEventListener('dblclick', (e) => {
      if (e.target.closest('#ui-container')) return;
      this.spawnButterfly(e.clientX, e.clientY);
    });

    window.addEventListener('keydown', (e) => {
      const keys = ['JADE', 'SAKURA', 'CYBER', 'LAVA', 'AURORA'];
      const num = parseInt(e.key);
      if (num >= 1 && num <= 5) this.setPalette(keys[num - 1], num - 1);
      if (e.key === ' ' || e.key === 'Tab') {
        e.preventDefault();
        this.toggleForm();
      }
      if (e.key === 'e' || e.key === 'E') this.isKeyAlert = true;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this.keysDown.left = true;
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this.keysDown.right = true;
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'e' || e.key === 'E') this.isKeyAlert = false;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this.keysDown.left = false;
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this.keysDown.right = false;
    });

    this.handTracker = new HandTracker((handData) => {
      if (this.mode !== 'CAMERA') return;
      if (!handData.detected) {
        this.lastInputTime = 0;
        return;
      }
      this.lastInputTime = performance.now();
      this.pointer.x = (1 - handData.indexTip.x) * this.width;
      this.pointer.y = handData.indexTip.y * this.height;
      this.isRightDown = Boolean(handData.isOpenPalm);
      if (handData.pinchStarted) this.triggerTongueStrike();
    });
  }

  initUI() {
    const formBtn = document.getElementById('form-toggle');
    if (formBtn) formBtn.addEventListener('click', () => this.toggleForm());

    const modeBtn = document.getElementById('mode-toggle');
    if (modeBtn) {
      modeBtn.addEventListener('click', () => {
        this.mode = this.mode === 'MOUSE' ? 'CAMERA' : 'MOUSE';
        if (this.mode === 'CAMERA') this.handTracker.start();
        else this.handTracker.stop();
        modeBtn.innerText = this.mode === 'MOUSE' ? '🖱️ 鼠标控制' : '📷 摄像头手势';
      });
    }

    const spawnBtn = document.getElementById('spawn-prey-btn');
    if (spawnBtn) spawnBtn.addEventListener('click', () => this.spawnSwarm());

    const pulseBtn = document.getElementById('pulse-btn');
    if (pulseBtn) pulseBtn.addEventListener('click', () => { this.pulseProgress = 0; });

    const freqSlider = document.getElementById('freq-slider');
    const zetaSlider = document.getElementById('zeta-slider');
    const freqVal = document.getElementById('freq-val');
    const zetaVal = document.getElementById('zeta-val');
    const updateDyn = () => {
      const f = parseFloat(freqSlider.value);
      const z = parseFloat(zetaSlider.value);
      if (freqVal) freqVal.innerText = f.toFixed(1);
      if (zetaVal) zetaVal.innerText = z.toFixed(2);
      this.headDyn.setParams(f, z);
    };
    if (freqSlider) freqSlider.addEventListener('input', updateDyn);
    if (zetaSlider) zetaSlider.addEventListener('input', updateDyn);

    const paletteContainer = document.getElementById('palette-container');
    if (paletteContainer) {
      paletteContainer.innerHTML = '';
      Object.keys(PALETTES).forEach((key, idx) => {
        const btn = document.createElement('button');
        btn.className = 'palette-btn' + (idx === 0 ? ' active' : '');
        btn.style.backgroundColor = PALETTES[key].body;
        btn.title = PALETTES[key].name;
        btn.addEventListener('click', () => this.setPalette(key, idx));
        paletteContainer.appendChild(btn);
      });
    }

    // 在指南底部补充 360° 全景操作提示
    const tipsEl = document.querySelector('.tips');
    if (tipsEl && !tipsEl.dataset.panoAdded) {
      tipsEl.dataset.panoAdded = '1';
      tipsEl.innerHTML += `<br/>• <strong>A/D 键 / Alt+左键拖拽 / 滚轮</strong>：360° 环视全景天穹与俯仰角`;
    }
  }

  toggleForm() {
    this.form = this.form === 'CRAWL' ? 'SWIM' : 'CRAWL';
    const btn = document.getElementById('form-toggle');
    if (btn) btn.innerText = this.form === 'CRAWL' ? '🐾 陆地爬行' : '🐉 腾云游龙';
    this.pulseProgress = 0;
  }

  setPalette(key, idx) {
    this.paletteKey = key;
    this.pulseProgress = 0;
    document.querySelectorAll('.palette-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
  }

  triggerTongueStrike() {
    if (this.tongue.state !== 'IDLE') return;
    const head = this.renderSpine[0];
    let bestPrey = null;
    let bestDist = 350;
    for (const b of this.butterflies) {
      const d = Math.hypot(b.x - head.x, b.y - head.y);
      if (d < bestDist) { bestDist = d; bestPrey = b; }
    }
    this.tongue.state = 'FIRING';
    this.tongue.progress = 0;
    this.tongue.targetPrey = bestPrey;
    this.tongue.tx = bestPrey ? bestPrey.x : this.pointer.x;
    this.tongue.ty = bestPrey ? bestPrey.y : this.pointer.y;
  }

  update(dt) {
    this.time += dt;

    // 1. 更新 360° 全景水平旋转角 camYaw
    if (this.keysDown.left) this.camYawVel = damp(this.camYawVel, -1.1, 8, dt);
    else if (this.keysDown.right) this.camYawVel = damp(this.camYawVel, 1.1, 8, dt);
    else {
      // 根据灵龙水平游动速度自动产生轻微的 360° 全景伴随环绕感
      const autoPan = (this.headDyn.vx / Math.max(600, this.width)) * 0.55;
      this.camYawVel = damp(this.camYawVel, autoPan, 5, dt);
    }
    this.camYaw = wrapAngle(this.camYaw + this.camYawVel * dt);

    // 2. 判定主状态
    const isIdleWander = performance.now() - this.lastInputTime > 5000;
    if (this.tongue.state !== 'IDLE') this.state = 'HUNT';
    else if (this.isRightDown || this.isKeyAlert) this.state = 'ALERT';
    else if (this.pettingGlow > 0.35) this.state = 'PETTING';
    else if (isIdleWander) this.state = 'WANDER';
    else this.state = 'FOLLOW';

    const labels = {
      FOLLOW: 'FOLLOW · 灵珠尾随',
      HUNT: 'HUNT · 弹舌捕食',
      ALERT: 'ALERT · 伏低警戒',
      PETTING: 'PETTING · 愉悦抚摸',
      WANDER: 'WANDER · 360° 巡游'
    };
    const badge = document.getElementById('state-badge');
    if (badge && badge.innerText !== labels[this.state]) badge.innerText = labels[this.state];

    this.alertLevel = damp(this.alertLevel, this.state === 'ALERT' ? 1 : 0, 10, dt);
    this.pettingGlow = damp(this.pettingGlow, 0, 2.8, dt);
    if (this.pulseProgress >= 0) {
      this.pulseProgress += dt * 1.6;
      if (this.pulseProgress > 1.3) this.pulseProgress = -1;
    }

    // 3. 计算连续停靠目标点 (注意：pointer 是屏幕视觉点，需换算回地面基准点供 baseSpine 追踪)
    let targetScreenX = this.pointer.x;
    let targetScreenY = this.pointer.y;
    if (isIdleWander) {
      this.wanderPhase += dt * 0.75;
      this.camYaw = wrapAngle(this.camYaw + dt * 0.12); // 巡游时全景缓慢 360° 环转
      targetScreenX = this.width * 0.52 + Math.sin(this.wanderPhase) * (this.width * 0.26);
      targetScreenY = this.height * 0.52 + Math.sin(this.wanderPhase * 2) * (this.height * 0.16);
    }

    const headLift = this.computePostureElevation(0, this.time);
    const targetGroundX = targetScreenX;
    const targetGroundY = targetScreenY + headLift;

    const head0 = this.baseSpine[0];
    const dxToHead = head0.x - targetGroundX;
    const dyToHead = head0.y - targetGroundY;
    const dist = Math.hypot(dxToHead, dyToHead);
    const followDist = 48;

    let desiredX = head0.x;
    let desiredY = head0.y;
    if (dist > followDist) {
      desiredX = targetGroundX + (dxToHead / dist) * followDist;
      desiredY = targetGroundY + (dyToHead / dist) * followDist;
    }

    const prevGroundHx = head0.x;
    const prevGroundHy = head0.y;
    const prevRenderHx = this.renderSpine[0].x;
    const prevRenderHy = this.renderSpine[0].y;

    this.headDyn.update(desiredX, desiredY, dt);
    head0.x = this.headDyn.x;
    head0.y = this.headDyn.y;

    const instSpeed = Math.hypot(head0.x - prevGroundHx, head0.y - prevGroundHy) / dt;
    this.speed = damp(this.speed, instSpeed < 6 ? 0 : instSpeed, 10, dt);

    // 4. 解算双层脊椎 + 2.5D 离地昂首高度 Z
    const curlFactor = clamp(1 - this.speed / 180, 0, 0.9);
    for (let i = 1; i < this.numSegs; i++) {
      const prev = this.baseSpine[i - 1];
      const curr = this.baseSpine[i];
      const rawAngle = Math.atan2(prev.y - curr.y, prev.x - curr.x);
      let diff = wrapAngle(rawAngle - prev.angle);
      const maxBend = i < 6 ? 0.30 : 0.25;
      diff = clamp(diff, -maxBend, maxBend);

      if (i > 12) {
        const spiralCurl = (i - 12) * 0.042 * curlFactor;
        diff = lerp(diff, spiralCurl, 1 - Math.exp(-5 * dt));
      }

      curr.angle = prev.angle + diff;
      curr.x = prev.x - Math.cos(curr.angle) * this.segLen;
      curr.y = prev.y - Math.sin(curr.angle) * this.segLen;
    }

    this.wavePhase += dt * Math.min(11, this.speed * 0.032);
    const waveAmp = clamp(this.speed * 0.04, 0, 14) * (this.form === 'SWIM' ? 1.45 : 0.75);

    for (let i = 0; i < this.numSegs; i++) {
      const b = this.baseSpine[i];
      const zLift = this.computePostureElevation(i, this.time);
      b.z = zLift;

      const nx = -Math.sin(b.angle), ny = Math.cos(b.angle);
      const env = i === 0 ? 0 : Math.sin((i / (this.numSegs - 1)) * Math.PI * 0.92);
      const wave = Math.sin(this.wavePhase - i * 0.42) * waveAmp * env;

      const gx = b.x + nx * wave;
      const gy = b.y + ny * wave * 0.65;
      this.renderSpine[i].x = gx;
      this.renderSpine[i].groundY = gy;
      // 关键 2.5D 投影：将昂首离地高度 z 映射到屏幕垂直抬升！
      this.renderSpine[i].y = gy - zLift;
      this.renderSpine[i].z = zLift;
    }

    // 重新计算屏幕空间下顺滑的脊椎切角（包含 S 型昂首天鹅颈弧度）
    const rHead = this.renderSpine[0];
    const lookX = this.tongue.state !== 'IDLE' ? this.tongue.tx : targetScreenX;
    const lookY = this.tongue.state !== 'IDLE' ? this.tongue.ty : targetScreenY;
    const desiredHeadAngle = Math.atan2(lookY - rHead.y, lookX - rHead.x);
    rHead.angle = lerpAngle(rHead.angle, desiredHeadAngle, 1 - Math.exp(-15 * dt));

    // ✅ 用前后跨节向量 (prev -> next) 算切线角，消除单节高度差造成的折角突变
    for (let i = 1; i < this.numSegs; i++) {
      const prev = this.renderSpine[i - 1];
      const next = this.renderSpine[Math.min(this.numSegs - 1, i + 1)];
      this.renderSpine[i].angle = Math.atan2(prev.y - next.y, prev.x - next.x);
    }

    // 5. ✅ 零延迟刚体伴随 + 硬定长龙须更新（彻底消灭龙须滞后！）
    const dxRenderHead = rHead.x - prevRenderHx;
    const dyRenderHead = rHead.y - prevRenderHy;
    const whiskerSegLen = 11;
    for (const w of this.whiskers) {
      w.pts[0].x = rHead.x + Math.cos(rHead.angle) * 16 - Math.sin(rHead.angle) * w.side * 8;
      w.pts[0].y = rHead.y + Math.sin(rHead.angle) * 16 + Math.cos(rHead.angle) * w.side * 8;

      for (let i = 1; i < w.pts.length; i++) {
        const prev = w.pts[i - 1], curr = w.pts[i];
        // 刚体伴随平移：直接继承本帧龙头 92% 的位移，0 延迟！
        const advect = 0.92 - i * 0.03;
        curr.x += dxRenderHead * advect;
        curr.y += dyRenderHead * advect;

        const flutter = Math.sin(this.time * 7.5 - i * 0.65 + w.side) * 0.16;
        const idealDir = rHead.angle + Math.PI + w.side * (0.30 + i * 0.07) + flutter;
        const curDir = Math.atan2(curr.y - prev.y, curr.x - prev.x);
        const newDir = lerpAngle(curDir, idealDir, 1 - Math.exp(-(24 - i * 2) * dt));

        // 严格锁死节长，绝不被拉长成橡皮筋
        curr.x = prev.x + Math.cos(newDir) * whiskerSegLen;
        curr.y = prev.y + Math.sin(newDir) * whiskerSegLen;
      }
    }

    // 6. 更新 2.5D 腹下支撑四足步态 (脚踩在 groundY 地面上，撑起悬空的昂首躯干！)
    const groupBusy = [false, false];
    for (const l of this.limbs) if (l.stepProg < 1) groupBusy[l.group] = true;

    for (const l of this.limbs) {
      const anchor = this.renderSpine[l.spineIdx];
      const baseNode = this.baseSpine[l.spineIdx];
      const c = Math.cos(baseNode.angle);

      if (this.form === 'SWIM') {
        // 游龙模式：四肢向后流线型收拢贴腹
        const tuckX = anchor.x - Math.cos(anchor.angle) * 26;
        const tuckY = anchor.y - Math.sin(anchor.angle) * 26 + 10 + l.side * 4;
        l.footX = damp(l.footX, tuckX, 14, dt);
        l.footY = damp(l.footY, tuckY, 14, dt);
        l.stepProg = 1;
        l.lift = 0;
        continue;
      }

      // 2.5D 陆地站立落脚点：位于肩部/胯部正下方的地面 (groundY)，前后错开形成立体透视
      const strideFwd = (l.isFront ? 14 : -10) * c + l.side * 12;
      const depthOffsetY = l.side * 9; // 远侧腿(-1)略高，近侧腿(+1)略低，形成 2.5D 地面透视差
      const idealX = baseNode.x + strideFwd + this.headDyn.vx * 0.065;
      const idealY = anchor.groundY + depthOffsetY + this.headDyn.vy * 0.04;

      if (l.stepProg >= 1) {
        const err = Math.hypot(idealX - l.footX, idealY - l.footY);
        if (err > 28 && (!groupBusy[1 - l.group] || err > 56)) {
          l.stepProg = 0;
          l.startX = l.footX; l.startY = l.footY;
          l.targetX = idealX; l.targetY = idealY;
          groupBusy[l.group] = true;
        }
      } else {
        l.stepProg = Math.min(1, l.stepProg + dt * 7.2);
        const t = l.stepProg;
        const st = t * t * (3 - 2 * t);
        l.footX = lerp(l.startX, idealX, st);
        l.footY = lerp(l.startY, idealY, st);
        l.lift = Math.sin(t * Math.PI) * 14;
      }
    }

    // 7. 弹舌与灵蝶更新
    if (this.tongue.state === 'FIRING') {
      if (this.tongue.targetPrey) {
        this.tongue.tx = this.tongue.targetPrey.x;
        this.tongue.ty = this.tongue.targetPrey.y;
      }
      this.tongue.progress += dt * 9.8;
      if (this.tongue.progress >= 1) {
        this.tongue.progress = 1;
        this.tongue.state = 'RETRACTING';
        if (this.tongue.targetPrey) this.tongue.targetPrey.caught = true;
        this.emitParticles(this.tongue.tx, this.tongue.ty, PALETTES[this.paletteKey].horn, 15);
        this.pulseProgress = 0;
      }
    } else if (this.tongue.state === 'RETRACTING') {
      this.tongue.progress -= dt * 6.0;
      if (this.tongue.progress <= 0) {
        this.tongue.progress = 0;
        this.tongue.state = 'IDLE';
        if (this.tongue.targetPrey) {
          const idx = this.butterflies.indexOf(this.tongue.targetPrey);
          if (idx !== -1) this.butterflies.splice(idx, 1);
          this.tongue.targetPrey = null;
        }
      }
    }

    for (const b of this.butterflies) {
      b.wing += dt * 32;
      if (!b.caught) {
        b.phase += dt * 1.8;
        b.x = b.ox + Math.sin(b.phase * 1.3) * 36;
        b.y = b.oy + Math.cos(b.phase * 1.7) * 24;
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt * 1.9;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkAmount += dt * 14;
      if (this.blinkAmount >= Math.PI) {
        this.blinkAmount = 0;
        this.blinkTimer = 2.5 + Math.random() * 3.5;
      }
    }
  }

  /**
   * 将 360° 全景方位角 az 投影为屏幕 X 坐标 (视野 FOV = 120°)
   */
  projectAzimuthToX(az) {
    const diff = wrapAngle(az - this.camYaw);
    const fov = (Math.PI * 2) / 3; // 120° 广角全景视野
    return this.width * 0.5 + (diff / (fov * 0.5)) * (this.width * 0.5);
  }

  /**
   * 绘制 360° 全景环绕天穹、浮空水晶仙山、穿云丝带与 3D 透视灵池地面
   */
  draw360PanoramaWorld(ctx, pal) {
    const horizonY = this.height * (0.48 + this.camPitch * 0.35);

    // 1. 天穹与灵池深邃背景渐变
    const skyGrad = ctx.createLinearGradient(0, 0, 0, this.height);
    skyGrad.addColorStop(0, '#040814');
    skyGrad.addColorStop(clamp(horizonY / this.height, 0.2, 0.8), '#0f1f3d');
    skyGrad.addColorStop(1, '#030712');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    // 2. 360° 环绕星穹与极光星带
    ctx.save();
    for (const st of this.panoStars) {
      const sx = this.projectAzimuthToX(st.az);
      if (sx < -20 || sx > this.width + 20) continue;
      const sy = st.el * horizonY * 0.92;
      const alpha = 0.35 + 0.55 * Math.sin(this.time * 2.2 + st.twinkle);
      ctx.fillStyle = `rgba(226, 232, 240, ${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, st.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 3. 360° 周期闭合连绵浮空仙山剪影 (多层傅里叶谐波地形)
    for (let layer = 0; layer < 2; layer++) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      const step = 16;
      const fov = (Math.PI * 2) / 3;
      for (let x = 0; x <= this.width + step; x += step) {
        const normX = (x - this.width * 0.5) / (this.width * 0.5);
        const worldAz = this.camYaw + normX * (fov * 0.5) * (layer === 0 ? 0.85 : 1.0);
        const h =
          Math.sin(worldAz * 3 + layer * 2.1) * 28 +
          Math.cos(worldAz * 7 - layer * 1.4) * 16 +
          Math.sin(worldAz * 13) * 7 +
          (layer === 0 ? 54 : 28);
        ctx.lineTo(x, horizonY - Math.max(4, h));
      }
      ctx.lineTo(this.width, horizonY);
      ctx.closePath();
      ctx.fillStyle = layer === 0 ? 'rgba(15, 32, 66, 0.55)' : 'rgba(10, 22, 46, 0.85)';
      ctx.fill();
      ctx.restore();
    }

    // 4. 360° 透视灵池地平线与旋转罗盘经纬线 (赋予地面强烈的 3D 空间纵深)
    ctx.save();
    ctx.strokeStyle = pal.glow;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.22;
    const numRays = 24;
    for (let i = 0; i < numRays; i++) {
      const rayAz = (i / numRays) * Math.PI * 2;
      const topX = this.projectAzimuthToX(rayAz);
      if (topX < -this.width * 0.5 || topX > this.width * 1.5) continue;
      const bottomX = this.width * 0.5 + (topX - this.width * 0.5) * 3.6;
      ctx.beginPath();
      ctx.moveTo(topX, horizonY);
      ctx.lineTo(bottomX, this.height);
      ctx.stroke();
    }
    // 水平透视纬线
    for (let j = 1; j <= 6; j++) {
      const t = Math.pow(j / 6, 1.8);
      const y = lerp(horizonY, this.height, t);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
    ctx.restore();

    // 5. 360° 环绕流云层
    ctx.save();
    for (const c of this.panoClouds) {
      c.az = wrapAngle(c.az + c.speed * 0.016);
      const cx = this.projectAzimuthToX(c.az);
      if (cx < -150 || cx > this.width + 150) continue;
      const cy = c.el * horizonY + Math.sin(this.time + c.az) * 6;
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, c.w);
      grad.addColorStop(0, 'rgba(148, 163, 184, 0.14)');
      grad.addColorStop(1, 'rgba(148, 163, 184, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, c.w, c.h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 6. 右上角精巧的 360° 全景罗盘指示器
    this.drawCompassHUD(ctx, pal);
  }

  drawCompassHUD(ctx, pal) {
    const cx = this.width - 54, cy = 48, r = 24;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.translate(cx, cy);
    ctx.rotate(-this.camYaw);
    ctx.fillStyle = pal.horn;
    ctx.beginPath();
    ctx.moveTo(0, -r + 5);
    ctx.lineTo(4, 0);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.moveTo(0, r - 5);
    ctx.lineTo(4, 0);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    const deg = Math.round(((this.camYaw * 180) / Math.PI + 360) % 360);
    ctx.fillText(`360° 全景 ${deg}°`, cx, cy + r + 15);
  }

 
  draw() {
    const ctx = this.ctx;
    const pal = PALETTES[this.paletteKey];

    // 1. 绘制 360° 全景天穹、仙山与透视灵池
    this.draw360PanoramaWorld(ctx, pal);

    // 2. 绘制引导灵珠
    if (this.state !== 'WANDER') {
      const orbGrad = ctx.createRadialGradient(this.pointer.x, this.pointer.y, 2, this.pointer.x, this.pointer.y, 26);
      orbGrad.addColorStop(0, '#ffffff');
      orbGrad.addColorStop(0.35, pal.horn);
      orbGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = orbGrad;
      ctx.beginPath();
      ctx.arc(this.pointer.x, this.pointer.y, 26, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. 绘制地面真实投影 (与悬空昂首的龙身纵向分离，塑造强烈 2.5D 站立/悬浮高度感！)
    ctx.save();
    for (let i = 0; i < this.numSegs; i++) {
      const s = this.renderSpine[i];
      const rx = this.radii[i] * 1.25;
      const ry = this.radii[i] * 0.50;
      ctx.fillStyle = 'rgba(2, 6, 23, 0.34)';
      ctx.beginPath();
      ctx.ellipse(s.x, s.groundY + 8, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 4. 画家算法第 1 层：绘制【远侧腿 (side = -1)】（位于龙身背面，色调深邃立体）
    this.drawLimbLayer(ctx, pal, -1);

    // 5. 画家算法第 2 层：绘制背部向上挺立的【半透明流光背鳍丝带 + 菱形水晶棘冠 + 尾尖羽扇】
    this.drawUprightDorsalFinAndPlume(ctx, pal);

    // 6. 画家算法第 3 层：绘制弹道舌头
    if (this.tongue.state !== 'IDLE') {
      this.drawBallisticTongue(ctx);
    }

    // 7. 画家算法第 4 层：绘制 2.5D 昂首流线龙身与立体下腹甲
    this.draw25DDragonBody(ctx, pal);

    // 8. 画家算法第 5 层：绘制【近侧腿 (side = +1)】（位于龙身正面，带肩部亮面肌肉与利爪）
    this.drawLimbLayer(ctx, pal, 1);

    // 9. 画家算法第 6 层：绘制 2.5D 昂首立体龙头、零延迟龙须、前后分叉龙角与竖瞳宝石眼
    this.drawSculpted25DDragonHead(ctx, pal);

    // 10. 画家算法第 7 层：绘制发光灵蝶与粒子特效
    this.drawButterfliesAndParticles(ctx);
  }

  /**
   * 分层绘制远侧腿 (-1) 与近侧腿 (+1)：从胸腹向下踩在地面，彻底告别趴地青蛙腿
   */
  drawLimbLayer(ctx, pal, targetSide) {
    for (const l of this.limbs) {
      if (l.side !== targetSide) continue;

      const anchor = this.renderSpine[l.spineIdx];
      // 肩髋关节位于龙身偏腹侧
      const sx = anchor.x + l.side * 4;
      const sy = anchor.y + this.radii[l.spineIdx] * 0.42 + l.side * 3;
      const fx = l.footX;
      const fy = l.footY - l.lift;

      // 2.5D 侧面站立 2-Bone IK：前腿肘关节略向后弯，后腿膝关节略向前弯
      const dx = fx - sx, dy = fy - sy;
      const d = clamp(Math.hypot(dx, dy), 6, (l.L1 + l.L2) * 0.96);
      const baseA = Math.atan2(dy, dx);
      const cosA = (l.L1 ** 2 + d ** 2 - l.L2 ** 2) / (2 * l.L1 * d);
      const alpha = Math.acos(clamp(cosA, -1, 1));
      const facingSign = Math.cos(anchor.angle) >= 0 ? 1 : -1;
      const bendDir = (l.isFront ? -1 : 1) * facingSign;
      const kneeA = baseA + bendDir * alpha;

      const mx = sx + Math.cos(kneeA) * l.L1;
      const my = sy + Math.sin(kneeA) * l.L1;

      ctx.save();
      if (targetSide === -1) {
        // 远侧腿：压暗表现景深遮挡
        ctx.strokeStyle = pal.dark;
        ctx.globalAlpha = 0.85;
      } else {
        const legGrad = ctx.createLinearGradient(sx, sy, fx, fy);
        legGrad.addColorStop(0, pal.body);
        legGrad.addColorStop(1, pal.dark);
        ctx.strokeStyle = legGrad;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 大腿与小腿流线肌肉段
      ctx.lineWidth = 12.5;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(mx, my); ctx.stroke();

      ctx.lineWidth = 8.5;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(fx, fy); ctx.stroke();

      // 近侧腿肩部高光融合点
      if (targetSide === 1) {
        ctx.fillStyle = pal.belly;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }

      // 水平踩地三趾水晶龙爪
      const fDir = facingSign >= 0 ? 0 : Math.PI;
      ctx.fillStyle = targetSide === 1 ? pal.horn : pal.body;
      for (const offsetA of [-0.32, 0, 0.28]) {
        const ca = fDir + offsetA;
        ctx.beginPath();
        ctx.moveTo(fx, fy - 2);
        ctx.lineTo(fx + Math.cos(ca) * 11, fy + Math.sin(ca) * 4 + 2);
        ctx.lineTo(fx, fy + 2.5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /**
   * 绘制背部向上高高扬起的半透明流光背鳍丝带 + 菱形水晶棘冠 + 尾尖流光羽扇
   */
  drawUprightDorsalFinAndPlume(ctx, pal) {
    const puff = 1 + this.alertLevel * 0.22;
    const ridgeBase = [];
    const finTips = [];

    // ✅ 修复：整条龙共用同一个平滑过渡的背鳍侧向系数，绝不在单节之间跳变！
    const headCos = Math.cos(this.renderSpine[0].angle);
    if (Math.abs(headCos) > 0.15) {
      this.targetDorsalSign = headCos >= 0 ? -1 : 1;
    }
    this.dorsalSign = damp(this.dorsalSign ?? -1, this.targetDorsalSign ?? -1, 8, 0.016);

    for (let i = 1; i < this.numSegs - 1; i++) {
      const s = this.renderSpine[i];
      const t = i / (this.numSegs - 1);
      // 统一的连续背侧法向量
      const upX = -Math.sin(s.angle) * this.dorsalSign;
      const upY =  Math.cos(s.angle) * this.dorsalSign;

      const r = this.radii[i] * puff * 0.78;
      const bx = s.x + upX * r;
      const by = s.y + upY * r;
      ridgeBase.push({ x: bx, y: by });

      const wave = Math.sin(this.time * 6 - i * 0.5) * 3.5;
      const finH = (9 + Math.sin(t * Math.PI) * 15) * (1 + this.alertLevel * 0.4) + wave;
      finTips.push({ x: bx + upX * finH, y: by + upY * finH });
    }

    // 1. 连贯平滑的半透明背鳍膜
    ctx.save();
    ctx.fillStyle = pal.fin;
    ctx.strokeStyle = pal.horn;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ridgeBase[0].x, ridgeBase[0].y);
    for (let i = 0; i < finTips.length - 1; i++) {
      const mx = (finTips[i].x + finTips[i + 1].x) * 0.5;
      const my = (finTips[i].y + finTips[i + 1].y) * 0.5;
      ctx.quadraticCurveTo(finTips[i].x, finTips[i].y, mx, my);
    }
    for (let i = ridgeBase.length - 1; i >= 0; i--) {
      ctx.lineTo(ridgeBase[i].x, ridgeBase[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 2. 背脊水晶棘刺
    for (let i = 1; i < finTips.length - 1; i += 2) {
      const prevB = ridgeBase[i - 1];
      const nextB = ridgeBase[i + 1];
      const tip = finTips[i];
      const t = i / finTips.length;
      const pulseDist = this.pulseProgress >= 0 ? Math.abs(t - this.pulseProgress) : 99;
      const pulseBoost = Math.exp(-pulseDist * pulseDist * 40);

      ctx.fillStyle = pulseBoost > 0.15 ? '#ffffff' : pal.horn;
      ctx.beginPath();
      ctx.moveTo((prevB.x + ridgeBase[i].x) * 0.5, (prevB.y + ridgeBase[i].y) * 0.5);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo((nextB.x + ridgeBase[i].x) * 0.5, (nextB.y + ridgeBase[i].y) * 0.5);
      ctx.closePath();
      ctx.fill();
    }

    // 3. 尾尖流光羽扇
    const tail = this.renderSpine[this.numSegs - 1];
    ctx.translate(tail.x, tail.y);
    ctx.rotate(tail.angle + Math.PI);
    ctx.fillStyle = pal.fin;
    ctx.strokeStyle = pal.belly;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(18, -14, 34, -4);
    ctx.quadraticCurveTo(42, 0, 34, 4);
    ctx.quadraticCurveTo(18, 14, 0, 0);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 绘制 2.5D 昂首流线龙身、立体下腹甲鳞片与流光龙脉
   */
  draw25DDragonBody(ctx, pal) {
    const puff = 1 + this.alertLevel * 0.20;
    const topPts = [];
    const botPts = [];

    for (let i = 0; i < this.numSegs; i++) {
      const s = this.renderSpine[i];
      const r = this.radii[i] * puff;
      // ✅ 修复：使用连续法向量 (-sin, cos)，绝不在循环内做 if (upY > 0) 翻转！
      const nx = -Math.sin(s.angle);
      const ny =  Math.cos(s.angle);

      topPts.push({ x: s.x + nx * r, y: s.y + ny * r });
      botPts.push({ x: s.x - nx * r, y: s.y - ny * r });
    }

    const tail = this.renderSpine[this.numSegs - 1];
    const tip = { x: tail.x - Math.cos(tail.angle) * 9, y: tail.y - Math.sin(tail.angle) * 9 };
    const contour = [...topPts, tip, ...botPts.reverse()];

    ctx.save();
    traceSmoothClosedSpline(ctx, contour);

    const head = this.renderSpine[0];
    const bodyGrad = ctx.createLinearGradient(head.x, head.y - 60, tail.x, tail.y + 60);
    bodyGrad.addColorStop(0, pal.belly);
    bodyGrad.addColorStop(0.4, pal.body);
    bodyGrad.addColorStop(1, pal.dark);
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // 内部腹甲纹路（沿脊椎中心绘制，任意角度都不翻转）
    ctx.clip();
    ctx.strokeStyle = pal.belly;
    for (let i = 2; i < this.numSegs - 3; i++) {
      const s = this.renderSpine[i];
      const r = this.radii[i] * 0.72;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, s.angle - 1.1, s.angle + 1.1);
      ctx.stroke();

      if (this.pulseProgress >= 0) {
        const t = i / (this.numSegs - 1);
        const d = Math.abs(t - this.pulseProgress);
        const boost = Math.exp(-d * d * 45);
        if (boost > 0.08) {
          ctx.globalAlpha = boost * 0.75;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(s.x, s.y, r * 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /**
   * 绘制 2.5D 侧转透视龙首：含前后分叉水晶龙角、零延迟龙须、腮鳍与宝石竖瞳
   */
  drawSculpted25DDragonHead(ctx, pal) {
    const head = this.renderSpine[0];
    const facingRight = Math.cos(head.angle) >= 0;

    // 1. 绘制零延迟飘逸龙须
    ctx.save();
    ctx.strokeStyle = pal.horn;
    ctx.lineCap = 'round';
    for (const w of this.whiskers) {
      ctx.beginPath();
      ctx.moveTo(w.pts[0].x, w.pts[0].y);
      for (let i = 1; i < w.pts.length - 1; i++) {
        const xc = (w.pts[i].x + w.pts[i + 1].x) * 0.5;
        const yc = (w.pts[i].y + w.pts[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(w.pts[i].x, w.pts[i].y, xc, yc);
      }
      ctx.lineWidth = w.side === 1 ? 2.4 : 1.7;
      ctx.globalAlpha = w.side === 1 ? 0.95 : 0.65;
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(head.angle);
    // 保证无论龙头朝左还是朝右，头顶与龙角永远朝向屏幕上方 (不翻肚皮！)
    if (!facingRight) ctx.scale(1, -1);

    // 2. 远侧龙角 (位于头后方，颜色略深形成 2.5D 立体前后关系)
    ctx.fillStyle = pal.body;
    this.drawBranchingHorn(ctx, -6, -10, 0.85);

    // 3. 2.5D 侧面雕刻感龙颅与龙吻轮廓
    const headGrad = ctx.createLinearGradient(0, -18, 0, 16);
    headGrad.addColorStop(0, pal.belly);
    headGrad.addColorStop(0.45, pal.body);
    headGrad.addColorStop(1, pal.dark);
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.moveTo(28, 2);                   // 微微上翘的龙吻尖
    ctx.quadraticCurveTo(14, -12, 2, -16); // 饱满额头眉弓
    ctx.quadraticCurveTo(-14, -16, -20, -2); // 后脑
    ctx.quadraticCurveTo(-14, 14, 4, 13);    // 下颌护甲
    ctx.quadraticCurveTo(18, 12, 28, 2);
    ctx.closePath();
    ctx.fill();

    // 4. 脸颊半透明水晶腮鳍
    ctx.fillStyle = pal.belly;
    ctx.globalAlpha = 0.78;
    ctx.beginPath();
    ctx.moveTo(-4, 6);
    ctx.quadraticCurveTo(-20, 20 + this.alertLevel * 8, -32, 12);
    ctx.quadraticCurveTo(-20, 2, -8, 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // 5. 近侧主水晶分叉龙角 (高亮金芒)
    ctx.fillStyle = pal.horn;
    this.drawBranchingHorn(ctx, -2, -8, 1.05);

    // 6. 灵动宝石竖瞳龙眼 (含眨眼与抚摸眯眼微笑)
    const squint = Math.max(Math.sin(this.blinkAmount), this.pettingGlow * 0.85);
    ctx.save();
    ctx.translate(7, -3.5);
    ctx.scale(1, Math.max(0.12, 1 - squint * 0.85));

    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 6.2, 4.8, -0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.ellipse(1.2, 0, 2.2, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(2.4, -1.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  drawBranchingHorn(ctx, ox, oy, scale) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    const lift = this.alertLevel * 6;
    // 主角后掠上扬
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-18, -14, -40, -22 - lift);
    ctx.quadraticCurveTo(-22, -4, -6, 4);
    ctx.closePath();
    ctx.fill();
    // 副角分叉
    ctx.beginPath();
    ctx.moveTo(-14, -9);
    ctx.lineTo(-26, -24 - lift);
    ctx.lineTo(-20, -7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawBallisticTongue(ctx) {
    const head = this.renderSpine[0];
    const mouthX = head.x + Math.cos(head.angle) * 24;
    const mouthY = head.y + Math.sin(head.angle) * 24;
    const t = this.tongue.progress;
    const tipX = lerp(mouthX, this.tongue.tx, t);
    const tipY = lerp(mouthY, this.tongue.ty, t);

    if (this.tongue.targetPrey && this.tongue.targetPrey.caught) {
      this.tongue.targetPrey.x = tipX;
      this.tongue.targetPrey.y = tipY;
    }

    ctx.save();
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mouthX, mouthY);
    const midX = (mouthX + tipX) * 0.5 - Math.sin(head.angle) * Math.sin(t * Math.PI) * 18;
    const midY = (mouthY + tipY) * 0.5 + Math.cos(head.angle) * Math.sin(t * Math.PI) * 18;
    ctx.quadraticCurveTo(midX, midY, tipX, tipY);
    ctx.stroke();

    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(tipX, tipY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawButterfliesAndParticles(ctx) {
    for (const b of this.butterflies) {
      ctx.save();
      ctx.translate(b.x, b.y);
      const wingScale = 0.35 + Math.abs(Math.sin(b.wing)) * 0.65;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.88)';
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.scale(s * wingScale, 1);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(14, -12, 16, -2);
        ctx.quadraticCurveTo(12, 10, 0, 4);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  animate(now) {
    requestAnimationFrame((t) => this.animate(t));
    const dt = Math.min((now - this.lastTime) / 1000, 0.04);
    this.lastTime = now;
    this.update(dt);
    this.draw();
  }
}

new Dragon25DPanoramaApp();
