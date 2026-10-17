/**
 * 祝贺用那场烟花 —— canvas 2D 自绘，**不引第三方库**（仓库里没有 canvas-confetti，也不该为
 * 一次界面效果为一个 MV3 扩展加运行时依赖）。
 *
 * 为什么单独成模块、不写在组件的 `<script setup>` 里：这一段要能在台架里对**真 canvas** 跑一次
 * 才算数 —— 要验的是「真的画出了东西」，不是「组件挂载了」。同 `src/options/reseedNoticeCard.ts`
 * 那次一样的理由。
 *
 * 三条形状上的约束（都影响观感，改之前先看）：
 * - 画布是**透明**的，盖在页面上不遮内容，所以拖尾不能用常规那招「每帧刷一层半透明黑」——
 *   那会把底下的页面糊黑。改成每帧用 `destination-out` 按一点 alpha **擦掉已有像素**，
 *   拖尾同样会淡出，而背景保持透明。
 * - 粒子用 `globalCompositeOperation = "lighter"`：两束光在交点相加，那才是烟花的亮芯。
 *   这一档必须在整批绘制前设一次、在擦除前换回 `destination-out`，逐颗粒子设置会白掉一帧几万次状态切换。
 * - 物理按**秒**积分（dt），不按帧：台架那种隐藏标签里 rAF 会被压到秒级甚至完全停住，
 *   按帧写的话一恢复就是满屏粒子瞬移。dt 还要夹一个上限，否则标签页回来那一帧会跳过头。
 */

/** 上升段与爆开后各自的加速度（CSS px/s²） */
const SHELL_GRAVITY = 420;
const PARTICLE_GRAVITY = 240;
/** 速度衰减，按 60fps 归一后再按 dt 取幂 */
const DRAG_PER_FRAME = 0.985;
/** 每帧擦掉已有像素的比例：太小会留长尾巴糊成一片，太大粒子还没散开就消失了 */
const TRAIL_FADE_ALPHA = 0.14;
/** 同屏粒子上限：一轮爆发 90~140 颗，兜住「十发同时炸」把一帧画到几千次 beginPath */
const MAX_PARTICLES = 1600;
/** 色相盘：暖金 / 橙红 / 品红 / 紫 / 青蓝 / 草绿，都是烟花常见那几档 */
const HUES = [45, 22, 340, 292, 200, 150];

interface IShell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
}

interface IParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  /** 1 → 0，同时当 alpha 用 */
  life: number;
  /** 每秒衰减多少（各颗不同，一片里才有先后散开的层次） */
  decay: number;
  size: number;
  /** 一闪一闪那一档 */
  sparkle: boolean;
}

interface IFlash {
  x: number;
  y: number;
  life: number;
}

export interface IFireworksOptions {
  /** 整场时长（ms）；到点后等最后一批粒子散尽再收。`loop` 为真时这一项不起作用 */
  durationMs?: number;
  /**
   * 循环放：按同一个节奏一直发射，直到调用 `stop()`（用户 2026-10-17 要的形状 ——
   * 祝贺卡不自己消失，烟花就得陪着它，不能放完六秒自己收）。
   * 这一档没有自然结束，所以 `onEnd` 永远不会被调到。
   */
  loop?: boolean;
  /** 自然放完（不是被 stop 掉）时的回调 */
  onEnd?: () => void;
}

export interface IFireworksHandle {
  stop: () => void;
}

/**
 * 在给定 canvas 上放一场烟花。画布尺寸取元素自己的 CSS 尺寸（所以外层要先把它铺满视口），
 * 并跟着 `resize` 重铺 —— 用户一边看烟花一边拖窗口，画布不跟就会画到裁掉的区域外。
 */
