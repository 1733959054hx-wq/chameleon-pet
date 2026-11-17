import * as THREE from 'three';
import { SecondOrderDynamics3D, damp } from '../core/MathDynamics.js';

export class SpineChain {
  constructor(numSegments = 20, segmentLength = 0.22) {
    this.numSegments = numSegments;
    this.segmentLength = segmentLength;
    this.joints = [];        // 表层渲染链：baseJoints + 视觉游动波，仅供网格渲染
    this.baseJoints = [];    // 底层结构链：纯物理定长跟随，无正弦波污染
    this.waveTimer = 0;
    this.speed = 0;
    this.form = 'CRAWL'; // 'CRAWL' | 'SWIM'
    this.alertIntensity = 0;
    this.groundY = -0.8;

    for (let i = 0; i < numSegments; i++) {
      const p = new THREE.Vector3(0, -i * segmentLength * 0.5, -i * 0.05);
      this.joints.push(p.clone());
      this.baseJoints.push(p.clone());
    }

    // 临界阻尼 + 无前馈：f=2.8, zeta=0.95, r=0
    // 取消 r 前馈可杜绝离散采样噪声以冲量形式注入龙头（真凶3）
    this.headDynamics = new SecondOrderDynamics3D(2.8, 0.95, 0.0, this.baseJoints[0]);
  }

  setDynamicsParams(f, zeta) {
    this.headDynamics.setParameters(f, zeta, 0.0);
  }

  setForm(form) {
    this.form = form;
  }

  update(headTargetPos, delta = 0.016) {
    const dt = Math.max(0.001, delta);
    const prevHead = this.baseJoints[0].clone();

    // 1. 更新底层结构链龙头
    this.baseJoints[0].copy(this.headDynamics.update(headTargetPos, dt));
    if (this.form === 'CRAWL') {
      this.baseJoints[0].y = Math.max(this.groundY + 0.22, this.baseJoints[0].y);
    }

    // 真实移动速率 (米/秒)，死区过滤微颤；静止时 speed→0，视觉波完全停摆
    const rawSpeed = this.baseJoints[0].distanceTo(prevHead) / dt;
    this.speed = damp(this.speed, rawSpeed < 0.08 ? 0 : rawSpeed, 8.0, dt);

    // 相位累加器：静止时不推进（0 多动症），移动时平缓推进
    this.waveTimer += dt * Math.min(8.0, this.speed * 2.2);
    const waveAmp = THREE.MathUtils.clamp(this.speed * 0.035, 0, 0.14);

    // 2. 解算纯净的底层结构链 baseJoints（无正弦波污染）
    let prevDir = null;
    for (let i = 1; i < this.numSegments; i++) {
      const prev = this.baseJoints[i - 1];
      const curr = this.baseJoints[i];
      const dir = new THREE.Vector3().subVectors(curr, prev);

      // 地面高度平滑修正放在定长之前：只调整方向，不破坏 segmentLength
      if (this.form === 'CRAWL') {
        const targetFloorY = this.groundY + Math.max(0.05, 0.16 * (1 - i / this.numSegments));
        if (curr.y < targetFloorY) dir.y += (targetFloorY - curr.y) * 0.5;
      }

      // ALERT 伏低：给前胸段方向持续的向下倾向（非坐标硬截断，保持定长无抖动）
      if (this.alertIntensity > 0.001 && i < 10) {
        dir.y -= this.alertIntensity * 0.12 * (1 - i / 10);
      }

      dir.normalize();

      // 限制相邻关节最大折角 (防反折)，共线时跳过避免叉乘零向量
      if (prevDir) {
        const angle = dir.angleTo(prevDir);
        const maxAngle = i < 6 ? 0.35 : 0.25;
        if (angle > maxAngle) {
          const axis = new THREE.Vector3().crossVectors(prevDir, dir);
          if (axis.lengthSq() > 0.0001) dir.copy(prevDir).applyAxisAngle(axis.normalize(), maxAngle);
        }
      }

      curr.copy(prev).addScaledVector(dir, this.segmentLength);
      prevDir = dir.clone();
    }

    // 3. 合成表层渲染链 joints = baseJoints + 横向正弦行波偏移
    this.joints[0].copy(this.baseJoints[0]);
    for (let i = 1; i < this.numSegments; i++) {
      const p = this.baseJoints[i];
      const tangent = new THREE.Vector3().subVectors(this.baseJoints[i - 1], p).normalize();
      // XY 平面内垂直于切线的横向法向量
      const sideNormal = new THREE.Vector3(-tangent.y, tangent.x, 0);
      if (sideNormal.lengthSq() < 0.0001) sideNormal.set(1, 0, 0);
      else sideNormal.normalize();

      // 包络：头颈振幅为 0（头不晃），中后段平滑摆动
      const envelope = Math.sin((i / (this.numSegments - 1)) * Math.PI * 0.85);
      const offset = Math.sin(this.waveTimer - i * 0.45) * waveAmp * envelope;

      this.joints[i].copy(p).addScaledVector(sideNormal, offset);
    }
  }

  getSegment(index) {
    return this.joints[index];
  }

  getSegmentOrientation(index) {
    const p1 = this.baseJoints[Math.max(0, index - 1)];
    const p2 = this.baseJoints[Math.min(this.numSegments - 1, index + 1)];
    const dir = new THREE.Vector3().subVectors(p1, p2);
    return dir.lengthSq() > 0.00001 ? dir.normalize() : new THREE.Vector3(0, 1, 0);
  }
}
