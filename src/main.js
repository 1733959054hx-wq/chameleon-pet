import * as THREE from 'three';
import { InputManager, ActionState } from './input/InputManager.js';
import { SpineChain } from './creature/SpineChain.js';
import { LimbIK } from './creature/LimbIK.js';
import { EyeTracker } from './creature/EyeTracker.js';
import { TongueSystem } from './creature/TongueSystem.js';
import { ChameleonModel, PALETTES } from './creature/ChameleonModel.js';

class DragonApp {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0.2, 7.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    document.body.appendChild(this.renderer.domElement);

    this.input = new InputManager(this.scene, this.camera, this.renderer.domElement);
    
    this.spine = new SpineChain(20, 0.22);
    this.leftEye = new EyeTracker(true);
    this.rightEye = new EyeTracker(false);
    this.tongue = new TongueSystem(this.scene); // 3D 立体舌头

    this.limbs = [
      new LimbIK(this.spine, 3, 1, true),
      new LimbIK(this.spine, 3, -1, true),
      new LimbIK(this.spine, 10, 1, false),
      new LimbIK(this.spine, 10, -1, false)
    ];

    this.dragon = new ChameleonModel(this.scene, this.spine, this.limbs, this.leftEye, this.rightEye);
    this.dragon.setTongue(this.tongue); // 让模型能感知吐舌蓄力
    this.currentForm = 'CRAWL'; // 'CRAWL' | 'SWIM'

    this.initLightingAndFloor(); // 删掉黑棍，换上高级阴影地面
    this.initSpiritOrb();
    this.initUI();
    this.initKeyboard();
    
