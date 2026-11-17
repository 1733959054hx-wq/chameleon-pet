import * as THREE from 'three';
import { damp } from '../core/MathDynamics.js';
import { enhanceCrystalDragonMaterial } from '../shaders/CrystalShader.js';

export const PALETTES = {
  JADE: {
    name: '翡翠玉龙',
    body: 0x38ef7d,
    emissive: 0x065f46,
    horn: 0xfde047,
    belly: 0xa7f3d0
  },
  SAKURA: {
    name: '落樱粉晶',
    body: 0xf472b6,
    emissive: 0x831843,
    horn: 0xfde047,
    belly: 0xfce7f3
  },
  CYBER: {
    name: '赛博霓虹',
    body: 0x00f2fe,
    emissive: 0x0369a1,
    horn: 0xff007f,
    belly: 0x38bdf8
  },
  LAVA: {
    name: '熔岩赤金',
    body: 0xf97316,
    emissive: 0x7c2d12,
    horn: 0xffedd5,
    belly: 0xfef08a
  },
  AURORA: {
    name: '全息极光',
    body: 0x818cf8,
    emissive: 0x312e81,
    horn: 0x34d399,
    belly: 0xc7d2fe
  }
};

function createTaperedHornGeometry(curve, numSegments = 28, radialSegments = 14, startRadius = 0.085, endRadius = 0.001) {
  const points = curve.getPoints(numSegments);
  const frames = curve.computeFrenetFrames(numSegments, false);

  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    const radius = THREE.MathUtils.lerp(startRadius, endRadius, Math.pow(t, 0.75));
    const p = points[i];
    const N = frames.normals[i];
    const B = frames.binormals[i];

    for (let j = 0; j <= radialSegments; j++) {
      const u = j / radialSegments;
      const angle = u * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = -Math.cos(angle);

      const normal = new THREE.Vector3().addScaledVector(N, cos).addScaledVector(B, sin).normalize();
      const vertex = new THREE.Vector3().copy(p).addScaledVector(normal, radius);

      positions.push(vertex.x, vertex.y, vertex.z);
      uvs.push(u, t);
    }
  }

  for (let i = 0; i < numSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = (i + 1) * (radialSegments + 1) + j;
      const c = (i + 1) * (radialSegments + 1) + (j + 1);
      const d = i * (radialSegments + 1) + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export class ChameleonModel {
  constructor(scene, spine, limbs, leftEyeTracker, rightEyeTracker) {
    this.scene = scene;
    this.spine = spine;
    this.limbs = limbs;
    this.leftEyeTracker = leftEyeTracker;
    this.rightEyeTracker = rightEyeTracker;

    this.currentPalette = 'JADE';
    this.targetBodyColor = new THREE.Color(PALETTES.JADE.body);
    this.targetHornColor = new THREE.Color(PALETTES.JADE.horn);
    this.targetBellyColor = new THREE.Color(PALETTES.JADE.belly);
    this.baseEmissive = new THREE.Color(PALETTES.JADE.emissive);

    // GLSL 着色器实时 Uniform 中心
    this.shaderUniforms = {
      uTime: { value: 0 },
      uPulseProgress: { value: -1.0 },
      uPulseColor: { value: new THREE.Color(0xffffff) },
      uBellyColor: { value: new THREE.Color(PALETTES.JADE.belly) },
      uAlertLevel: { value: 0.0 },
      uPettingGlow: { value: 0.0 }
    };

    this.hornFlex = new THREE.Vector2(0, 0);
    this.hornVelocity = new THREE.Vector2(0, 0);
    this.prevHeadPos = new THREE.Vector3();
    this.prevHeadInitialized = false;

    this.isAlert = false;
    this.alertStrength = 0;
    this.pettingStrength = 0;
    this.tongue = null;

    this.dragonMaterial = new THREE.MeshPhysicalMaterial({
      color: this.targetBodyColor.clone(),
      emissive: new THREE.Color(PALETTES.JADE.emissive),
      roughness: 0.14,
      metalness: 0.06,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      // transmission 已移除：它触发 Three.js 每帧全屏离屏重渲染 + 高斯模糊（卡顿元凶）
      // 通透感由 CrystalShader 的菲涅尔边缘光替代，零额外开销
      iridescence: 0.45,
      iridescenceIOR: 1.35,
      sheen: 0.35,
      sheenColor: 0xffffff
    });
    enhanceCrystalDragonMaterial(this.dragonMaterial, this.shaderUniforms);

    this.hornMaterial = new THREE.MeshPhysicalMaterial({
      color: this.targetHornColor.clone(),
      emissive: new THREE.Color(PALETTES.JADE.horn).multiplyScalar(0.18),
      roughness: 0.06,
      metalness: 0.3,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      iridescence: 0.4,
      iridescenceIOR: 1.4
    });

    this.finMaterial = new THREE.MeshPhysicalMaterial({
      color: this.targetHornColor.clone(),
      roughness: 0.15,
      // transmission 已移除，改用普通透明 + 低 opacity 保持半透水晶鳍观感
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide
    });

    this.initDragonHead();
    this.initContinuousBodyAndSpines();
    this.initAnatomicalLimbs();
  }

  initDragonHead() {
    this.headGroup = new THREE.Group();
    this.headGroup.up.set(0, 0, 1);

    const headGeom = new THREE.SphereGeometry(0.30, 24, 24);
    headGeom.scale(0.85, 0.75, 1.12);
    const headMesh = new THREE.Mesh(headGeom, this.dragonMaterial);
    headMesh.castShadow = true;
    this.headGroup.add(headMesh);

    const jawGeom = new THREE.ConeGeometry(0.24, 0.45, 16);
    jawGeom.rotateX(Math.PI * 0.5);
    jawGeom.translate(0, -0.08, 0.28);
    const jaw = new THREE.Mesh(jawGeom, this.dragonMaterial);
    this.headGroup.add(jaw);

    this.hornsGroup = new THREE.Group();

    const mainHornCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.04, 0.24, -0.16),
      new THREE.Vector3(0.12, 0.52, -0.45),
      new THREE.Vector3(0.18, 0.75, -0.72)
    ]);
    const mainHornGeom = createTaperedHornGeometry(mainHornCurve, 32, 14, 0.045, 0.001);

    const subHornCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.04, 0.24, -0.16),
      new THREE.Vector3(0.14, 0.38, -0.22),
      new THREE.Vector3(0.22, 0.50, -0.25)
    ]);
    const subHornGeom = createTaperedHornGeometry(subHornCurve, 20, 10, 0.028, 0.001);

    const singleHornGroup = new THREE.Group();
    singleHornGroup.add(new THREE.Mesh(mainHornGeom, this.hornMaterial));
    singleHornGroup.add(new THREE.Mesh(subHornGeom, this.hornMaterial));

    this.leftHorn = singleHornGroup;
    this.leftHorn.position.set(0.14, 0.16, -0.02);

    this.rightHorn = singleHornGroup.clone();
    this.rightHorn.position.set(-0.14, 0.16, -0.02);
    this.rightHorn.scale.set(-1, 1, 1);

    this.hornsGroup.add(this.leftHorn, this.rightHorn);

    const earGeom = new THREE.ConeGeometry(0.12, 0.38, 4);
    earGeom.rotateZ(-Math.PI * 0.4);
    earGeom.scale(0.3, 1.0, 1.0);
    const leftEar = new THREE.Mesh(earGeom, this.finMaterial);
    leftEar.position.set(0.28, -0.02, -0.15);
    leftEar.rotation.y = 0.4;
    const rightEar = leftEar.clone();
    rightEar.position.set(-0.28, -0.02, -0.15);
    rightEar.scale.set(-1, 1, 1);
    rightEar.rotation.y = -0.4;
    this.hornsGroup.add(leftEar, rightEar);

    this.headGroup.add(this.hornsGroup);

    this.leftEye = this.createGemEye(1);
    this.rightEye = this.createGemEye(-1);
    this.headGroup.add(this.leftEye.group, this.rightEye.group);

    this.scene.add(this.headGroup);
  }

  createGemEye(side) {
    const group = new THREE.Group();
    group.position.set(side * 0.22, 0.09, 0.15);

    const base = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), this.dragonMaterial);
    base.scale.set(1.0, 1.0, 0.85);
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.052, 16, 16),
      new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.0, clearcoat: 1.0 })
    );
    pupil.position.set(0, 0, 0.048);

    const highlight = new THREE.Mesh(
      new THREE.SphereGeometry(0.019, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    highlight.position.set(0.022, 0.022, 0.082);

    group.add(base, pupil, highlight);
    return { group, pupil };
  }

  initContinuousBodyAndSpines() {
    this.radialSegments = 22;
    this.bodyJointsCount = this.spine.numSegments;

    this.bodyGeometry = new THREE.BufferGeometry();
    const vertexCount = this.bodyJointsCount * (this.radialSegments + 1);
    this.positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);

    for (let i = 0; i < this.bodyJointsCount; i++) {
      const v = i / (this.bodyJointsCount - 1);
      for (let j = 0; j <= this.radialSegments; j++) {
        const u = j / this.radialSegments;
        const uvIdx = (i * (this.radialSegments + 1) + j) * 2;
        uvs[uvIdx] = u;
        uvs[uvIdx + 1] = v;
      }
    }

    const indices = [];
    for (let i = 0; i < this.bodyJointsCount - 1; i++) {
      for (let j = 0; j < this.radialSegments; j++) {
        const a = i * (this.radialSegments + 1) + j;
        const b = (i + 1) * (this.radialSegments + 1) + j;
        const c = (i + 1) * (this.radialSegments + 1) + (j + 1);
        const d = i * (this.radialSegments + 1) + (j + 1);
        indices.push(a, b, d, b, c, d);
      }
    }
    this.bodyGeometry.setIndex(indices);
    this.bodyGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.bodyGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    this.bodyMesh = new THREE.Mesh(this.bodyGeometry, this.dragonMaterial);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.scene.add(this.bodyMesh);

    // ✅ 新增：背部水晶棘冠 (Dorsal Crystal Spines) 增强灵龙/变色龙辨识度
    this.dorsalSpines = [];
    const spineConeGeom = new THREE.ConeGeometry(0.036, 0.16, 5);
    spineConeGeom.translate(0, 0.06, 0);
    for (let i = 2; i < this.bodyJointsCount - 3; i++) {
      const mesh = new THREE.Mesh(spineConeGeom, this.hornMaterial);
      const scale = Math.sin(((i - 2) / (this.bodyJointsCount - 5)) * Math.PI);
      mesh.scale.setScalar(0.55 + scale * 0.75);
      this.scene.add(mesh);
      this.dorsalSpines.push({ jointIndex: i, mesh, baseScale: 0.55 + scale * 0.75 });
    }
  }

  initAnatomicalLimbs() {
    this.limbMeshes = [];

    this.limbs.forEach((limb) => {
      const group = new THREE.Group();

      const shoulderSocket = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), this.dragonMaterial);
      const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, limb.length1 - 0.03, 8, 16), this.dragonMaterial);
      const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 14), this.dragonMaterial);
      const lowerArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, limb.length2 - 0.03, 8, 16), this.dragonMaterial);

      upperArm.castShadow = true;
      lowerArm.castShadow = true;

      const foot = new THREE.Group();
      for (let i = -1; i <= 1; i++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.11, 6), this.hornMaterial);
        claw.rotateX(Math.PI * 0.5);
        claw.position.set(i * 0.045, -0.015, 0.045);
        claw.rotation.y = i * 0.22;
        foot.add(claw);
      }

      group.add(shoulderSocket, upperArm, elbowJoint, lowerArm, foot);
      this.scene.add(group);
      this.limbMeshes.push({ shoulderSocket, upperArm, elbowJoint, lowerArm, foot });
    });
  }

  update(delta) {
    const dt = Math.max(0.001, delta);
    this.shaderUniforms.uTime.value += dt;

    // 更新脊椎流光脉冲动画
    if (this.shaderUniforms.uPulseProgress.value >= 0.0) {
      this.shaderUniforms.uPulseProgress.value += dt * 1.85;
      if (this.shaderUniforms.uPulseProgress.value > 1.35) {
        this.shaderUniforms.uPulseProgress.value = -1.0;
      }
    }

    const headPos = this.spine.getSegment(0).clone();
    const neckPos = this.spine.getSegment(1);
    const headForward = new THREE.Vector3().subVectors(headPos, neckPos).normalize();

    // 吐舌蓄力：头部后缩蓄势
    if (this.tongue && this.tongue.isWindingUp()) {
      const windup = this.tongue.getWindupProgress();
      headPos.addScaledVector(headForward, -0.075 * Math.sin(windup * Math.PI));
    }

    // 1. 头部定位与朝向
    this.headGroup.position.copy(headPos);
    const headTarget = new THREE.Vector3().addVectors(headPos, headForward);
    this.headGroup.lookAt(headTarget);

    // 2. 龙角弹性阻尼更新
    const headMoveDelta = new THREE.Vector3();
    if (!this.prevHeadInitialized) {
      this.prevHeadPos.copy(headPos);
      this.prevHeadInitialized = true;
    } else {
      headMoveDelta.subVectors(headPos, this.prevHeadPos);
      this.prevHeadPos.copy(headPos);
    }

    const springK = 85.0;
    const damping = 9.0;
    const forceX = -headMoveDelta.x * 26.0 - springK * this.hornFlex.x;
    const forceY = -headMoveDelta.y * 26.0 - springK * this.hornFlex.y;

    this.hornVelocity.x += (forceX - damping * this.hornVelocity.x) * dt;
    this.hornVelocity.y += (forceY - damping * this.hornVelocity.y) * dt;
    this.hornFlex.x += this.hornVelocity.x * dt;
    this.hornFlex.y += this.hornVelocity.y * dt;

    this.hornsGroup.rotation.z = this.hornFlex.x * 0.5;
    this.hornsGroup.rotation.x = this.hornFlex.y * 0.5;

    // 2.5 警戒状态与抚摸状态平滑过渡
    this.alertStrength = damp(this.alertStrength, this.isAlert ? 1.0 : 0.0, 10.0, dt);
    this.pettingStrength = damp(this.pettingStrength, 0.0, 3.5, dt);
    this.shaderUniforms.uAlertLevel.value = this.alertStrength;
    this.shaderUniforms.uPettingGlow.value = this.pettingStrength;

    if (this.alertStrength > 0.001) {
      this.hornsGroup.rotation.x += this.alertStrength * 0.22;
      this.hornsGroup.rotation.z += Math.sin(performance.now() * 0.012) * this.alertStrength * 0.02;
    }

    // 3. ✅ 修复眼球坐标系 Bug：用世界坐标 getWorldPosition 加上世界视线方向进行 lookAt
    const leftEyeWorld = new THREE.Vector3();
    const rightEyeWorld = new THREE.Vector3();
    this.leftEye.group.getWorldPosition(leftEyeWorld);
    this.rightEye.group.getWorldPosition(rightEyeWorld);

    this.leftEye.group.lookAt(leftEyeWorld.add(this.leftEyeTracker.currentLookDir));
    this.rightEye.group.lookAt(rightEyeWorld.add(this.rightEyeTracker.currentLookDir));

    // 抚摸时眼睛轻眯表现享受
    const eyeSquint = 1.0 - this.pettingStrength * 0.45;
    this.leftEye.group.scale.y = eyeSquint;
    this.rightEye.group.scale.y = eyeSquint;

    // 4. 平行传输标架 (Parallel Transport Frame) 构建无扭曲龙身与背棘
    const alertPuff = 1.0 + this.alertStrength * 0.20;
    const posAttr = this.positions;

    let prevTangent = null;
    let prevNormal = new THREE.Vector3(0, 0, 1);
    const spineNormals = [];
    const spineTangents = [];

    for (let i = 0; i < this.bodyJointsCount; i++) {
      const p = this.spine.getSegment(i);
      const prev = this.spine.getSegment(Math.max(0, i - 1));
      const next = this.spine.getSegment(Math.min(this.bodyJointsCount - 1, i + 1));

      const tangent = new THREE.Vector3().subVectors(prev, next);
      if (tangent.lengthSq() < 0.0001) tangent.set(0, 1, 0);
      else tangent.normalize();

      if (prevTangent) {
        const axis = new THREE.Vector3().crossVectors(prevTangent, tangent);
        if (axis.lengthSq() > 0.00001) {
          axis.normalize();
          const angle = Math.acos(THREE.MathUtils.clamp(prevTangent.dot(tangent), -1, 1));
          prevNormal.applyAxisAngle(axis, angle);
        }
      } else {
        const refUp = Math.abs(tangent.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
        prevNormal.crossVectors(tangent, refUp).normalize();
      }

      const binormal = new THREE.Vector3().crossVectors(tangent, prevNormal).normalize();
      prevNormal.crossVectors(binormal, tangent).normalize();
      prevTangent = tangent.clone();

      spineNormals.push(prevNormal.clone());
      spineTangents.push(tangent.clone());

      const t = i / (this.bodyJointsCount - 1);
      let radius =
        THREE.MathUtils.smoothstep(t, 0.0, 0.18) * 0.24 +
        THREE.MathUtils.smoothstep(t, 0.18, 0.50) * 0.08 -
        THREE.MathUtils.smoothstep(t, 0.50, 1.0) * 0.26;
      radius = Math.max(0.022, radius) * alertPuff;

      for (let j = 0; j <= this.radialSegments; j++) {
        const theta = (j / this.radialSegments) * Math.PI * 2;
        const vx = Math.cos(theta) * radius;
        const vy = Math.sin(theta) * radius;

        const vIdx = (i * (this.radialSegments + 1) + j) * 3;
        posAttr[vIdx]     = p.x + prevNormal.x * vx + binormal.x * vy;
        posAttr[vIdx + 1] = p.y + prevNormal.y * vx + binormal.y * vy;
        posAttr[vIdx + 2] = p.z + prevNormal.z * vx + binormal.z * vy;
      }
    }

    this.bodyGeometry.attributes.position.needsUpdate = true;
    this.bodyGeometry.computeVertexNormals();

    // 4.5 更新背部水晶棘刺位姿 (警戒时棘刺竖立张开)
    for (const item of this.dorsalSpines) {
      const idx = item.jointIndex;
      const p = this.spine.getSegment(idx);
      const t = idx / (this.bodyJointsCount - 1);
      let radius =
        THREE.MathUtils.smoothstep(t, 0.0, 0.18) * 0.24 +
        THREE.MathUtils.smoothstep(t, 0.18, 0.50) * 0.08 -
        THREE.MathUtils.smoothstep(t, 0.50, 1.0) * 0.26;
      radius = Math.max(0.022, radius) * alertPuff;

      const normal = spineNormals[idx];
      const tangent = spineTangents[idx];
      const outward = new THREE.Vector3().crossVectors(tangent, normal).normalize();

      item.mesh.position.copy(p).addScaledVector(outward, radius * 0.9);
      const spineDir = outward.clone().addScaledVector(tangent, -0.35 + this.alertStrength * 0.25).normalize();
      item.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), spineDir);
      item.mesh.scale.setScalar(item.baseScale * (1.0 + this.alertStrength * 0.35));
    }

    // 5. 四肢骨骼与脚爪解算
    this.limbs.forEach((limb, index) => {
      const { root, midJoint, foot, pitch } = limb.solve2BoneIK(limb.getShoulderPos(), limb.currentFootPos);
      const meshes = this.limbMeshes[index];

      meshes.shoulderSocket.position.copy(root);
      this.orientBone(meshes.upperArm, root, midJoint);
      meshes.elbowJoint.position.copy(midJoint);
      this.orientBone(meshes.lowerArm, midJoint, foot);

      meshes.foot.position.copy(foot);
      meshes.foot.lookAt(new THREE.Vector3(foot.x, foot.y - 1, foot.z + 0.1));
      meshes.foot.rotateX(pitch);
    });

    // 6. 帧率无关的材质颜色平滑过渡
    const colorBlend = 1 - Math.exp(-8.0 * dt);
    this.dragonMaterial.color.lerp(this.targetBodyColor, colorBlend);
    this.hornMaterial.color.lerp(this.targetHornColor, colorBlend);
    this.finMaterial.color.lerp(this.targetHornColor, colorBlend);
    this.shaderUniforms.uBellyColor.value.lerp(this.targetBellyColor, colorBlend);
    this.dragonMaterial.emissive.lerp(this.baseEmissive, colorBlend);
  }

  orientBone(mesh, p1, p2) {
    mesh.position.copy(p1).lerp(p2, 0.5);
    const dir = new THREE.Vector3().subVectors(p2, p1);
    if (dir.lengthSq() > 0.00001) {
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    }
  }

  setAlertState(active) {
    this.isAlert = active;
  }

  setTongue(tongue) {
    this.tongue = tongue;
  }

  setPalette(paletteKey) {
    if (!PALETTES[paletteKey]) return;
    this.currentPalette = paletteKey;
    const p = PALETTES[paletteKey];
    this.targetBodyColor.setHex(p.body);
    this.targetHornColor.setHex(p.horn);
    this.targetBellyColor.setHex(p.belly);
    this.baseEmissive.setHex(p.emissive);
    this.triggerEnergyPulse(p.horn);
  }

  triggerFeedPulse() {
    this.triggerEnergyPulse(0xffffff);
  }

  triggerPettingResponse() {
    this.pettingStrength = 1.0;
  }

  triggerEnergyPulse(colorHex = 0xffffff) {
    this.shaderUniforms.uPulseColor.value.setHex(colorHex);
    this.shaderUniforms.uPulseProgress.value = 0.0;
  }
}
