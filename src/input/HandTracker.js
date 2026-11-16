import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';

export class HandTracker {
  constructor(onResultCallback) {
    this.onResult = onResultCallback;
    this.videoElement = document.createElement('video');
    this.videoElement.style.display = 'none';
    document.body.appendChild(this.videoElement);

    // 滤波平滑向量
    this.smoothedIndex = { x: 0.5, y: 0.5, z: 0 };
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

    // 指数移动平均平滑滤波 (EMA Filter, Alpha = 0.28) 彻底滤除微颤
    const alpha = 0.28;
    this.smoothedIndex.x += (rawIndex.x - this.smoothedIndex.x) * alpha;
    this.smoothedIndex.y += (rawIndex.y - this.smoothedIndex.y) * alpha;
    this.smoothedIndex.z += (rawIndex.z - this.smoothedIndex.z) * alpha;

    // 捏合迟滞检测 (Hysteresis - 进入阈值 0.06，释放阈值 0.085)
    const pinchDist = Math.hypot(thumbTip.x - rawIndex.x, thumbTip.y - rawIndex.y, thumbTip.z - rawIndex.z);
    let isPinching = this.isPinchingPrev;
    if (pinchDist < 0.06) isPinching = true;
    else if (pinchDist > 0.085) isPinching = false;
    // 动作化手势：只在状态翻转的那一帧置位，避免"一直捏着"被当成持续触发
    const pinchStarted = isPinching && !this.isPinchingPrev;
    const pinchReleased = !isPinching && this.isPinchingPrev;
    this.isPinchingPrev = isPinching;

    // 张开手掌检测
    const palmSpan = Math.hypot(middleTip.x - wrist.x, middleTip.y - wrist.y);
    const isOpenPalm = palmSpan > 0.46 && !isPinching;

    this.onResult({
      detected: true,
      indexTip: this.smoothedIndex,
      isPinching: isPinching,
      isOpenPalm: isOpenPalm,
      pinchStarted: pinchStarted,
      pinchReleased: pinchReleased
    });
  }
}
