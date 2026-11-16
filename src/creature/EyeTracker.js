import * as THREE from 'three';

export class EyeTracker {
  constructor(isLeft = true) {
    this.isLeft = isLeft;
    this.currentLookDir = new THREE.Vector3(isLeft ? -1 : 1, 0, 0.5).normalize();
    this.wanderAngleX = 0;
    this.wanderAngleY = 0;
    this.wanderTimer = 0;
    this.converged = false;
  }

  update(headPos, targetPos, forceConverge = false, delta = 0.016) {
    this.converged = forceConverge;
    const desiredDir = new THREE.Vector3();

    if (forceConverge) {
      // 双眼同时对焦汇聚到猎物点
      desiredDir.subVectors(targetPos, headPos).normalize();
    } else {
      // 左眼专注追踪，右眼偶尔发呆游离（或交替）
      if (this.isLeft) {
        desiredDir.subVectors(targetPos, headPos).normalize();
      } else {
        this.wanderTimer -= delta;
        if (this.wanderTimer <= 0) {
          this.wanderAngleX = (Math.random() - 0.5) * 1.8;
          this.wanderAngleY = (Math.random() - 0.5) * 1.8;
          this.wanderTimer = 1.0 + Math.random() * 2.0; // 随机停留 1-3 秒
        }
        desiredDir.set(Math.sin(this.wanderAngleX) + 0.8, Math.cos(this.wanderAngleY), 0.5).normalize();
      }
    }

    // 阻尼平滑转动眼球
    this.currentLookDir.lerp(desiredDir, 0.1);
    return this.currentLookDir;
  }
}
