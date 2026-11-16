import * as THREE from 'three';

export class TongueSystem {
  constructor(scene) {
    this.scene = scene;

    this.state = 'RETRACTED'; // RETRACTED | WINDUP | FIRING | RETRACTING
    this.progress = 0;
    this.windupDuration = 0.12;
    this.windupProgress = 0;

    this.startPos = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();
    this.currentTip = new THREE.Vector3();

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    // =========================================================
    // 舌头材质
    // =========================================================
    this.shaftMat = new THREE.MeshPhysicalMaterial({
      color: 0xf43f5e,
      roughness: 0.18,
      metalness: 0.05,
      clearcoat: 0.8,
      clearcoatRoughness: 0.08
    });

    this.tipMat = new THREE.MeshPhysicalMaterial({
      color: 0xff1744,
      emissive: 0x8a1232,
      emissiveIntensity: 1.5,
      roughness: 0.1,
      clearcoat: 1.0
    });

    // 捕食吸盘
    this.tipMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 16, 16),
      this.tipMat
    );

    this.group.add(this.tipMesh);

    // 舌头曲线
    this.curve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3()
      ],
      false,
      'catmullrom',
      0.5
    );

    this.tongueGeometry = new THREE.TubeGeometry(
      this.curve,
      16,
      0.045,
      8,
      false
    );

    this.tongueMesh = new THREE.Mesh(
      this.tongueGeometry,
      this.shaftMat
    );

    this.group.add(this.tongueMesh);
  }

  fire(mouthPos, targetPos) {
    if (this.state !== 'RETRACTED') return;

    this.startPos.copy(mouthPos);
    this.targetPos.copy(targetPos);

    this.currentTip.copy(mouthPos);
    this.progress = 0;
    this.windupProgress = 0;

    // 先蓄力再弹出：给头部后缩和眼睛聚焦留出时间
    this.state = 'WINDUP';
    this.group.visible = false;
  }

  update(mouthPos, delta) {
    this.startPos.copy(mouthPos);

    if (this.state === 'WINDUP') {
      this.windupProgress += delta / this.windupDuration;
      if (this.windupProgress >= 1) {
        this.windupProgress = 1;
        this.state = 'FIRING';
        this.group.visible = true;
      }
      return; // 蓄力阶段不显示舌头
    } else if (this.state === 'FIRING') {
      this.progress += delta * 9.5;

      if (this.progress >= 1) {
        this.progress = 1;
        this.state = 'RETRACTING';
      }
    } else if (this.state === 'RETRACTING') {
      this.progress -= delta * 5.0;

      if (this.progress <= 0) {
        this.progress = 0;
        this.state = 'RETRACTED';
        this.group.visible = false;
      }
    }

    if (this.state !== 'RETRACTED') {
      this.updateGeometry();
    }
  }

  updateGeometry() {
    const t = this.progress;

    this.currentTip.lerpVectors(
      this.startPos,
      this.targetPos,
      t
    );

    // =========================================================
    // 弯曲舌头
    // =========================================================
    const dir = new THREE.Vector3()
      .subVectors(this.targetPos, this.startPos)
      .normalize();

    // 找一个与运动方向尽量正交的方向
    let bendAxis = new THREE.Vector3(0, 1, 0);

    if (Math.abs(dir.dot(bendAxis)) > 0.9) {
      bendAxis.set(1, 0, 0);
    }

    const side = new THREE.Vector3()
      .crossVectors(dir, bendAxis)
      .normalize();

    const up = new THREE.Vector3()
      .crossVectors(side, dir)
      .normalize();

    // 当前真实伸出长度
    const totalLength =
      this.startPos.distanceTo(this.currentTip);

    // 舌头越伸出去，弯曲越明显
    const bendAmount =
      Math.sin(t * Math.PI) *
      Math.min(0.22, totalLength * 0.35);

    const p0 = this.startPos.clone();

    const p1 = new THREE.Vector3().lerpVectors(
      this.startPos,
      this.currentTip,
      0.33
    );

    p1.addScaledVector(
      side,
      bendAmount * 0.55
    );

    const p2 = new THREE.Vector3().lerpVectors(
      this.startPos,
      this.currentTip,
      0.68
    );

    p2.addScaledVector(
      side,
      -bendAmount
    );

    const p3 = this.currentTip.clone();

    // 更新曲线
    this.curve.points = [p0, p1, p2, p3];

    // 重新生成 TubeGeometry
    this.tongueMesh.geometry.dispose();

    this.tongueMesh.geometry =
      new THREE.TubeGeometry(
        this.curve,
        16,
        0.045,
        8,
        false
      );

    // 舌尖
    this.tipMesh.position.copy(this.currentTip);
  }

  isActive() {
    return this.state !== 'RETRACTED';
  }

  isWindingUp() {
    return this.state === 'WINDUP';
  }

  getWindupProgress() {
    return this.windupProgress;
  }

  getState() {
    return this.state;
  }
}
