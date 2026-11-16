import * as THREE from 'three';
import { HandTracker } from './HandTracker.js';

export const ActionState = {
  IDLE: 'IDLE',
  FOLLOW: 'FOLLOW',
  PINCH_FEED: 'PINCH_FEED', // 捏合/点击 -> 喂食/弹舌头
  ALERT: 'ALERT'            // 手掌张开 -> 防御警戒
};

export class InputManager {
  constructor(scene, camera, domElement) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;

    this.mode = 'MOUSE'; // 'MOUSE' | 'CAMERA'
    this.targetPosition = new THREE.Vector3(0, 0, 0);
    this.currentAction = ActionState.FOLLOW;
    this.normalizedDistance = 1.0; // 距离变色龙的远近
    this.feedTriggered = false;    // 一次性触发标记：捏合/按下瞬间置位，被主循环消费后清零

    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // 默认交互平面

    this.initMouse();
    this.handTracker = new HandTracker((handData) => this.onHandUpdate(handData));
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'CAMERA') {
      this.handTracker.start();
    } else {
      this.handTracker.stop();
    }
  }

  initMouse() {
    this.mouse = new THREE.Vector2();
    window.addEventListener('mousemove', (e) => {
      if (this.mode !== 'MOUSE') return;
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.updateMouseTarget();
    });

    window.addEventListener('mousedown', (e) => {
      if (this.mode !== 'MOUSE') return;
      if (e.button === 0) {
        this.currentAction = ActionState.PINCH_FEED;
        this.feedTriggered = true; // 点击瞬间只触发一次吐舌
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.mode !== 'MOUSE') return;
      this.currentAction = ActionState.FOLLOW;
    });
  }

  updateMouseTarget() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    this.raycaster.ray.intersectPlane(this.plane, this.targetPosition);
  }

  onHandUpdate(handData) {
    if (this.mode !== 'CAMERA') return;
    if (!handData.detected) {
      this.currentAction = ActionState.IDLE;
      return;
    }

    // 映射食指尖坐标到 3D 世界空间
    const ndc = new THREE.Vector3(
      -(handData.indexTip.x * 2 - 1), // 镜像翻转符合直觉
      -(handData.indexTip.y * 2 - 1),
      0.5
    );
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const distance = -this.camera.position.z / dir.z;
    this.targetPosition.copy(this.camera.position).add(dir.multiplyScalar(distance));

    // 根据手势特征派发状态
    if (handData.pinchStarted) {
      // 捏合【瞬间】：置位一次性触发标记，由主循环消费后清零，避免捏住不放反复吐舌
      this.currentAction = ActionState.PINCH_FEED;
      this.feedTriggered = true;
    } else if (handData.isPinching) {
      // 持续捏合：保持对焦注视，但不再重复触发吐舌
      this.currentAction = ActionState.PINCH_FEED;
    } else if (handData.isOpenPalm) {
      this.currentAction = ActionState.ALERT;
    } else {
      this.currentAction = ActionState.FOLLOW;
    }
  }
}
