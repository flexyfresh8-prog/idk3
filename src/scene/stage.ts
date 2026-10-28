// Three.js stage: renderer, camera, orbit controls, lighting, environment,
// ground shadow, studio backdrop. Keeps the model's original proportions
// untouched. v2: theme-matched rims (cyan/violet), gradient backdrop dome,
// display platform + polar grid, depth fog.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly keyLight: THREE.DirectionalLight;
  private ground: THREE.Mesh;
  private defaultCamPos = new THREE.Vector3();
  private defaultTarget = new THREE.Vector3();
  private camAnim: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null = null;

  readonly lite: boolean;

  constructor(container: HTMLElement, modelCenter: THREE.Vector3, modelRadius: number) {
    // Lite mode: software rasterizers (SwiftShader headless), automation and
    // weak iGPUs get a cheaper pipeline (no shadows/PMREM, pixelRatio 1).
    const forced = new URLSearchParams(location.search).get('lite') === '1';
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    const rendererInfo = gl ? (gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? '') : '';
    const software = /swiftshader|llvmpipe|software|basic render/i.test(String(rendererInfo));
    const lite = forced || software;
    this.lite = lite;

    this.renderer = new THREE.WebGLRenderer({ antialias: !lite, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(lite ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !lite;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'gl-canvas';

    this.scene.background = new THREE.Color('#07090d');
    this.scene.fog = new THREE.Fog('#07090d', modelRadius * 5, modelRadius * 14);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 60);
    this.defaultTarget.copy(modelCenter);
    this.defaultCamPos.set(
      modelCenter.x + modelRadius * 1.35,
      modelCenter.y + modelRadius * 0.95,
      modelCenter.z - modelRadius * 1.9
    );
    this.camera.position.copy(this.defaultCamPos);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.defaultTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = modelRadius * 0.35;
    this.controls.maxDistance = modelRadius * 8;
    this.controls.maxPolarAngle = Math.PI * 0.96;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.85;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    // environment reflections (subtle, professional studio feel) — skipped in
    // lite mode: PMREM generation is expensive and pointless for software GL
    if (!lite) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.55;
      this.addBackdrop(modelCenter, modelRadius);
    }

    // key light — warm white, throws the main shadow
    const key = new THREE.DirectionalLight('#fff2df', 2.7);
    key.position.set(modelRadius * 1.6, modelRadius * 2.2, modelRadius * -2.4);
    key.castShadow = !lite;
    key.shadow.mapSize.set(1024, 1024);
    const d = modelRadius * 1.4;
    key.shadow.camera.left = -d; key.shadow.camera.right = d;
    key.shadow.camera.top = d; key.shadow.camera.bottom = -d;
    key.shadow.camera.near = 0.05; key.shadow.camera.far = modelRadius * 8;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    this.scene.add(key);
    this.keyLight = key;

    // theme rims — cool cyan from behind-left, violet from behind-right
    const rim = new THREE.DirectionalLight('#4dd8ff', 1.35);
    rim.position.set(modelRadius * -2.2, modelRadius * 1.1, modelRadius * 2.0);
    this.scene.add(rim);

    const rim2 = new THREE.DirectionalLight('#8f7bff', 0.85);
    rim2.position.set(modelRadius * 2.1, modelRadius * -0.4, modelRadius * 1.8);
    this.scene.add(rim2);

    const amb = new THREE.HemisphereLight('#39414d', '#0c0e12', 0.85);
    this.scene.add(amb);

    // display platform + faint polar grid under the driver
    const groundY = modelCenter.y - modelRadius * 0.92;
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(modelRadius * 1.55, modelRadius * 1.7, modelRadius * 0.07, 72),
      new THREE.MeshStandardMaterial({ color: '#0e1116', roughness: 0.4, metalness: 0.65 })
    );
    platform.position.set(modelCenter.x, groundY - modelRadius * 0.035, modelCenter.z);
    platform.receiveShadow = !lite;
    this.scene.add(platform);

    const grid = new THREE.PolarGridHelper(
      modelRadius * 2.6, 16, 6, 64, 0x1d2b38, 0x141c26
    );
    grid.position.set(modelCenter.x, groundY - modelRadius * 0.068, modelCenter.z);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(grid);

    const groundGeo = new THREE.CircleGeometry(modelRadius * 4, 48);
    groundGeo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(groundGeo, new THREE.ShadowMaterial({ opacity: 0.4 }));
    this.ground.position.set(modelCenter.x, groundY - modelRadius * 0.069, modelCenter.z);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  /** Giant inverted sphere with a vertical gradient — the studio cyclorama. */
  private addBackdrop(center: THREE.Vector3, radius: number): void {
    const geo = new THREE.SphereGeometry(radius * 12, 32, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#101823') },
        mid: { value: new THREE.Color('#0a0e15') },
        bot: { value: new THREE.Color('#05070a') }
      },
      vertexShader: /* glsl */`
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vPos;
        uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
        void main() {
          float h = normalize(vPos).y;
          vec3 col = h > 0.0 ? mix(mid, top, pow(h, 0.75)) : mix(mid, bot, pow(-h, 0.75));
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    const dome = new THREE.Mesh(geo, mat);
    dome.position.copy(center);
    this.scene.add(dome);
  }

  resize(): void {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const w = parent.clientWidth, h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  resetCamera(): void {
    this.camAnim = {
      from: this.camera.position.clone(), to: this.defaultCamPos.clone(),
      tFrom: this.controls.target.clone(), tTo: this.defaultTarget.clone(),
      t: 0
    };
  }

  tick(dt: number): void {
    if (this.camAnim) {
      this.camAnim.t = Math.min(1, this.camAnim.t + dt * 2.2);
      const e = 1 - Math.pow(1 - this.camAnim.t, 3);
      this.camera.position.lerpVectors(this.camAnim.from, this.camAnim.to, e);
      this.controls.target.lerpVectors(this.camAnim.tFrom, this.camAnim.tTo, e);
      if (this.camAnim.t >= 1) this.camAnim = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
