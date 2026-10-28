// Three.js stage: renderer, camera, orbit controls, lighting, environment,
// ground shadow. Keeps the model's original proportions untouched.
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

  constructor(container: HTMLElement, modelCenter: THREE.Vector3, modelRadius: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'gl-canvas';

    this.scene.background = new THREE.Color('#0b0d10');

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 40);
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

    // environment reflections (subtle, professional studio feel)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;

    const key = new THREE.DirectionalLight('#fff4e0', 2.6);
    key.position.set(modelRadius * 1.6, modelRadius * 2.2, modelRadius * -2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const d = modelRadius * 1.4;
    key.shadow.camera.left = -d; key.shadow.camera.right = d;
    key.shadow.camera.top = d; key.shadow.camera.bottom = -d;
    key.shadow.camera.near = 0.05; key.shadow.camera.far = modelRadius * 8;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    this.scene.add(key);
    this.keyLight = key;

    const rim = new THREE.DirectionalLight('#7fb4ff', 1.1);
    rim.position.set(modelRadius * -2.2, modelRadius * 1.1, modelRadius * 2.0);
    this.scene.add(rim);

    const amb = new THREE.AmbientLight('#3a3f46', 0.7);
    this.scene.add(amb);

    const groundY = modelCenter.y - modelRadius * 0.92;
    const groundGeo = new THREE.CircleGeometry(modelRadius * 4, 48);
    groundGeo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(groundGeo, new THREE.ShadowMaterial({ opacity: 0.34 }));
    this.ground.position.set(modelCenter.x, groundY, modelCenter.z);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
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
