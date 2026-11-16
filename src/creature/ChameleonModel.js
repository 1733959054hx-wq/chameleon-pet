import * as THREE from 'three';

// 5 大顶级预设主题色系
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

/**
 * 核心几何算法：生成从粗到极其尖锐的渐变弯曲龙角曲面 (彻底告别平头香烟管)
 */
function createTaperedHornGeometry(curve, numSegments = 28, radialSegments = 14, startRadius = 0.085, endRadius = 0.001) {
  const points = curve.getPoints(numSegments);
  const frames = curve.computeFrenetFrames(numSegments, false);
  
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    // 渐变衰减曲线：根部粗壮，中段柔顺，末端极速收窄为锋利尖芒
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

  // 缝合三角形网格
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
    this.baseEmissive = new THREE.Color(PALETTES.JADE.emissive);

    // 弹性动力学参数
    this.hornFlex = new THREE.Vector2(0, 0);
    this.hornVelocity = new THREE.Vector2(0, 0);
    this.prevHeadPos = new THREE.Vector3();
    this.prevHeadInitialized = false; // 防止首帧用 (0,0,0) 计算位移导致龙角弹簧突然抖动

    // 警戒状态（ALERT：张掌触发）
    this.isAlert = false;
    this.alertStrength = 0;

    // 舌头系统引用（由外部 setTongue 注入）
    this.tongue = null;

    // 顶级玉石清漆材质（加入彩虹光泽与丝光，更像水晶）
    this.dragonMaterial = new THREE.MeshPhysicalMaterial({
      color: this.targetBodyColor.clone(),
      emissive: new THREE.Color(PALETTES.JADE.emissive),
      roughness: 0.15,
      metalness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      transmission: 0.18,
      iridescence: 0.35,
      iridescenceIOR: 1.3,
      sheen: 0.3,
      sheenColor: 0xffffff
    });

    // 琉璃龙角材质（带有晶莹清漆高光）
    this.hornMaterial = new THREE.MeshPhysicalMaterial({
      color: this.targetHornColor.clone(),
      roughness: 0.05,
      metalness: 0.35,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      iridescence: 0.35,
      iridescenceIOR: 1.4,
      sheen: 0.3,
      sheenColor: 0xffffff
    });

    // 半透明龙耳鳍材质
    this.finMaterial = new THREE.MeshPhysicalMaterial({
      color: this.targetHornColor.clone(),
      roughness: 0.2,
      transmission: 0.75,
      transparent: true,
      opacity: 0.8
    });

    this.jointMaterial = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.2 });

    this.initDragonHead();
    this.initContinuousBody();
    this.initAnatomicalLimbs();
  }

  initDragonHead() {
    this.headGroup = new THREE.Group();
    // 稳定头部朝向：龙身主要在 XY 平面活动，把 up 固定到 Z，避免低头时翻转
    this.headGroup.up.set(0, 0, 1);

    // 1. 饱满神骏的龙颅（进一步缩小，避免"巨头蛇身"）
    const headGeom = new THREE.SphereGeometry(0.30, 24, 24);
    headGeom.scale(0.85, 0.75, 1.12);
    const headMesh = new THREE.Mesh(headGeom, this.dragonMaterial);
    this.headGroup.add(headMesh);

    // 2. 龙吻与下颌
    const jawGeom = new THREE.ConeGeometry(0.24, 0.45, 16);
    jawGeom.rotateX(Math.PI * 0.5);
    jawGeom.translate(0, -0.08, 0.28);
    const jaw = new THREE.Mesh(jawGeom, this.dragonMaterial);
    this.headGroup.add(jaw);

    // 3. 👑 霸气分叉尖芒龙角系统
    this.hornsGroup = new THREE.Group();

    // 主龙角曲线（后掠、起伏、尖锐挺拔）
    const mainHornCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.04, 0.24, -0.16),
      new THREE.Vector3(0.12, 0.52, -0.45),
      new THREE.Vector3(0.18, 0.75, -0.72) // 尖锐刺向后上方
    ]);
    const mainHornGeom = createTaperedHornGeometry(mainHornCurve, 32, 14, 0.045, 0.001);

    // 副龙角/分叉眉角曲线（向外上方微扬，形成立体鹿角/龙角分叉）
    const subHornCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.04, 0.24, -0.16),
      new THREE.Vector3(0.14, 0.38, -0.22),
      new THREE.Vector3(0.22, 0.50, -0.25)
    ]);
    const subHornGeom = createTaperedHornGeometry(subHornCurve, 20, 10, 0.028, 0.001);

    // 单侧完整分叉龙角组合
    const singleHornGroup = new THREE.Group();
    singleHornGroup.add(new THREE.Mesh(mainHornGeom, this.hornMaterial));
    singleHornGroup.add(new THREE.Mesh(subHornGeom, this.hornMaterial));

    // 左右对称组装
    this.leftHorn = singleHornGroup;
    this.leftHorn.position.set(0.14, 0.16, -0.02);
    
    this.rightHorn = singleHornGroup.clone();
    this.rightHorn.position.set(-0.14, 0.16, -0.02);
    this.rightHorn.scale.set(-1, 1, 1); // X 镜像翻转

    this.hornsGroup.add(this.leftHorn, this.rightHorn);

    // 4. 龙耳/腮侧半透明水晶小鳍 (提升神兽仙气)
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

    // 5. 灵动宝石大眼睛（缩小并更贴合头骨，去掉"凸眼虫"感）
    this.leftEye = this.createGemEye(1);
    this.rightEye = this.createGemEye(-1);
    this.headGroup.add(this.leftEye.group, this.rightEye.group);

    this.scene.add(this.headGroup);
  }

  createGemEye(side) {
    const group = new THREE.Group();
    group.position.set(side * 0.22, 0.09, 0.15);

    const base = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), this.dragonMaterial);
    base.scale.set(1.0, 1.0, 0.85); // 轻微压扁，更像镶嵌的眼珠
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 16, 16),
      new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.0, clearcoat: 1.0 })
    );
    pupil.position.set(0, 0, 0.045);

    const highlight = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    highlight.position.set(0.02, 0.02, 0.08);

    group.add(base, pupil, highlight);
    return { group, pupil };
  }

  initContinuousBody() {
    this.radialSegments = 20; // 兼顾光滑与性能
    this.bodyJointsCount = this.spine.numSegments;

    this.bodyGeometry = new THREE.BufferGeometry();
    const vertexCount = this.bodyJointsCount * this.radialSegments;
    this.positions = new Float32Array(vertexCount * 3);

    const indices = [];
    for (let i = 0; i < this.bodyJointsCount - 1; i++) {
      for (let j = 0; j < this.radialSegments; j++) {
        const a = i * this.radialSegments + j;
        const b = (i + 1) * this.radialSegments + j;
        const c = (i + 1) * this.radialSegments + ((j + 1) % this.radialSegments);
        const d = i * this.radialSegments + ((j + 1) % this.radialSegments);
        indices.push(a, b, d, b, c, d);
      }
    }
    this.bodyGeometry.setIndex(indices);
    // 只在初始化时创建 position attribute，之后每帧只更新数组，避免 GC
    this.bodyGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.bodyMesh = new THREE.Mesh(this.bodyGeometry, this.dragonMaterial);
    this.scene.add(this.bodyMesh);
  }

  initAnatomicalLimbs() {
    this.limbMeshes = [];

    this.limbs.forEach((limb) => {
      const group = new THREE.Group();

      // 肢体整体加粗并与身体材质统一，减少"牙签腿"感
      const shoulderSocket = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), this.dragonMaterial);
      const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, limb.length1 - 0.03, 8, 16), this.dragonMaterial);
      const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 14), this.dragonMaterial);
      const lowerArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, limb.length2 - 0.03, 8, 16), this.dragonMaterial);

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
    const headPos = this.spine.getSegment(0).clone();
    const neckPos = this.spine.getSegment(1);

    // 1. 头部朝向（用稳定 up 向量，避免低头/抬头时翻转）
    this.headGroup.position.copy(headPos);
    const headForward = new THREE.Vector3().subVectors(headPos, neckPos).normalize();
    const headTarget = new THREE.Vector3().addVectors(headPos, headForward);
    this.headGroup.lookAt(headTarget);

    // 2. 龙角弹性阻尼更新（首帧只做初始化，不产生位移冲量）
    const headMoveDelta = new THREE.Vector3();

    if (!this.prevHeadInitialized) {
      this.prevHeadPos.copy(headPos);
      this.prevHeadInitialized = true;
    } else {
      headMoveDelta.subVectors(headPos, this.prevHeadPos);
      this.prevHeadPos.copy(headPos);
    }

    const springK = 80.0;
    const damping = 8.0;
    const forceX = -headMoveDelta.x * 25.0 - springK * this.hornFlex.x;
    const forceY = -headMoveDelta.y * 25.0 - springK * this.hornFlex.y;

    this.hornVelocity.x += (forceX - damping * this.hornVelocity.x) * delta;
    this.hornVelocity.y += (forceY - damping * this.hornVelocity.y) * delta;
    this.hornFlex.x += this.hornVelocity.x * delta;
    this.hornFlex.y += this.hornVelocity.y * delta;

    this.hornsGroup.rotation.z = this.hornFlex.x * 0.5;
    this.hornsGroup.rotation.x = this.hornFlex.y * 0.5;

    // =========================================================
    // =========================================================
    // 2.5 警戒状态平滑过渡：抬角前倾 + 鼓身 + 双眼聚焦 + 警告色
    // =========================================================
    const targetAlert = this.isAlert ? 1.0 : 0.0;
    this.alertStrength = THREE.MathUtils.lerp(this.alertStrength, targetAlert, 0.12);

    if (this.alertStrength > 0.001) {
      // 龙角前倾抬起（更具攻击性）
      this.hornsGroup.rotation.x += this.alertStrength * 0.18;
      this.hornsGroup.rotation.z += Math.sin(performance.now() * 0.008) * this.alertStrength * 0.015;

      // 双眼快速聚焦到头部正前方
      const alertLookDir = new THREE.Vector3()
        .subVectors(this.spine.getSegment(0), this.spine.getSegment(2))
        .normalize();

      this.leftEyeTracker.currentLookDir.lerp(alertLookDir, this.alertStrength * 0.12);
      this.rightEyeTracker.currentLookDir.lerp(alertLookDir, this.alertStrength * 0.12);

      // 身体发出轻微警告色（琥珀/金）
      const warnColor = new THREE.Color(0xffaa33);
      this.dragonMaterial.emissive.lerp(warnColor, this.alertStrength * 0.25);
    } else {
      // 非警戒时 emissive 回归当前皮肤的 baseEmissive
      this.dragonMaterial.emissive.lerp(this.baseEmissive, 0.1);
    }

    // 吐舌蓄力：头部微微后缩，眼睛提前汇聚
    if (this.tongue && this.tongue.isWindingUp()) {
      const windup = this.tongue.getWindupProgress(); // 0~1
      headPos.addScaledVector(headForward, -0.06 * windup);
      this.leftEyeTracker.currentLookDir.lerp(headForward, 0.2);
      this.rightEyeTracker.currentLookDir.lerp(headForward, 0.2);
    }

    // 3. 眼神注视
    this.leftEye.group.lookAt(new THREE.Vector3().addVectors(this.leftEye.group.position, this.leftEyeTracker.currentLookDir));
    this.rightEye.group.lookAt(new THREE.Vector3().addVectors(this.rightEye.group.position, this.rightEyeTracker.currentLookDir));

    // 4. 一体化无缝龙身曲面
    // 注：龙身顶点是世界坐标，直接缩放 mesh 会把整条龙平移/拉长，
    //     因此"身体鼓起"用半径膨胀实现，效果等价且不会破坏贴地。
    const alertPuff = 1.0 + this.alertStrength * 0.18;
    const posAttr = this.positions;
    for (let i = 0; i < this.bodyJointsCount; i++) {
      const p = this.spine.getSegment(i);
      const prev = this.spine.getSegment(Math.max(0, i - 1));
      const next = this.spine.getSegment(Math.min(this.bodyJointsCount - 1, i + 1));

      const dir = new THREE.Vector3().subVectors(prev, next).normalize();
      if (dir.lengthSq() < 0.0001) dir.set(0, 1, 0);

      const up = new THREE.Vector3(0, 0, 1);
      const normal = new THREE.Vector3().crossVectors(dir, up).normalize();
      const binormal = new THREE.Vector3().crossVectors(dir, normal).normalize();

      // 更修长的龙身半径曲线：颈部较细 → 胸腔略宽 → 尾部优雅收尖
      const t = i / (this.bodyJointsCount - 1);
      let radius = THREE.MathUtils.smoothstep(t, 0.0, 0.18) * 0.24
        + THREE.MathUtils.smoothstep(t, 0.18, 0.50) * 0.08
        - THREE.MathUtils.smoothstep(t, 0.50, 1.0) * 0.26;
      radius = Math.max(0.025, radius);

      radius *= alertPuff; // 警戒时身体轻微鼓起

      for (let j = 0; j < this.radialSegments; j++) {
        const theta = (j / this.radialSegments) * Math.PI * 2;
        const vx = Math.cos(theta) * radius;
        const vy = Math.sin(theta) * radius; // 身体截面更接近圆形，避免侧面过高挡腿

        const vertex = new THREE.Vector3().copy(p).addScaledVector(normal, vx).addScaledVector(binormal, vy);
        const vIdx = (i * this.radialSegments + j) * 3;
        posAttr[vIdx] = vertex.x;
        posAttr[vIdx + 1] = vertex.y;
        posAttr[vIdx + 2] = vertex.z;
      }
    }

    this.bodyGeometry.attributes.position.array = posAttr;
    this.bodyGeometry.attributes.position.needsUpdate = true;
    this.bodyGeometry.computeVertexNormals();

    // 5. 四肢骨骼与带俯仰的灵动爪
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

    // 6. 材质变色过渡
    this.dragonMaterial.color.lerp(this.targetBodyColor, 0.08);
    this.hornMaterial.color.lerp(this.targetHornColor, 0.08);
    this.finMaterial.color.lerp(this.targetHornColor, 0.08);
  }

  orientBone(mesh, p1, p2) {
    mesh.position.copy(p1).lerp(p2, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(p2, p1).normalize());
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
    this.dragonMaterial.emissive.setHex(p.emissive);
    this.baseEmissive.setHex(p.emissive);
  }

  triggerFeedPulse() {
    this.targetBodyColor.setHex(0xffffff);
    setTimeout(() => {
      this.setPalette(this.currentPalette);
    }, 200);
  }
}