    this.clock = new THREE.Clock();
    this.smoothHeadTarget = new THREE.Vector3();
    window.addEventListener('resize', () => this.onResize());
    this.animate();
  }

  initLightingAndFloor() {
    // 主光 (投射柔和阴影)
    const mainLight = new THREE.DirectionalLight(0xffffff, 2.2);
    mainLight.position.set(4, 7, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 20;

    // 轮廓光与环境光
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 2.5);
    rimLight.position.set(-6, -2, -4);
    const ambientLight = new THREE.AmbientLight(0x0f172a, 1.4);
    this.scene.add(mainLight, rimLight, ambientLight);

    // ❌ 彻底删除斜向黑棍！
    // ✅ 新增：极简半透明阴影地面，爬行时脚掌牢牢踩在此处
    const floorGeom = new THREE.PlaneGeometry(30, 30);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    this.floor = new THREE.Mesh(floorGeom, floorMat);
    this.floor.rotation.x = -Math.PI * 0.5;
    this.floor.position.y = -0.8;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
  }

  initSpiritOrb() {
    // 诱饵小灵光
    const orbGroup = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.6 }));
    orbGroup.add(core, glow);
    this.spiritOrb = orbGroup;
    this.scene.add(this.spiritOrb);
  }

  setForm(form) {
    this.currentForm = form;
    this.spine.setForm(form);
    this.limbs.forEach(limb => limb.setForm(form));
    document.getElementById('form-toggle').innerText = `当前形态: ${form === 'CRAWL' ? '🐾 陆地爬行' : '🐉 腾云游龙'}`;
  }

  initUI() {
    // 形态切换按钮
    const formBtn = document.getElementById('form-toggle');
    formBtn.addEventListener('click', () => {
      this.setForm(this.currentForm === 'CRAWL' ? 'SWIM' : 'CRAWL');
    });

    // 模式切换
    const toggleBtn = document.getElementById('mode-toggle');
    toggleBtn.addEventListener('click', () => {
      const nextMode = this.input.mode === 'MOUSE' ? 'CAMERA' : 'MOUSE';
      this.input.setMode(nextMode);
      toggleBtn.innerText = `当前输入: ${nextMode === 'MOUSE' ? '🖱️ 鼠标控制' : '📷 摄像头手势'}`;
    });

    // 调色盘
    const paletteContainer = document.getElementById('palette-container');
    if (paletteContainer) {
      Object.keys(PALETTES).forEach(key => {
        const btn = document.createElement('button');
        btn.className = 'palette-btn';
        btn.style.backgroundColor = '#' + PALETTES[key].body.toString(16).padStart(6, '0');
        btn.title = PALETTES[key].name;
        btn.addEventListener('click', () => this.dragon.setPalette(key));
        paletteContainer.appendChild(btn);
      });
    }
  }

  initKeyboard() {
    const keys = ['JADE', 'SAKURA', 'CYBER', 'LAVA', 'AURORA'];
    window.addEventListener('keydown', (e) => {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 5) this.dragon.setPalette(keys[num - 1]);
      if (e.key === ' ' || e.key === 'Tab') {
        e.preventDefault();
        this.setForm(this.currentForm === 'CRAWL' ? 'SWIM' : 'CRAWL');
      }
    });
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const delta = Math.min(this.clock.getDelta(), 0.04);

    const rawTarget = this.input.targetPosition.clone();

    // 爬行模式下，头部保持在地面上方平移
    if (this.currentForm === 'CRAWL') {
      rawTarget.y = Math.max(-0.45, rawTarget.y);
    }
    this.spiritOrb.position.copy(rawTarget);

    // 眼睛注视 / 吐舌的目标仍然是龙珠本身
    const target = rawTarget;

    // =========================================================
    // 龙头追龙珠：让龙头与龙珠保持一段距离，像舞龙一样尾随，
    // 而不是直接把头贴到龙珠上。这里用平滑插值，避免跟随点抖动。
    // =========================================================
    let headPos = this.spine.getSegment(0);
    const toOrb = new THREE.Vector3().subVectors(rawTarget, headPos);
    const dist = toOrb.length();
    const followDist = this.currentForm === 'CRAWL' ? 0.55 : 0.85;
    const desiredHeadTarget = rawTarget.clone();
    if (dist < followDist && dist > 0.001) {
      desiredHeadTarget.addScaledVector(toOrb.normalize(), -followDist);
    }

    this.smoothHeadTarget.lerp(desiredHeadTarget, 0.25);

    // 脊椎解算
    this.spine.update(this.smoothHeadTarget, delta);

    // 陆地爬行动力学：脚离开理想位置过远时触发迈步
    if (this.currentForm === 'CRAWL') {
      const stepThreshold = 0.35;
      if (this.limbs[0].currentFootPos.distanceTo(this.limbs[0].getIdealFootPos()) > stepThreshold && !this.limbs[1].isStepping) {
        this.limbs[0].triggerStep();
        this.limbs[3].triggerStep();
      } else if (this.limbs[1].currentFootPos.distanceTo(this.limbs[1].getIdealFootPos()) > stepThreshold && !this.limbs[0].isStepping) {
        this.limbs[1].triggerStep();
        this.limbs[2].triggerStep();
      }
    }
    this.limbs.forEach(limb => limb.update(delta));

    // 双眼注视
    headPos = this.spine.getSegment(0);
    const action = this.input.currentAction;
    const isFeeding = action === ActionState.PINCH_FEED;
    const isAlert = action === ActionState.ALERT;

    // =========================================================
    // ALERT：张掌 → 龙进入警戒状态
    // =========================================================
    if (isAlert) {
      this.dragon.setAlertState(true);
      this.spine.alertIntensity = THREE.MathUtils.lerp(this.spine.alertIntensity ?? 0, 1, 0.15);
    } else {
      this.dragon.setAlertState(false);
      this.spine.alertIntensity = THREE.MathUtils.lerp(this.spine.alertIntensity ?? 0, 0, 0.12);
    }

    // 蓄力阶段也强制双眼汇聚，形成"锁定猎物 → 后缩 → 弹出"的连贯动作
    const focusOnPrey = isFeeding || this.tongue.isWindingUp();
    this.leftEye.update(headPos, target, focusOnPrey, delta);
    this.rightEye.update(headPos, target, focusOnPrey, delta);

    // 3D 肌肉弹射舌头触发：捏合/点击【瞬间】只触发一次，捏住不放不会连发
    if (isFeeding && this.input.feedTriggered && !this.tongue.isActive()) {
      this.tongue.fire(headPos, target);
      this.dragon.triggerFeedPulse();
      this.input.feedTriggered = false;
    }
    this.tongue.update(headPos, delta);

    // 模型渲染
    this.dragon.update(delta);

    this.renderer.render(this.scene, this.camera);
  }
}

new DragonApp();
