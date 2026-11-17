import * as THREE from 'three';

/**
 * 发光能量灵蝶（可被灵龙锁定并用舌头真实捕获）
 */
class CrystalButterfly {
  constructor(scene, position) {
    this.scene = scene;
    this.origin = position.clone();
    this.position = position.clone();
    this.phase = Math.random() * Math.PI * 2;
    this.wingPhase = Math.random() * 10;
    this.isCaught = false;
    this.alive = true;

    this.group = new THREE.Group();
    this.group.position.copy(position);

    const wingGeom = new THREE.ConeGeometry(0.11, 0.18, 4);
    wingGeom.rotateZ(Math.PI * 0.5);
    wingGeom.scale(1, 0.25, 1.3);

    const wingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.88
    });

    this.leftWing = new THREE.Mesh(wingGeom, wingMat);
    this.leftWing.position.x = 0.06;
    this.rightWing = this.leftWing.clone();
    this.rightWing.scale.x = -1;
    this.rightWing.position.x = -0.06;

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xfef08a })
    );

    this.group.add(this.leftWing, this.rightWing, core);
    this.scene.add(this.group);
  }

  update(delta) {
    if (!this.alive) return;
    this.wingPhase += delta * 28.0;
    const flap = Math.sin(this.wingPhase) * 0.65;
    this.leftWing.rotation.z = flap;
    this.rightWing.rotation.z = -flap;

    if (!this.isCaught) {
      this.phase += delta * 1.9;
      this.position.x = this.origin.x + Math.sin(this.phase * 1.3) * 0.45;
      this.position.y = Math.max(-0.4, this.origin.y + Math.cos(this.phase * 1.7) * 0.28);
      this.position.z = this.origin.z + Math.sin(this.phase * 0.9) * 0.25;
      this.group.position.copy(this.position);
      this.group.rotation.y = Math.cos(this.phase * 1.3) * 0.5;
    } else {
      this.group.position.copy(this.position);
    }
  }

  destroy() {
    this.alive = false;
    this.scene.remove(this.group);
  }
}

export class PreyAndParticleManager {
  constructor(scene) {
    this.scene = scene;
    this.butterflies = [];
    this.particles = [];
    this.initParticlePool();
  }

  initParticlePool() {
    this.particleGeom = new THREE.SphereGeometry(0.032, 8, 8);
  }

  spawnButterfly(pos) {
    if (this.butterflies.length >= 6) {
      const oldest = this.butterflies.shift();
      oldest.destroy();
    }
    const b = new CrystalButterfly(this.scene, pos);
    this.butterflies.push(b);
    this.emitBurst(pos, 0x38bdf8, 10);
    return b;
  }

  spawnSwarm() {
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Vector3(
        (Math.random() - 0.5) * 3.6,
        -0.2 + Math.random() * 1.6,
        (Math.random() - 0.5) * 0.8
      );
      this.spawnButterfly(p);
    }
  }

  findNearestPrey(fromPos, maxRange = 3.2) {
    let best = null;
    let bestDist = maxRange;
    for (const b of this.butterflies) {
      if (!b.alive || b.isCaught) continue;
      const d = fromPos.distanceTo(b.position);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  emitBurst(origin, colorHex = 0xfde047, count = 14) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 1.0
      });
      const mesh = new THREE.Mesh(this.particleGeom, mat);
      mesh.position.copy(origin);
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 2.4,
        (Math.random() - 0.2) * 2.4,
        (Math.random() - 0.5) * 2.4
      );
      this.scene.add(mesh);
      this.particles.push({ mesh, mat, velocity, life: 1.0 });
    }
  }

  update(delta) {
    for (let i = this.butterflies.length - 1; i >= 0; i--) {
      const b = this.butterflies[i];
      if (!b.alive) {
        this.butterflies.splice(i, 1);
      } else {
        b.update(delta);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta * 1.8;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mat.dispose();
        this.particles.splice(i, 1);
      } else {
        p.mesh.position.addScaledVector(p.velocity, delta);
        p.velocity.y -= 2.5 * delta;
        p.mesh.scale.setScalar(p.life);
        p.mat.opacity = p.life;
      }
    }
  }
}
