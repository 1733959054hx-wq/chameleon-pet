import * as THREE from 'three';

export class TongueSystem {
  constructor(scene) {
    this.scene = scene;

    this.state = 'RETRACTED'; // RETRACTED | WINDUP | FIRING | RETRACTING
    this.progress = 0;
    this.windupDuration = 0.11;
    this.windupProgress = 0;

    this.startPos = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();
    this.currentTip = new THREE.Vector3();
    this.capturedPrey = null;
    this.onCatchCallback = null;

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    this.shaftMat = new THREE.MeshPhysicalMaterial({
      color: 0xf43f5e,
      roughness: 0.18,
      metalness: 0.05,
      clearcoat: 0.85,
      clearcoatRoughness: 0.08
    });

    this.tipMat = new THREE.MeshPhysicalMaterial({
      color: 0xff1744,
      emissive: 0x8a1232,
      emissiveIntensity: 1.6,
      roughness: 0.1,
      clearcoat: 1.0
    });

    this.tipMesh = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 16), this.tipMat);
    this.group.add(this.tipMesh);

    // 预分配舌管几何体缓冲区 (彻底消除每帧 dispose/new TubeGeometry 的 GC 卡顿)
    this.tubularSegments = 20;
    this.radialSegments = 10;
    this.baseRadius = 0.042;
    this.curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3()
    ]);

    this.initReusableTubeGeometry();
  }

  initReusableTubeGeometry() {
    const vertexCount = (this.tubularSegments + 1) * (this.radialSegments + 1);
    this.positions = new Float32Array(vertexCount * 3);
    const indices = [];

    for (let i = 0; i < this.tubularSegments; i++) {
      for (let j = 0; j < this.radialSegments; j++) {
        const a = i * (this.radialSegments + 1) + j;
        const b = (i + 1) * (this.radialSegments + 1) + j;
        const c = (i + 1) * (this.radialSegments + 1) + (j + 1);
        const d = i * (this.radialSegments + 1) + (j + 1);
        indices.push(a, b, d, b, c, d);
      }
    }

    this.tongueGeometry = new THREE.BufferGeometry();
    this.tongueGeometry.setIndex(indices);
    this.tongueGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.tongueMesh = new THREE.Mesh(this.tongueGeometry, this.shaftMat);
    this.group.add(this.tongueMesh);
  }

  fire(mouthPos, targetPos, preyEntity = null, onCatch = null) {
    if (this.state !== 'RETRACTED') return;

    this.startPos.copy(mouthPos);
    this.targetPos.copy(targetPos);
    this.capturedPrey = preyEntity;
    this.onCatchCallback = onCatch;

    this.currentTip.copy(mouthPos);
    this.progress = 0;
    this.windupProgress = 0;

    this.state = 'WINDUP';
    this.group.visible = false;
  }

  update(mouthPos, delta) {
    this.startPos.copy(mouthPos);
    if (this.capturedPrey && this.capturedPrey.alive && !this.capturedPrey.isCaught) {
      this.targetPos.copy(this.capturedPrey.position);
    }

    if (this.state === 'WINDUP') {
      this.windupProgress += delta / this.windupDuration;
      if (this.windupProgress >= 1) {
        this.windupProgress = 1;
        this.state = 'FIRING';
        this.group.visible = true;
      }
      return;
    } else if (this.state === 'FIRING') {
      this.progress += delta * 11.0;
      if (this.progress >= 1) {
        this.progress = 1;
        this.state = 'RETRACTING';
        if (this.capturedPrey && this.capturedPrey.alive) {
          this.capturedPrey.isCaught = true;
        }
        if (this.onCatchCallback) {
          this.onCatchCallback(this.targetPos.clone());
        }
      }
    } else if (this.state === 'RETRACTING') {
      this.progress -= delta * 6.2;
      if (this.progress <= 0) {
        this.progress = 0;
        this.state = 'RETRACTED';
        this.group.visible = false;
        if (this.capturedPrey) {
          this.capturedPrey.destroy();
          this.capturedPrey = null;
        }
      }
    }

    if (this.state !== 'RETRACTED') {
      this.updateGeometryInPlace();
    }
  }

  updateGeometryInPlace() {
    const t = this.progress;
    // 弹射采用极速缓出曲线，回收采用弹性缓入
    const easedT = this.state === 'FIRING' ? 1 - Math.pow(1 - t, 3) : t * t * (3 - 2 * t);
    this.currentTip.lerpVectors(this.startPos, this.targetPos, easedT);

    if (this.capturedPrey && this.capturedPrey.isCaught) {
      this.capturedPrey.position.copy(this.currentTip);
    }

    const dir = new THREE.Vector3().subVectors(this.targetPos, this.startPos);
    const totalLength = this.startPos.distanceTo(this.currentTip);
    if (dir.lengthSq() < 0.0001) dir.set(0, 0, 1);
    else dir.normalize();

    const bendAxis = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(dir, bendAxis).normalize();

    const bendAmount = Math.sin(t * Math.PI) * Math.min(0.22, totalLength * 0.32);

    this.curve.points[0].copy(this.startPos);
    this.curve.points[1].lerpVectors(this.startPos, this.currentTip, 0.33).addScaledVector(side, bendAmount * 0.55);
    this.curve.points[2].lerpVectors(this.startPos, this.currentTip, 0.68).addScaledVector(side, -bendAmount);
    this.curve.points[3].copy(this.currentTip);

    const points = this.curve.getPoints(this.tubularSegments);
    const frames = this.curve.computeFrenetFrames(this.tubularSegments, false);
    const posArr = this.positions;

    for (let i = 0; i <= this.tubularSegments; i++) {
      const p = points[i];
      const N = frames.normals[i];
      const B = frames.binormals[i];
      const uTube = i / this.tubularSegments;
      const r = this.baseRadius * (0.75 + 0.35 * uTube);

      for (let j = 0; j <= this.radialSegments; j++) {
        const theta = (j / this.radialSegments) * Math.PI * 2;
        const cos = -Math.cos(theta);
        const sin = Math.sin(theta);

        const idx = (i * (this.radialSegments + 1) + j) * 3;
        posArr[idx]     = p.x + (N.x * cos + B.x * sin) * r;
        posArr[idx + 1] = p.y + (N.y * cos + B.y * sin) * r;
        posArr[idx + 2] = p.z + (N.z * cos + B.z * sin) * r;
      }
    }

    this.tongueGeometry.attributes.position.needsUpdate = true;
    this.tongueGeometry.computeVertexNormals();
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
