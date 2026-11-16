import * as THREE from 'three';

export class LimbIK {
  constructor(spine, shoulderIndex, side = 1, isFront = true) {
    this.spine = spine;
    this.shoulderIndex = shoulderIndex;
    this.side = side;
    this.isFront = isFront;

    this.length1 = 0.32;
    this.length2 = 0.30;
    this.maxReach = (this.length1 + this.length2) * 0.96;

    this.currentFootPos = new THREE.Vector3();
    this.oldFootPos = new THREE.Vector3();
    this.targetFootPos = new THREE.Vector3();
    
    this.isStepping = false;
    this.stepProgress = 0;
    this.stepDuration = 0.16;
    this.stepHeight = 0.25;
    this.footPitch = 0;

    this.groundY = -0.8; // 地面物理高度
    this.form = 'CRAWL'; // 'CRAWL' (陆地爬行) | 'SWIM' (腾云游龙)

    this.currentFootPos.copy(this.getIdealFootPos());
  }

  setForm(form) {
    this.form = form;
    if (form === 'CRAWL') {
      this.currentFootPos.y = this.groundY;
    }
  }

  getShoulderPos() {
    const center = this.spine.getSegment(this.shoulderIndex);
    const forward = this.spine.getSegmentOrientation(this.shoulderIndex);
    const right = new THREE.Vector3(forward.y, -forward.x, 0).normalize().multiplyScalar(this.side * 0.32);
    return new THREE.Vector3().addVectors(center, right);
  }

  getIdealFootPos() {
    const shoulder = this.getShoulderPos();
    const forward = this.spine.getSegmentOrientation(this.shoulderIndex);
    
    if (this.form === 'CRAWL') {
      // 陆地模式：理想落脚点严格投影在地面上，并把脚往外侧伸，避免被身体挡住
      const lateral = new THREE.Vector3(forward.y, -forward.x, 0).normalize().multiplyScalar(this.side * 0.58);
      const ideal = new THREE.Vector3()
        .addVectors(shoulder, lateral)
        .addScaledVector(forward, this.isFront ? 0.28 : -0.22);
      ideal.y = this.groundY; // 锁定在地面
      return ideal;
    } else {
      // 游龙模式：爪子向后收拢贴身 (流线型)
      return new THREE.Vector3()
        .addVectors(shoulder, new THREE.Vector3(this.side * 0.15, -0.05, -0.25))
        .addScaledVector(forward, -0.3);
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
    if (this.form === 'SWIM') {
      // 游龙模式：四肢平滑向后紧贴身体
      this.currentFootPos.lerp(this.getIdealFootPos(), 0.12);
      this.footPitch = -0.5;
      return;
    }

    // 陆地爬行模式：脚在没迈步前【死死钉在原地】，迈步时走拱形抬腿
    if (this.isStepping) {
      this.stepProgress += delta / this.stepDuration;
      if (this.stepProgress >= 1.0) {
        this.stepProgress = 1.0;
        this.isStepping = false;
        this.currentFootPos.copy(this.targetFootPos);
        this.footPitch = 0;
      } else {
        const t = this.stepProgress;
        this.currentFootPos.lerpVectors(this.oldFootPos, this.targetFootPos, t);
        // 迈步空中起伏
        this.currentFootPos.y = this.groundY + Math.sin(t * Math.PI) * this.stepHeight;
        this.footPitch = Math.sin(t * Math.PI) * 0.5;
      }
    } else {
      this.currentFootPos.y = this.groundY; // 牢牢钉在地面
    }
  }

  solve2BoneIK(root, target) {
    const d = root.distanceTo(target);
    const clampedDist = THREE.MathUtils.clamp(d, 0.05, this.maxReach);

    const cosAlpha = (this.length1 * this.length1 + clampedDist * clampedDist - this.length2 * this.length2) / (2 * this.length1 * clampedDist);
    const alpha = Math.acos(THREE.MathUtils.clamp(cosAlpha, -1, 1));

    const dir = new THREE.Vector3().subVectors(target, root).normalize();
    const bendAxis = this.form === 'SWIM' ? new THREE.Vector3(0, 1, 0) : (this.isFront ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 0, -1));
    const bendNormal = new THREE.Vector3().crossVectors(bendAxis, dir).multiplyScalar(this.side).normalize();

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
