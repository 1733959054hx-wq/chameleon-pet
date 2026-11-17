import * as THREE from 'three';

/**
 * 为 MeshPhysicalMaterial 注入程序化龙鳞微凹凸、腹部渐变色与沿脊椎传导的能量波纹
 */
export function enhanceCrystalDragonMaterial(material, uniformsHub) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniformsHub.uTime;
    shader.uniforms.uPulseProgress = uniformsHub.uPulseProgress;
    shader.uniforms.uPulseColor = uniformsHub.uPulseColor;
    shader.uniforms.uBellyColor = uniformsHub.uBellyColor;
    shader.uniforms.uAlertLevel = uniformsHub.uAlertLevel;
    shader.uniforms.uPettingGlow = uniformsHub.uPettingGlow;

    shader.vertexShader = `
      varying vec2 vDragonUv;
      varying vec3 vLocalPos;
      ${shader.vertexShader}
    `.replace(
      '#include <uv_vertex>',
      `
      #include <uv_vertex>
      vDragonUv = uv;
      vLocalPos = position;
      `
    );

    shader.fragmentShader = `
      uniform float uTime;
      uniform float uPulseProgress;
      uniform vec3 uPulseColor;
      uniform vec3 uBellyColor;
      uniform float uAlertLevel;
      uniform float uPettingGlow;
      varying vec2 vDragonUv;
      varying vec3 vLocalPos;
      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      // 1. 腹部双色柔和过渡 (利用环向 UV u 计算腹部区域)
      float bellyMask = smoothstep(0.22, 0.65, sin(vDragonUv.x * 3.14159265));
      diffuseColor.rgb = mix(diffuseColor.rgb, uBellyColor, bellyMask * 0.42);

      // 2. 程序化六边形水晶微鳞片光泽
      vec2 scaleGrid = vec2(vDragonUv.x * 24.0, vDragonUv.y * 55.0);
      float scalePattern = sin(scaleGrid.x) * sin(scaleGrid.y);
      float scaleHighlight = smoothstep(0.35, 0.95, scalePattern) * 0.08;
      diffuseColor.rgb += scaleHighlight;
      `
    ).replace(
      '#include <emissivemap_fragment>',
      `
      #include <emissivemap_fragment>
      // 3. 沿着脊椎 (vDragonUv.y: 0 头 -> 1 尾) 传导的流光脉冲波
      if (uPulseProgress > 0.0 && uPulseProgress < 1.3) {
        float distToWave = abs(vDragonUv.y - uPulseProgress);
        float waveBand = exp(-distToWave * distToWave * 38.0);
        totalEmissiveRadiance += uPulseColor * waveBand * 2.2;
      }

      // 4. 呼吸能量律动与抚摸/警戒辉光
      float breathWave = 0.5 + 0.5 * sin(uTime * 3.2 - vDragonUv.y * 6.0);
      totalEmissiveRadiance += diffuseColor.rgb * breathWave * 0.14;

      if (uPettingGlow > 0.01) {
        float petWave = 0.5 + 0.5 * sin(uTime * 8.0 - vDragonUv.y * 10.0);
        totalEmissiveRadiance += vec3(1.0, 0.75, 0.35) * uPettingGlow * petWave * 0.85;
      }

      if (uAlertLevel > 0.01) {
        float warnStripe = step(0.3, sin(vDragonUv.y * 40.0 - uTime * 12.0));
        totalEmissiveRadiance += vec3(1.0, 0.35, 0.05) * uAlertLevel * warnStripe * 0.55;
      }

      // 5. 菲涅尔水晶边缘透光：零性能开销替代 transmission 的通透琉璃感
      vec3 viewDir = normalize(vViewPosition);
      float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.8);
      totalEmissiveRadiance += mix(diffuseColor.rgb, uPulseColor, 0.5) * fresnel * 0.95;
      `
    );
  };
  material.needsUpdate = true;
}
