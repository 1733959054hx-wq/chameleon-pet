import * as THREE from 'three';
import { HandTracker } from './HandTracker.js';

export const ActionState = {
  IDLE: 'IDLE',             // 自主巡游呼吸
  FOLLOW: 'FOLLOW',         // 灵珠尾随
  PINCH_FEED: 'PINCH_FEED', // 捏合/左键 -> 弹舌捕食
  ALERT: 'ALERT',           // 张掌/右键/E键 -> 伏低警戒
  PETTING: 'PETTING'        // 轻抚龙身 -> 愉悦流光
};

export class InputManager {
  constructor(scene, camera, domElement) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;

    this.mode = 'MOUSE'; // 'MOUSE' | 'CAMERA'
    this.targetPosition = new THREE.Vector3(0, 0, 0);
    this.currentAction = ActionState.FOLLOW;
    this.feedTriggered = false;
    this.doubleClickSpawnPos = null;

    this.lastPointerMoveTime = performance.now();
    this.isRightMouseDown = false;
    this.isKeyAlertDown = false;
    this.pointerSpeed = 0;

    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    this.initMouseAndKeys();
    this.handTracker = new HandTracker((handData) => this.onHandUpdate(handData));
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'CAMERA') {
      this.handTracker.start();
    } else {
      this.handTracker.stop();
      this.currentAction = ActionState.FOLLOW;
    }
  }

  initMouseAndKeys() {
    this.mouse = new THREE.Vector2();
    const prevTarget = new THREE.Vector3();

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (this.mode !== 'MOUSE') return;
      this.lastPointerMoveTime = performance.now();
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      prevTarget.copy(this.targetPosition);
      this.updateMouseTarget();
      this.pointerSpeed = this.targetPosition.distanceTo(prevTarget);
    });

    window.addEventListener('mousedown', (e) => {
      if (this.mode !== 'MOUSE') return;
      if (e.target.closest('#ui-container')) return;
      this.lastPointerMoveTime = performance.now();

      if (e.button === 0) {
        this.currentAction = ActionState.PINCH_FEED;
        this.feedTriggered = true;
      } else if (e.button === 2) {
        // ✅ 新增：鼠标右键按住直接触发 ALERT 警戒状态
        this.isRightMouseDown = true;
        this.currentAction = ActionState.ALERT;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.mode !== 'MOUSE') return;
      if (e.button === 2) this.isRightMouseDown = false;
      this.currentAction = this.isRightMouseDown || this.isKeyAlertDown ? ActionState.ALERT : ActionState.FOLLOW;
    });

    window.addEventListener('dblclick', (e) => {
      if (e.target.closest('#ui-container')) return;
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      const pt = new THREE.Vector3();
      this.raycaster.setFromCamera(this.mouse, this.camera);
      this.raycaster.ray.intersectPlane(this.plane, pt);
      this.doubleClickSpawnPos = pt;
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'e' || e.key === 'E') {
        this.isKeyAlertDown = true;
        this.currentAction = ActionState.ALERT;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'e' || e.key === 'E') {
        this.isKeyAlertDown = false;
        if (this.mode === 'MOUSE' && !this.isRightMouseDown) {
          this.currentAction = ActionState.FOLLOW;
        }
      }
    });
  }

  updateMouseTarget() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    this.raycaster.ray.intersectPlane(this.plane, this.targetPosition);
  }

  /**
   * 检测指针是否正在轻抚龙身脊椎段，若是则临时切入 PETTING 愉悦状态
   */
  evaluateBodyInteraction(spine, delta) {
    if (this.mode === 'MOUSE') {
      if (this.isRightMouseDown || this.isKeyAlertDown) {
        this.currentAction = ActionState.ALERT;
        return;
      }
      if (this.currentAction === ActionState.PINCH_FEED) return;

      // 超过 5 秒未移动鼠标则进入自主巡游 IDLE 状态
      if (performance.now() - this.lastPointerMoveTime > 5000) {
        this.currentAction = ActionState.IDLE;
        return;
      }

      // 检测鼠标是否在龙身第 2~14 节附近轻柔滑动 (抚摸)
      if (this.pointerSpeed > 0.004 && this.pointerSpeed < 0.18) {
        for (let i = 2; i < 15; i++) {
          if (this.targetPosition.distanceTo(spine.getSegment(i)) < 0.28) {
            this.currentAction = ActionState.PETTING;
            this.pointerSpeed *= 0.5;
            return;
          }
        }
      }
      this.currentAction = ActionState.FOLLOW;
    }
  }

  onHandUpdate(handData) {
    if (this.mode !== 'CAMERA') return;
    if (!handData.detected) {
      this.currentAction = ActionState.IDLE;
      return;
    }

    const ndc = new THREE.Vector3(
      -(handData.indexTip.x * 2 - 1),
      -(handData.indexTip.y * 2 - 1),
      0.5
    );
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const distance = -this.camera.position.z / dir.z;
    this.targetPosition.copy(this.camera.position).add(dir.multiplyScalar(distance));
    this.targetPosition.z = handData.depthZ || 0;

    if (handData.pinchStarted) {
      this.currentAction = ActionState.PINCH_FEED;
      this.feedTriggered = true;
    } else if (handData.isPinching) {
      this.currentAction = ActionState.PINCH_FEED;
    } else if (handData.isOpenPalm) {
      this.currentAction = ActionState.ALERT;
    } else {
      this.currentAction = ActionState.FOLLOW;
    }
  }
}
