import * as THREE from 'three';
import type { GameState } from './model';

const MINT = 0xc1ffba;
const CYAN = 0x52ddce;
const DARK = 0x092229;

/** The renderer owns GPU resources; the model owns all gameplay decisions. */
export class GameScene {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(56, 1, 0.1, 420);
  private renderer: THREE.WebGLRenderer;
  private ship = new THREE.Group();
  private engines: THREE.Mesh[] = [];
  private gates: THREE.Group[] = [];
  private laneMarks: THREE.InstancedMesh;
  private scenery: THREE.InstancedMesh;
  private obstaclePool: THREE.Group[] = [];
  private crystalPool: THREE.Group[] = [];
  private preview = new THREE.Group();
  private sparks: THREE.Points;
  private sparkPositions = new Float32Array(90 * 3);
  private sparkVelocities = new Float32Array(90 * 3);
  private sparkLife = 0;
  private clock = 0;
  private scroll = 0;
  private observer: ResizeObserver;
  private dummy = new THREE.Object3D();
  private width = 1;
  private height = 1;
  private menuBlend = 1;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private lastPlayerX = 0;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.35 : 1.7));
    this.renderer.setClearColor(DARK);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.domElement.setAttribute('aria-label', 'Pista orbital tridimensional com nave, barreiras e cristais');
    this.host.append(this.renderer.domElement);
    this.scene.fog = new THREE.FogExp2(DARK, 0.008);
    this.scene.add(new THREE.HemisphereLight(0xcdf7ed, 0x133138, 3.5));
    const sun = new THREE.DirectionalLight(0xf3ffda, 4.2);
    sun.position.set(-25, 35, -30);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x51dfde, 3);
    rim.position.set(15, 8, 15);
    this.scene.add(rim);

    const road = new THREE.Mesh(new THREE.BoxGeometry(11.2, 0.6, 340), this.material(0x19373c, 0.6, 0.45));
    road.position.set(0, -0.65, -150);
    this.scene.add(road);
    const underRoad = new THREE.Mesh(new THREE.BoxGeometry(13.1, 1.3, 340), this.material(0x06191e, 0.8, 0.4));
    underRoad.position.set(0, -1.55, -150);
    this.scene.add(underRoad);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.09, 340), this.glow(MINT, 1.2));
      rail.position.set(side * 5.5, -0.3, -150);
      this.scene.add(rail);
      const outerRail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 340), this.glow(CYAN, 0.7));
      outerRail.position.set(side * 6.4, -0.8, -150);
      this.scene.add(outerRail);
    }
    this.laneMarks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 0.025, 2.8), this.glow(0x7baba2, 0.2), 120);
    this.scene.add(this.laneMarks);

    const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(10.6, 0.025, 0.05), this.material(0x638b83, 0.5, 0.6), 65);
    for (let i = 0; i < 65; i++) {
      this.dummy.position.set(0, -0.327, 18 - i * 5);
      this.dummy.updateMatrix(); panels.setMatrixAt(i, this.dummy.matrix);
    }
    this.scene.add(panels);
    this.scenery = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.material(0x12323a, 0.8, 0.55), 100);
    this.scene.add(this.scenery);
    for (let i = 0; i < 7; i++) {
      const gate = new THREE.Group();
      const steel = this.material(0x285057, 0.65, 0.35);
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.58, 10, 0.9), steel);
        leg.position.set(side * 7.1, 4.2, 0); leg.rotation.z = side * -0.19; gate.add(leg);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 9.9, 0.06), this.glow(MINT, 1.5));
        strip.position.set(side * 6.83, 4.2, 0.49); strip.rotation.z = side * -0.19; gate.add(strip);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(16, 0.6, 0.9), steel);
      top.position.set(0, 9, 0); gate.add(top);
      const topLight = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.065, 0.08), this.glow(MINT, 1.5));
      topLight.position.set(0, 8.65, 0.46); gate.add(topLight);
      this.gates.push(gate); this.scene.add(gate);
    }
    this.makeSky();
    this.makeShip();
    this.scene.add(this.ship);
    for (let i = 0; i < 30; i++) {
      const obstacle = this.makeObstacle(); obstacle.visible = false;
      const crystal = this.makeCrystal(); crystal.visible = false;
      this.obstaclePool.push(obstacle); this.crystalPool.push(crystal);
      this.scene.add(obstacle, crystal);
    }
    for (let i = 0; i < 7; i++) {
      const object = i % 3 === 0 ? this.makeObstacle() : this.makeCrystal();
      object.position.set(((i % 3) - 1) * 3.2, 0, -13 - i * 13);
      this.preview.add(object);
    }
    this.scene.add(this.preview);
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    this.sparks = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({ color: MINT, size: 0.14, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host);
    this.resize();
  }

  private material(color: number, roughness = 0.4, metalness = 0.6) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  }
  private glow(color: number, intensity = 1) {
    return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.2 });
  }
  private makeSky() {
    const starPositions = new Float32Array(750 * 3);
    let seed = 174;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 750; i++) {
      starPositions[i * 3] = (random() - 0.5) * 650;
      starPositions[i * 3 + 1] = random() * 170 - 25;
      starPositions[i * 3 + 2] = -30 - random() * 290;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xb5dad0, size: 0.4, transparent: true, opacity: 0.65, sizeAttenuation: true, fog: false })));
    const planet = new THREE.Mesh(new THREE.SphereGeometry(35, 64, 48), this.material(0x4b7b74, 0.97, 0.05));
    planet.position.set(61, 39, -220);
    this.scene.add(planet);
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(36.3, 48, 32), new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vNormal; varying vec3 vPosition; void main(){vNormal=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.);vPosition=p.xyz;gl_Position=projectionMatrix*p;}',
      fragmentShader: 'varying vec3 vNormal; varying vec3 vPosition; void main(){float glow=pow(1.-abs(dot(normalize(vNormal),normalize(-vPosition))),3.);gl_FragColor=vec4(.35,.9,.75,glow*.42);}',
    }));
    atmosphere.position.copy(planet.position); this.scene.add(atmosphere);
    const ring = new THREE.Mesh(new THREE.RingGeometry(44, 46.5, 120), new THREE.MeshBasicMaterial({ color: 0x86b8a4, side: THREE.DoubleSide, transparent: true, opacity: 0.25, depthWrite: false, fog: false }));
    ring.position.copy(planet.position); ring.rotation.set(1.15, 0.2, -0.28); this.scene.add(ring);
    const horizon = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), this.material(0x09252b, 0.9, 0.3));
    horizon.rotation.x = -Math.PI / 2; horizon.position.y = -24; this.scene.add(horizon);
  }

  private makeShip() {
    const body = new THREE.Shape();
    body.moveTo(0, 2.1); body.lineTo(0.63, 0.2); body.lineTo(1.55, -1.25); body.lineTo(0.6, -0.93);
    body.lineTo(0.42, -1.6); body.lineTo(-0.42, -1.6); body.lineTo(-0.6, -0.93); body.lineTo(-1.55, -1.25); body.lineTo(-0.63, 0.2); body.closePath();
    const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(body, { depth: 0.25, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 1, steps: 1 }), this.material(0xd8e9d8, 0.3, 0.68));
    hull.rotation.x = -Math.PI / 2; this.ship.add(hull);
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), this.material(0x08282f, 0.08, 0.9));
    cockpit.scale.set(0.65, 0.6, 1.8); cockpit.position.set(0, 0.33, -0.2); this.ship.add(cockpit);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 1.4), this.glow(MINT, 1.8));
    spine.position.set(0, 0.43, 0.15); this.ship.add(spine);
    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 1.3), this.material(0x253e40, 0.3, 0.85));
      pod.position.set(side * 1, 0.06, 0.66); pod.rotation.y = side * -0.35; this.ship.add(pod);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 1.05), this.glow(MINT, 1.3));
      stripe.position.set(side * 1, 0.23, 0.62); stripe.rotation.y = side * -0.35; this.ship.add(stripe);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 12), this.glow(CYAN, 2));
      nozzle.rotation.x = Math.PI / 2; nozzle.position.set(side * 0.85, 0.04, 1.22); this.ship.add(nozzle);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.7, 12), new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.rotation.x = Math.PI / 2; flame.position.set(side * 0.85, 0.04, 2); this.ship.add(flame); this.engines.push(flame);
    }
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32), new THREE.MeshBasicMaterial({ color: 0x010a0d, transparent: true, opacity: 0.35, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.scale.y = 1.7; shadow.position.y = -0.72; this.ship.add(shadow);
    this.ship.position.set(0, 0.65, 5);
  }

  private makeObstacle() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.25, 1.35, 1.6), this.material(0x6d453e, 0.5, 0.55));
    body.position.y = 0.4; group.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.74), this.material(0xa67154, 0.4, 0.6));
    top.position.y = 1.12; group.add(top);
    const warning = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.095, 0.03), this.glow(0xff9368, 1.5));
    warning.position.set(0, 0.79, 0.815); group.add(warning);
    for (const x of [-0.7, 0, 0.7]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.43, 0.035), this.glow(0xffb580, 0.7));
      bar.position.set(x, 0.35, 0.82); bar.rotation.z = -0.55; group.add(bar);
    }
    return group;
  }
  private makeCrystal() {
    const group = new THREE.Group();
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.48), this.glow(MINT, 1));
    gem.position.y = 1; group.add(gem);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.018, 6, 24), this.glow(CYAN, 0.8));
    ring.position.y = 1; group.add(ring);
    return group;
  }

  private resize() {
    this.width = this.host.clientWidth; this.height = this.host.clientHeight;
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / Math.max(1, this.height);
    this.camera.updateProjectionMatrix();
  }

  burst(x: number, hit = false) {
    this.sparkLife = 0.7;
    (this.sparks.material as THREE.PointsMaterial).color.setHex(hit ? 0xffa47b : MINT);
    for (let i = 0; i < 90; i++) {
      this.sparkPositions.set([x, 1, 5], i * 3);
      this.sparkVelocities.set([(Math.random() - 0.5) * 12, Math.random() * 7, (Math.random() - 0.5) * 15], i * 3);
    }
  }

  render(state: GameState, dt: number) {
    const menu = state.phase === 'menu';
    const moving = state.phase === 'playing' || menu;
    if (moving) this.clock += dt;
    this.menuBlend = THREE.MathUtils.damp(this.menuBlend, menu ? 1 : 0, 4, dt);
    if (state.phase === 'playing') this.scroll = state.distance;
    else if (menu && !this.reducedMotion) this.scroll += dt * 4;
    const blend = this.menuBlend;
    const mobile = this.width < 700;
    this.camera.position.set(8.5 * blend + state.playerX * 0.19 * (1 - blend), 5 + 3 * blend, 15 + 4 * blend);
    this.camera.lookAt(state.playerX * 0.2 * (1 - blend), 0.8, -17);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, state.boosting ? 65 : 56, 3, dt);
    this.camera.setViewOffset(this.width, this.height, mobile ? 0 : -this.width * 0.19 * blend, mobile ? this.height * 0.12 * blend : 0, this.width, this.height);
    this.camera.updateProjectionMatrix();
    this.ship.position.x = menu ? 0 : state.playerX;
    this.ship.position.y = 0.7 + (this.reducedMotion ? 0 : Math.sin(this.clock * 3.5) * 0.045);
    const roll = moving && !menu ? (this.lastPlayerX - state.playerX) * 1.4 : -0.055;
    this.ship.rotation.z = THREE.MathUtils.damp(this.ship.rotation.z, roll, 9, dt);
    this.lastPlayerX = state.playerX;
    this.ship.rotation.y = menu ? -0.05 : -this.ship.rotation.z * 0.25;
    this.engines.forEach((flame) => { flame.scale.y = (state.boosting ? 2 : 0.7) + Math.sin(this.clock * 30) * 0.1; });
    for (let i = 0; i < 120; i++) {
      this.dummy.position.set(i % 2 === 0 ? -1.6 : 1.6, -0.31, 20 - (Math.floor(i / 2) * 6 - this.scroll % 6));
      this.dummy.rotation.set(0, 0, 0); this.dummy.scale.set(1, 1, 1); this.dummy.updateMatrix();
      this.laneMarks.setMatrixAt(i, this.dummy.matrix);
    }
    this.laneMarks.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 100; i++) {
      const side = i % 2 ? 1 : -1;
      const height = 5 + ((i * 37) % 28);
      this.dummy.position.set(side * (13 + ((i * 13) % 55)), height / 2 - 22, 30 - ((i * 13.3 - this.scroll * 0.55) % 355 + 355) % 355);
      this.dummy.scale.set(2 + i % 5, height, 3 + i % 4); this.dummy.rotation.set(0, (i % 5) * 0.13, side * 0.08); this.dummy.updateMatrix();
      this.scenery.setMatrixAt(i, this.dummy.matrix);
    }
    this.scenery.instanceMatrix.needsUpdate = true;
    this.gates.forEach((gate, i) => { gate.position.z = 25 - ((i * 48 + 35 - this.scroll) % 336 + 336) % 336; });
    this.preview.visible = menu;
    this.preview.children.forEach((object, i) => { if (i % 3 !== 0) object.rotation.y = this.clock; });
    this.obstaclePool.forEach((object) => { object.visible = false; });
    this.crystalPool.forEach((object) => { object.visible = false; });
    let barrierIndex = 0, crystalIndex = 0;
    if (!menu) for (const entity of state.entities) {
      if (entity.hit) continue;
      const object = entity.kind === 'barrier' ? this.obstaclePool[barrierIndex++] : this.crystalPool[crystalIndex++];
      if (!object) continue;
      object.visible = true; object.position.set(entity.lane * 3.2, 0, entity.z);
      if (entity.kind === 'crystal') object.rotation.y = this.clock * 1.6;
    }
    if (this.sparkLife > 0 && moving) {
      this.sparkLife -= dt;
      for (let i = 0; i < 270; i++) this.sparkPositions[i] += this.sparkVelocities[i] * dt;
      this.sparks.geometry.attributes.position.needsUpdate = true;
    }
    (this.sparks.material as THREE.PointsMaterial).opacity = Math.max(0, this.sparkLife);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.observer.disconnect();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach((material) => materials.add(material));
      }
    });
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
