import * as THREE from 'three';
import { dampVector3 } from '../core/MathDynamics.js';

export class LimbIK {
  constructor(spine, shoulderIndex, side = 1, isFront = true) {
    this.spine = spine;
    this.shoulderIndex = shoulderIndex;
    this.side = side;
    this.isFront = isFront;

    this.length1 = 0.34;
    this.length2 = 0.32;
    this.maxReach = (this.length1 + this.length2) * 0.96;

    this.currentFootPos = new THREE.Vector3();
    this.oldFootPos = new THREE.Vector3();
    this.targetFootPos = new THREE.Vector3();
    this.prevShoulderPos = new THREE.Vector3();
    this.shoulderVelocity = new THREE.Vector3();
    this.initialized = false;

    this.isStepping = false;
    this.stepProgress = 0;
    this.stepDuration = 0.14;
    this.stepHeight = 0.24;
    this.footPitch = 0;

    this.groundY = -0.8;
    this.form = 'CRAWL';

    this.currentFootPos.copy(this.getIdealFootPos());
  }

  setForm(form) {
    this.form = form;
    if (form === 'CRAWL') {
      this.currentFootPos.y = this.groundY;
    }
  }

  // 宏观身体朝向：用结构链前胸→后腰，完全免疫局部 S 波摆动，脚掌稳如泰山
  getMacroBodyForward() {
    return new THREE.Vector3()
      .subVectors(this.spine.baseJoints[1], this.spine.baseJoints[12])
      .normalize();
  }

  getShoulderPos() {
    const center = this.spine.getSegment(this.shoulderIndex);
    const forward = this.getMacroBodyForward();
    const right = new THREE.Vector3(forward.y, -forward.x, 0);
    if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
    right.normalize().multiplyScalar(this.side * 0.30);
    return new THREE.Vector3().addVectors(center, right);
  }

  getIdealFootPos() {
    const shoulder = this.getShoulderPos();
    const forward = this.getMacroBodyForward();

    if (this.form === 'CRAWL') {
      const lateral = new THREE.Vector3(forward.y, -forward.x, 0);
      if (lateral.lengthSq() < 0.0001) lateral.set(1, 0, 0);
      lateral.normalize().multiplyScalar(this.side * 0.56);

      // 引入速度前瞻 (Velocity Lead): 向移动前方预判落脚点，消除高频碎步
      const leadOffset = this.shoulderVelocity.clone().multiplyScalar(0.085);
      leadOffset.clampLength(0, 0.26);

      const ideal = new THREE.Vector3()
        .addVectors(shoulder, lateral)
        .addScaledVector(forward, this.isFront ? 0.28 : -0.20)
        .add(leadOffset);
      ideal.y = this.groundY;
      return ideal;
    } else {
      // 游龙模式：爪子流线型向后贴拢，并随游动轻微摆动
      return new THREE.Vector3()
        .addVectors(shoulder, new THREE.Vector3(this.side * 0.15, -0.06, -0.22))
        .addScaledVector(forward, -0.32);
    }
  }

  triggerStep() {
    if (this.isStepping || this.form === 'SWIM') return;
    this.isStepping = true;
    this.stepProgress = 0;
    this.oldFootPos.copy(this.currentFootPos);
    this.targetFootPos.copy(this.getIdealFootPos());
  }

  update(delta) {
    const dt = Math.max(0.001, delta);
    const shoulder = this.getShoulderPos();

    if (!this.initialized) {
      this.prevShoulderPos.copy(shoulder);
      this.initialized = true;
    } else {
      const instVel = new THREE.Vector3().subVectors(shoulder, this.prevShoulderPos).divideScalar(dt);
      dampVector3(this.shoulderVelocity, instVel, 14.0, dt);
      this.prevShoulderPos.copy(shoulder);
    }

    if (this.form === 'SWIM') {
      this.isStepping = false;
      dampVector3(this.currentFootPos, this.getIdealFootPos(), 10.0, dt);
      this.footPitch = -0.55;
      return;
    }

    if (this.isStepping) {
      this.stepProgress += dt / this.stepDuration;
      if (this.stepProgress >= 1.0) {
        this.stepProgress = 1.0;
        this.isStepping = false;
        this.currentFootPos.copy(this.targetFootPos);
        this.currentFootPos.y = this.groundY;
        this.footPitch = 0;
      } else {
        const t = this.stepProgress;
        // Smoothstep 曲线使起脚与落脚更轻盈干脆
        const smoothT = t * t * (3 - 2 * t);
        this.currentFootPos.lerpVectors(this.oldFootPos, this.targetFootPos, smoothT);
        this.currentFootPos.y = this.groundY + Math.sin(t * Math.PI) * this.stepHeight;
        this.footPitch = Math.sin(t * Math.PI) * 0.5;
      }
    } else {
      this.currentFootPos.y = this.groundY;
    }
  }

  solve2BoneIK(root, target) {
    const d = root.distanceTo(target);
    const clampedDist = THREE.MathUtils.clamp(d, 0.05, this.maxReach);

    const cosAlpha =
      (this.length1 * this.length1 + clampedDist * clampedDist - this.length2 * this.length2) /
      (2 * this.length1 * clampedDist);
    const alpha = Math.acos(THREE.MathUtils.clamp(cosAlpha, -1, 1));

    const dir = new THREE.Vector3().subVectors(target, root).normalize();
    const bodyForward = this.getMacroBodyForward();
    const bodyRight = new THREE.Vector3(bodyForward.y, -bodyForward.x, 0);
    if (bodyRight.lengthSq() < 0.0001) bodyRight.set(1, 0, 0);
    bodyRight.normalize();

    // 稳定极向量：始终指向身体外侧 + 上方，绝不随 dir.x 变号而 180° 翻转
    const poleVector = new THREE.Vector3()
      .addScaledVector(bodyRight, this.side * 0.7)
      .add(new THREE.Vector3(0, 0.6, 0.3))
      .normalize();

    // Gram-Schmidt 正交化求弯曲法线
    const bendNormal = poleVector.clone().sub(dir.clone().multiplyScalar(poleVector.dot(dir)));
    if (bendNormal.lengthSq() < 0.0001) bendNormal.set(0, 1, 0);
    bendNormal.normalize();

    const midJoint = new THREE.Vector3()
      .copy(root)
      .addScaledVector(dir, Math.cos(alpha) * this.length1)
      .addScaledVector(bendNormal, Math.sin(alpha) * this.length1);

    const actualFoot = new THREE.Vector3()
      .subVectors(target, midJoint)
      .normalize()
      .multiplyScalar(this.length2)
      .add(midJoint);

    return { root, midJoint, foot: actualFoot, pitch: this.footPitch };
  }
}
