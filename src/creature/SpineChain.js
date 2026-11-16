import * as THREE from 'three';

export class SpineChain {
  constructor(numSegments = 20, segmentLength = 0.22) {
    this.numSegments = numSegments;
    this.segmentLength = segmentLength;
    this.joints = [];
    this.waveTimer = 0;
    this.speed = 0;
    this.form = 'CRAWL'; // 'CRAWL' | 'SWIM'
    this.alertIntensity = 0; // 0~1，由外部(ALERT 状态)写入，用于加强脊椎振动

    for (let i = 0; i < numSegments; i++) {
      this.joints.push(new THREE.Vector3(0, -i * segmentLength, 0));
    }
  }

  setForm(form) {
    this.form = form;
  }

  update(headTargetPos, delta = 0.016) {
    const distToTarget = headTargetPos.distanceTo(this.joints[0]);
    this.speed = THREE.MathUtils.lerp(this.speed, distToTarget, 0.15);

    // 头部追踪
    this.joints[0].lerp(headTargetPos, 0.24);

    const isMoving = this.speed > 0.04;
    if (isMoving) {
      this.waveTimer += delta * Math.min(12.0, this.speed * (this.form === 'SWIM' ? 7.0 : 5.0));
    }

    // 骨骼链条约束
    let prevDir = null;
    const restDir = new THREE.Vector3(0, -1, 0); // 静态时偏好自然下垂弧线

    for (let i = 1; i < this.numSegments; i++) {
      const prev = this.joints[i - 1];
      const curr = this.joints[i];

      let dir = new THREE.Vector3().subVectors(curr, prev);

      // 角度约束：防止相邻段过度弯折导致身体反折成丑陋 C 形
      if (prevDir) {
        let angle = dir.angleTo(prevDir);
        const maxAngle = i < 6 ? 0.50 : 0.38; // 头颈允许稍大活动，后段更僵硬
        if (angle > maxAngle) {
          const axis = new THREE.Vector3().crossVectors(prevDir, dir).normalize();
          dir.copy(prevDir).applyAxisAngle(axis, maxAngle);
        }
      }

      // 静态/慢速时施加休息曲率，让龙身保持优雅弧线而非塌成一团
      const slowFactor = THREE.MathUtils.smoothstep(0.04 - this.speed, 0, 0.04);
      const restWeight = (1 - Math.min(i, 10) / 10) * 0.08 * slowFactor;
      dir.lerp(restDir, restWeight).normalize();

      // 运动时的 S 形游动波（ALERT 时整体振幅加强，表现为紧绷颤抖）
      if (isMoving && i > 1) {
        const alertBoost = 1.0 + this.alertIntensity * 1.4;
        const waveIntensity = (this.form === 'SWIM' ? 0.14 : 0.07) * alertBoost;
        const waveAngle = Math.sin(this.waveTimer - i * 0.38) * (this.speed * waveIntensity);
        dir.applyAxisAngle(new THREE.Vector3(0, 0, 1), waveAngle);
      }

      dir.normalize().multiplyScalar(this.segmentLength);
      curr.copy(prev).add(dir);
      prevDir = dir.clone();

      // ALERT 时下压身体：头部/颈部降低，呈现伏低警戒姿态
      if (this.alertIntensity > 0.001 && i < 10) {
        const crouch = this.alertIntensity * 0.10 * (1 - i / 10);
        curr.y -= crouch;
      }
    }
  }

  getSegment(index) {
    return this.joints[index];
  }

  getSegmentOrientation(index) {
    const p1 = this.joints[Math.max(0, index - 1)];
    const p2 = this.joints[Math.min(this.numSegments - 1, index + 1)];
    return new THREE.Vector3().subVectors(p1, p2).normalize();
  }
}
