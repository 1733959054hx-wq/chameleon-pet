import * as THREE from 'three';

/**
 * 帧率无关的指数平滑阻尼函数 (彻底替代固定系数 lerp)
 * @param {number} current 当前值
 * @param {number} target 目标值
 * @param {number} lambda 衰减速率 (越大越快，建议 5 ~ 25)
 * @param {number} delta 帧时间步长 (秒)
 */
export function damp(current, target, lambda, delta) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * delta));
}

export function dampVector3(currentVec, targetVec, lambda, delta) {
  const t = 1 - Math.exp(-lambda * delta);
  currentVec.lerp(targetVec, t);
  return currentVec;
}

/**
 * 三维二阶弹簧阻尼动力学系统 (Second-Order Dynamics 3D)
 * 控制方程: y'' + 4*pi*zeta*f*y' + (2*pi*f)^2 * y = (2*pi*f)^2 * x + 2*pi*f*r*zeta * x'
 */
export class SecondOrderDynamics3D {
  /**
   * @param {number} f 固有频率 (Hz) - 控制响应灵敏度与速度
   * @param {number} zeta 阻尼比 - 控制柔和度与回弹 (0.6~0.8 有生物惯性，>=1 无超调)
   * @param {number} r 初始前馈响应 - >1 预测提速，0 平滑起步，<0 反向蓄力
   * @param {THREE.Vector3} initialPos 初始位置
   */
  constructor(f = 3.2, zeta = 0.72, r = 1.15, initialPos = new THREE.Vector3()) {
    this.xp = initialPos.clone();
    this.y = initialPos.clone();
    this.yd = new THREE.Vector3();
    this. _vx = new THREE.Vector3();
    this.setParameters(f, zeta, r);
  }

  setParameters(f, zeta, r) {
    this.f = Math.max(0.1, f);
    this.zeta = Math.max(0.05, zeta);
    this.r = r;
    this.k1 = this.zeta / (Math.PI * this.f);
    this.k2 = 1 / ((2 * Math.PI * this.f) * (2 * Math.PI * this.f));
    this.k3 = (this.r * this.zeta) / (2 * Math.PI * this.f);
  }

  reset(pos) {
    this.xp.copy(pos);
    this.y.copy(pos);
    this.yd.set(0, 0, 0);
  }

  update(targetPos, delta) {
    if (delta <= 0.00001) return this.y;

    // 估算目标输入速度 x'
    this._vx.subVectors(targetPos, this.xp).divideScalar(delta);
    this.xp.copy(targetPos);

    // 保证任意低帧率下积分绝对稳定的 k2 下界
    const k2Stable = Math.max(
      this.k2,
      (delta * delta) / 2 + (delta * this.k1) / 2,
      delta * this.k1
    );

    // 状态位置更新: y = y + delta * yd
    this.y.addScaledVector(this.yd, delta);

    // 状态加速度更新: yd = yd + delta * (x + k3*vx - y - k1*yd) / k2Stable
    const ax = (targetPos.x + this.k3 * this._vx.x - this.y.x - this.k1 * this.yd.x) / k2Stable;
    const ay = (targetPos.y + this.k3 * this._vx.y - this.y.y - this.k1 * this.yd.y) / k2Stable;
    const az = (targetPos.z + this.k3 * this._vx.z - this.y.z - this.k1 * this.yd.z) / k2Stable;

    this.yd.x += delta * ax;
    this.yd.y += delta * ay;
    this.yd.z += delta * az;

    return this.y;
  }
}

/**
 * 1€ Filter (One-Euro Filter) 自适应低通滤波器
 * 专门用于消除 MediaPipe 摄像头手势在静止时的微颤，同时保持快速挥手时零延迟
 */
class LowPassFilter1D {
  constructor() {
    this.y = null;
  }
  filter(value, alpha) {
    if (this.y === null) {
      this.y = value;
      return value;
    }
    this.y = alpha * value + (1.0 - alpha) * this.y;
    return this.y;
  }
}

export class OneEuroFilter3D {
  constructor(minCutoff = 1.2, beta = 0.04, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter1D();
    this.yFilter = new LowPassFilter1D();
    this.zFilter = new LowPassFilter1D();
    this.dxFilter = new LowPassFilter1D();
    this.dyFilter = new LowPassFilter1D();
    this.dzFilter = new LowPassFilter1D();
    this.lastTime = null;
  }

  alpha(cutoff, dt) {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x, y, z, timestampMs = performance.now()) {
    const dt = this.lastTime === null ? 0.016 : Math.max(0.001, (timestampMs - this.lastTime) / 1000);
    this.lastTime = timestampMs;

    const prevX = this.xFilter.y ?? x;
    const prevY = this.yFilter.y ?? y;
    const prevZ = this.zFilter.y ?? z;

    const dx = (x - prevX) / dt;
    const dy = (y - prevY) / dt;
    const dz = (z - prevZ) / dt;

    const dAlpha = this.alpha(this.dCutoff, dt);
    const edx = this.dxFilter.filter(dx, dAlpha);
    const edy = this.dyFilter.filter(dy, dAlpha);
    const edz = this.dzFilter.filter(dz, dAlpha);

    const cutoffX = this.minCutoff + this.beta * Math.abs(edx);
    const cutoffY = this.minCutoff + this.beta * Math.abs(edy);
    const cutoffZ = this.minCutoff + this.beta * Math.abs(edz);

    return {
      x: this.xFilter.filter(x, this.alpha(cutoffX, dt)),
      y: this.yFilter.filter(y, this.alpha(cutoffY, dt)),
      z: this.zFilter.filter(z, this.alpha(cutoffZ, dt))
    };
  }
}