export function playFireworks(canvas: HTMLCanvasElement, options: IFireworksOptions = {}): IFireworksHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { stop: () => {} };

  const durationMs = options.durationMs ?? 6000;
  const loop = options.loop === true;
  /** 发射段占前六成时间：后面那段只留余烬散开，整场才不会显得一直不停（loop 档不收敛这一段） */
  const launchUntilMs = loop ? Number.POSITIVE_INFINITY : durationMs * 0.62;

  const shells: IShell[] = [];
  const particles: IParticle[] = [];
  const flashes: IFlash[] = [];

  let width = 0;
  let height = 0;
  let raf = 0;
  let lastAt = 0;
  let startAt = 0;
  let nextLaunchAt = 0;
  let ended = false;

  const resize = (): void => {
    // DPR 上限 2：再高只是更锐，代价是整屏按物理像素铺，一帧的填充量翻几倍
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const burst = (x: number, y: number, hue: number): void => {
    const room = Math.max(0, MAX_PARTICLES - particles.length);
    const count = Math.min(90 + Math.floor(Math.random() * 50), room);
    // 每发一个「配称色」：全用同一支色相会像一堵色墙，错开一点才有花球那一团
    const companion = (hue + 36) % 360;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.14;
      const speed = 42 + Math.pow(Math.random(), 0.62) * 158;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        hue: Math.random() < 0.28 ? companion : hue,
        life: 1,
        decay: 0.5 + Math.random() * 0.6,
        size: 1.3 + Math.random() * 1.7,
        sparkle: Math.random() < 0.3,
      });
    }
    flashes.push({ x, y, life: 1 });
  };

  const launch = (): void => {
    const x = width * (0.12 + Math.random() * 0.76);
    const apex = height * (0.12 + Math.random() * 0.34);
    // 到顶点时纵向速度刚好归零 → v0 = √(2·g·上升距离)，不然要么提前炸在半空要么飞出上沿
    const v0 = Math.sqrt(2 * SHELL_GRAVITY * Math.max(40, height - apex));
    shells.push({ x, y: height + 6, vx: (Math.random() - 0.5) * 24, vy: -v0, hue: HUES[Math.floor(Math.random() * HUES.length)] });
  };

  const frame = (now: number): void => {
    if (ended) return;
    const dt = Math.min(Math.max((now - lastAt) / 1000, 0), 0.05);
    lastAt = now;
    const elapsed = now - startAt;

    // 拖尾：透明画布上只能「擦」不能「糊黑」（见文件头那条）
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE_ALPHA})`;
    ctx.fillRect(0, 0, width, height);

    if (elapsed < launchUntilMs && now >= nextLaunchAt) {
      launch();
      nextLaunchAt = now + 260 + Math.random() * 420;
    }

    ctx.globalCompositeOperation = "lighter";

    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i];
      s.vy += SHELL_GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      // 上升段那一根细线：不画的话观众只看见「空中突然炸开」，看不出是从下头打上去的
      ctx.fillStyle = `hsla(${s.hue}, 100%, 72%, 0.85)`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.7, 0, Math.PI * 2);
      ctx.fill();
      if (s.vy >= 0 || s.y <= height * 0.1) {
        burst(s.x, s.y, s.hue);
        shells.splice(i, 1);
      }
    }

    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.life -= dt * 3.2;
      if (f.life <= 0) {
        flashes.splice(i, 1);
        continue;
      }
      const radius = 26 + (1 - f.life) * 74;
      const glow = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, radius);
      glow.addColorStop(0, `rgba(255, 255, 255, ${0.5 * f.life})`);
      glow.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    const drag = Math.pow(DRAG_PER_FRAME, dt * 60);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= p.decay * dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.vx *= drag;
      p.vy = p.vy * drag + PARTICLE_GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // 闪烁那部分随机压暗，一片里才看得出噼啪，而不是均匀地一起淡
      const alpha = p.sparkle ? p.life * (Math.random() < 0.45 ? 0.35 : 1) : p.life;
      ctx.fillStyle = `hsla(${p.hue}, 100%, ${58 + 22 * Math.min(1, p.life)}%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // 收场：时间到了、天上没东西了才停 —— 到点硬切的观感是「烟花被人生生掐掉」。
    // loop 档没有自然收场（只有 stop()），所以这两条一律不参与判定。
    if (!loop && elapsed >= durationMs && shells.length === 0 && particles.length === 0 && flashes.length === 0) {
      ended = true;
      ctx.globalCompositeOperation = "destination-out";
      ctx.clearRect(0, 0, width, height);
      options.onEnd?.();
      return;
    }
    // 兜底：隐藏标签里 rAF 不跑，回来时时间戳已经跳过去一大截，别在那一帧还继续补发射
    if (!loop && elapsed > durationMs + 8000) {
      ended = true;
      options.onEnd?.();
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  resize();
  window.addEventListener("resize", resize);
  startAt = performance.now();
  lastAt = startAt;
  nextLaunchAt = startAt;
  raf = requestAnimationFrame(frame);

  return {
    stop: () => {
      ended = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      shells.length = 0;
      particles.length = 0;
      flashes.length = 0;
      ctx.globalCompositeOperation = "destination-out";
      ctx.clearRect(0, 0, width, height);
    },
  };
}
