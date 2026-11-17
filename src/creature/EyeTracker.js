import * as THREE from 'three';
import { dampVector3 } from '../core/MathDynamics.js';

export class EyeTracker {
  constructor(isLeft = true) {
    this.isLeft = isLeft;
    this.currentLookDir = new THREE.Vector3(0, 0, 1);
    this.wanderAngleX = 0;
    this.wanderAngleY = 0;
    this.wanderTimer = 0;
    this.converged = false;
  }

  update(headPos, targetPos, forceConverge = false, delta = 0.016) {
    this.converged = forceConverge;
    const desiredDir = new THREE.Vector3();

    if (forceConverge) {
      // 捕食或警戒时双眼同步高速锁定目标
      desiredDir.subVectors(targetPos, headPos).normalize();
      dampVector3(this.currentLookDir, desiredDir, 22.0, delta).normalize();
    } else {
      // 日常状态：左眼紧盯目标，右眼展示变色龙特有的独立环视特征
      if (this.isLeft) {
        desiredDir.subVectors(targetPos, headPos).normalize();
      } else {
        this.wanderTimer -= delta;
        if (this.wanderTimer <= 0) {
          this.wanderAngleX = (Math.random() - 0.5) * 1.4;
          this.wanderAngleY = (Math.random() - 0.5) * 1.1;
          this.wanderTimer = 1.2 + Math.random() * 2.2;
        }
        const toTarget = new THREE.Vector3().subVectors(targetPos, headPos).normalize();
        desiredDir
          .copy(toTarget)
          .add(new THREE.Vector3(Math.sin(this.wanderAngleX) * 0.45, Math.sin(this.wanderAngleY) * 0.35, 0))
          .normalize();
      }
      dampVector3(this.currentLookDir, desiredDir, 10.0, delta).normalize();
    }

    return this.currentLookDir;
  }
}
