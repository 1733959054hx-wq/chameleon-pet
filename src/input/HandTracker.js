import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { OneEuroFilter3D } from '../core/MathDynamics.js';

export class HandTracker {
  constructor(onResultCallback) {
    this.onResult = onResultCallback;
    this.videoElement = document.createElement('video');
    this.videoElement.style.display = 'none';
    document.body.appendChild(this.videoElement);

    // 使用 1€ Filter 替代固定 EMA，静止时稳如磐石，快速移动零延迟
    this.euroFilter = new OneEuroFilter3D(1.35, 0.045, 1.0);
    this.isPinchingPrev = false;

    this.hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7
    });

    this.hands.onResults((results) => this.processResults(results));
    this.cameraUtils = null;
  }

  start() {
    if (!this.cameraUtils) {
      this.cameraUtils = new Camera(this.videoElement, {
        onFrame: async () => {
          await this.hands.send({ image: this.videoElement });
        },
        width: 640,
        height: 480
      });
    }
    this.cameraUtils.start();
  }

  stop() {
    if (this.cameraUtils) this.cameraUtils.stop();
  }

  processResults(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      this.onResult({ detected: false });
      return;
    }

    const lm = results.multiHandLandmarks[0];
    const thumbTip = lm[4];
    const rawIndex = lm[8];
    const middleTip = lm[12];
    const wrist = lm[0];

    // 1€ Filter 自适应滤波
    const smoothedIndex = this.euroFilter.filter(rawIndex.x, rawIndex.y, rawIndex.z, performance.now());

    // 捏合迟滞检测 (Hysteresis: 进入 0.06, 释放 0.085)
    const pinchDist = Math.hypot(
      thumbTip.x - rawIndex.x,
      thumbTip.y - rawIndex.y,
      thumbTip.z - rawIndex.z
    );
    let isPinching = this.isPinchingPrev;
    if (pinchDist < 0.06) isPinching = true;
    else if (pinchDist > 0.085) isPinching = false;

    const pinchStarted = isPinching && !this.isPinchingPrev;
    const pinchReleased = !isPinching && this.isPinchingPrev;
    this.isPinchingPrev = isPinching;

    // 张开手掌检测 + 手部距离摄像头深度估算
    const palmSpan = Math.hypot(middleTip.x - wrist.x, middleTip.y - wrist.y);
    const isOpenPalm = palmSpan > 0.45 && !isPinching;
    const depthOffset = (palmSpan - 0.32) * 3.2; // 将手掌远近映射为 3D Z 轴偏移

    this.onResult({
      detected: true,
      indexTip: smoothedIndex,
      depthZ: Math.max(-1.2, Math.min(1.2, depthOffset)),
      isPinching,
      isOpenPalm,
      pinchStarted,
      pinchReleased
    });
  }
}
