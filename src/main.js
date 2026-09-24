import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import './style.css';

const canvas = document.querySelector('#scene-canvas');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x72847f, 0.0035);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 500);
camera.position.set(38, 18, 48);
camera.lookAt(0, 5, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 5, 0);
orbit.maxPolarAngle = Math.PI * 0.47;
orbit.minDistance = 10;
orbit.maxDistance = 90;
orbit.enabled = true;

const pointer = new PointerLockControls(camera, renderer.domElement);
pointer.pointerSpeed = 0.6;
let roamMode = false;
let timeOfDay = 12;
let terrainScale = 1;
let waterSpeed = 1;
let weatherType = 'clear';
let particleTarget = 620;
let elapsed = 0;
const clock = new THREE.Clock();
const keys = {};
const objects = [];

const world = new THREE.Group();
scene.add(world);
const terrainGroup = new THREE.Group();
const sceneryGroup = new THREE.Group();
const debugGroup = new THREE.Group();
const pathGroup = new THREE.Group();
world.add(terrainGroup, sceneryGroup, debugGroup, pathGroup);

const colors = {
  ink: 0x17302b,
  moss: 0x5c806b,
  paleMoss: 0x9db39c,
  earth: 0x8e775d,
  water: 0x2b6870,
  sun: 0xffd9a0,
};

function terrainHeight(x, z) {
  const broad = Math.sin(x * 0.055 + 0.7) * 3.8 + Math.cos(z * 0.072) * 3.2;
  const ridge = Math.sin((x + z) * 0.115) * 1.4 + Math.cos((x - z) * 0.16) * 0.9;
  const detail = Math.sin(x * 0.31) * Math.cos(z * 0.23) * 0.36;
  const lakeBasin = Math.max(0, 1 - Math.hypot(x + 1, z + 7) / 21);
  return (broad + ridge + detail - lakeBasin * 7) * terrainScale + 3.5;
}

function createTerrain() {
  const size = 150;
  const segments = 70;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const position = geo.attributes.position;
  const colorsAttr = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = terrainHeight(x, z);
    position.setY(i, y);
    const h = THREE.MathUtils.clamp((y - 1) / 18, 0, 1);
    const c = new THREE.Color().setHSL(0.29 - h * 0.11, 0.24 + h * 0.24, 0.27 + h * 0.18);
    colorsAttr.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colorsAttr, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'procedural-terrain';
  terrainGroup.add(mesh);

  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0xd6f2d5, transparent: true, opacity: 0.26 }));
  wire.visible = false;
  wire.name = 'terrain-wireframe';
  debugGroup.add(wire);
  return { mesh, wire };
}

const terrain = createTerrain();

function addBox(name, position, size, material, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = true;
  mesh.name = name;
  sceneryGroup.add(mesh);
  objects.push(mesh);
  return mesh;
}

function createLake() {
  const waterGeo = new THREE.PlaneGeometry(39, 28, 55, 40);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: { value: 0 }, uSpeed: { value: 1 }, uColor: { value: new THREE.Color(0x28646b) }, uDeep: { value: new THREE.Color(0x112f3b) } },
    vertexShader: `uniform float uTime; uniform float uSpeed; varying vec2 vUv; varying float vWave; void main(){ vUv=uv; vec3 p=position; float wave=sin(p.x*0.7+uTime*uSpeed)*0.12+cos(p.z*0.55+uTime*uSpeed*0.8)*0.09; p.y+=wave; vWave=wave; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uDeep; varying vec2 vUv; varying float vWave; void main(){ float shore=smoothstep(0.0,0.65,vUv.y)*0.1; vec3 col=mix(uDeep,uColor,vUv.y+shore); float glint=smoothstep(0.075,0.12,vWave+0.07); col+=vec3(0.32,0.48,0.39)*glint; gl_FragColor=vec4(col,0.85); }`,
  });
  const lake = new THREE.Mesh(waterGeo, waterMat);
  lake.position.set(-1, 1.15, -7);
  lake.name = 'dynamic-lake';
  lake.receiveShadow = true;
  terrainGroup.add(lake);
  return lake;
}

const lake = createLake();

function createTree(x, z, scale = 1, hue = 0.31) {
  const group = new THREE.Group();
  group.position.set(x, terrainHeight(x, z), z);
  group.scale.setScalar(scale);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 3.4, 7), new THREE.MeshStandardMaterial({ color: 0x72543d, roughness: 1 }));
  trunk.position.y = 1.7;
  trunk.castShadow = true;
  group.add(trunk);
  const crownMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.34, 0.27 + Math.random() * 0.1), roughness: 0.9, flatShading: true });
  const crown = new THREE.Mesh(new THREE.ConeGeometry(2.15, 4.4, 8), crownMat);
  crown.position.y = 4.15;
  crown.castShadow = true;
  group.add(crown);
  const crown2 = new THREE.Mesh(new THREE.ConeGeometry(1.55, 3.2, 8), crownMat);
  crown2.position.y = 6.2;
  crown2.castShadow = true;
  group.add(crown2);
  sceneryGroup.add(group);
  objects.push(group);
}

function seedTrees() {
  const spots = [
    [-47, -37, 1.5], [-39, -20, 1.2], [-45, 4, 1.4], [-35, 26, 1.3], [-24, 35, 1.5],
    [25, -38, 1.5], [39, -23, 1.3], [46, -4, 1.6], [38, 19, 1.3], [28, 37, 1.5],
    [-12, 37, 1.1], [13, 39, 1.2], [-49, 27, 1.2], [48, 34, 1.15], [32, -3, 1.0],
  ];
  spots.forEach(([x, z, s], i) => createTree(x, z, s, 0.28 + (i % 3) * 0.02));
}
seedTrees();

const woodMat = new THREE.MeshStandardMaterial({ color: 0x967052, roughness: 0.82 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x263d37, roughness: 0.88 });
const creamMat = new THREE.MeshStandardMaterial({ color: 0xd8c5a0, roughness: 0.8 });
addBox('cabin-body', [17, terrainHeight(17, 13) + 2.3, 13], [7, 4.6, 5.8], woodMat);
const cabinRoof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 2.5, 4), roofMat);
cabinRoof.rotation.y = Math.PI / 4;
cabinRoof.position.set(17, terrainHeight(17, 13) + 5.8, 13);
cabinRoof.scale.z = 0.58;
cabinRoof.castShadow = true;
sceneryGroup.add(cabinRoof);
addBox('cabin-window', [14.45, terrainHeight(14, 13) + 2.6, 10.03], [1.2, 1.25, 0.12], creamMat, { castShadow: false });
addBox('cabin-window', [19.55, terrainHeight(20, 13) + 2.6, 10.03], [1.2, 1.25, 0.12], creamMat, { castShadow: false });

function createPath() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-22, 2.2, 30), new THREE.Vector3(-10, 1.6, 20), new THREE.Vector3(-4, 1.3, 8), new THREE.Vector3(-12, 1.4, -2), new THREE.Vector3(-1, 1.4, -20),
  ]);
  const points = curve.getPoints(90);
  const pathGeo = new THREE.BufferGeometry().setFromPoints(points);
  const path = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({ color: 0xe4b575, transparent: true, opacity: 0.82 }));
  path.name = 'bezier-observation-path';
  pathGroup.add(path);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffcf86 }));
  marker.name = 'path-marker';
  pathGroup.add(marker);
  return { curve, marker };
}
const path = createPath();

const collisionBoxes = [];
function addCollisionBox(pos, size) {
  const box = new THREE.Box3(new THREE.Vector3(pos[0] - size[0] / 2, pos[1] - size[1] / 2, pos[2] - size[2] / 2), new THREE.Vector3(pos[0] + size[0] / 2, pos[1] + size[1] / 2, pos[2] + size[2] / 2));
  collisionBoxes.push(box);
  const helper = new THREE.Box3Helper(box, 0xffb26d);
  helper.visible = false;
  debugGroup.add(helper);
}
addCollisionBox([17, terrainHeight(17, 13) + 2.4, 13], [7.2, 5, 6]);

const ambient = new THREE.HemisphereLight(0xc9dfdb, 0x334239, 1.25);
scene.add(ambient);
const sun = new THREE.DirectionalLight(colors.sun, 3.2);
sun.position.set(-30, 42, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70; sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
scene.add(sun);
const moon = new THREE.DirectionalLight(0x85a9d1, 0);
moon.position.set(20, 30, -30);
scene.add(moon);

const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 24, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: { uTop: { value: new THREE.Color(0x91b6b0) }, uBottom: { value: new THREE.Color(0xf0cf9f) } }, vertexShader: 'varying vec3 vP; void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', fragmentShader: 'uniform vec3 uTop; uniform vec3 uBottom; varying vec3 vP; void main(){float h=normalize(vP).y*0.5+0.5; gl_FragColor=vec4(mix(uBottom,uTop,smoothstep(0.15,0.8,h)),1.0);}' }));
scene.add(sky);

const particleGeo = new THREE.BufferGeometry();
const maxParticles = 1200;
const particlePositions = new Float32Array(maxParticles * 3);
const particleVelocities = new Float32Array(maxParticles * 3);
for (let i = 0; i < maxParticles; i++) resetParticle(i, true);
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
const particleMat = new THREE.PointsMaterial({ color: 0xe6f4ec, size: 0.16, transparent: true, opacity: 0.68, depthWrite: false, blending: THREE.AdditiveBlending });
const particles = new THREE.Points(particleGeo, particleMat);
particles.frustumCulled = false;
scene.add(particles);

function resetParticle(i, initial = false) {
  const idx = i * 3;
  particlePositions[idx] = (Math.random() - 0.5) * 100;
  particlePositions[idx + 1] = initial ? Math.random() * 34 + 2 : 31 + Math.random() * 4;
  particlePositions[idx + 2] = (Math.random() - 0.5) * 90 - 4;
  particleVelocities[idx] = (Math.random() - 0.5) * 0.06;
  particleVelocities[idx + 1] = -(0.07 + Math.random() * 0.13);
  particleVelocities[idx + 2] = (Math.random() - 0.5) * 0.04;
}

function updateParticles(dt) {
  const active = weatherType === 'clear' ? 0 : Math.round(particleTarget);
  particles.visible = active > 0;
  particleMat.color.set(weatherType === 'snow' ? 0xe9f3f1 : 0xaed3df);
  particleMat.size = weatherType === 'snow' ? 0.28 : 0.1;
  particleMat.opacity = weatherType === 'snow' ? 0.88 : 0.58;
  for (let i = 0; i < maxParticles; i++) {
    const idx = i * 3;
    if (i >= active) { particlePositions[idx + 1] = -100; continue; }
    particlePositions[idx] += particleVelocities[idx] + (weatherType === 'snow' ? Math.sin(elapsed * 0.9 + i) * 0.012 : 0);
    particlePositions[idx + 1] += particleVelocities[idx + 1] * (weatherType === 'snow' ? 0.45 : 1.15) * dt * 60;
    particlePositions[idx + 2] += particleVelocities[idx + 2];
    if (particlePositions[idx + 1] < 1) resetParticle(i);
  }
  particleGeo.attributes.position.needsUpdate = true;
}

function updateEnvironment() {
  const daylight = Math.max(0, Math.sin(((timeOfDay - 6) / 12) * Math.PI));
  const sunset = Math.max(0, 1 - Math.abs(timeOfDay - 17) / 3);
  sun.intensity = 0.28 + daylight * 3.5;
  sun.color.setHSL(0.08 + daylight * 0.03, 0.66, 0.65 + sunset * 0.12);
  sun.position.set(Math.cos((timeOfDay / 24) * Math.PI * 2) * 45, 10 + daylight * 42, Math.sin((timeOfDay / 24) * Math.PI * 2) * 45);
  moon.intensity = daylight < 0.12 ? 0.7 : 0;
  ambient.intensity = 0.38 + daylight * 0.9;
  const skyMat = sky.material;
  skyMat.uniforms.uTop.value.set(daylight < 0.15 ? 0x172b43 : sunset > 0.55 ? 0xa05b58 : 0x91b6b0);
  skyMat.uniforms.uBottom.value.set(daylight < 0.15 ? 0x111b2b : sunset > 0.55 ? 0xf0a56e : 0xf0cf9f);
  scene.fog.color.set(daylight < 0.15 ? 0x1a2931 : sunset > 0.55 ? 0x916d66 : 0x72847f);
  scene.fog.density = weatherType === 'rain' ? 0.005 : weatherType === 'snow' ? 0.006 : daylight < 0.15 ? 0.0048 : 0.0035;
}

function updatePath() {
  pathGroup.visible = document.querySelector('#path-toggle').checked;
  const t = (Math.sin(elapsed * 0.22) + 1) / 2;
  path.marker.position.copy(path.curve.getPoint(t));
  path.marker.position.y += 0.7;
}

function updateRoaming(dt) {
  if (!roamMode) return;
  const direction = new THREE.Vector3(Number(keys.KeyD) - Number(keys.KeyA), 0, Number(keys.KeyS) - Number(keys.KeyW));
  if (!direction.lengthSq()) return;
  direction.normalize().applyQuaternion(camera.quaternion);
  direction.y = 0;
  const speed = keys.ShiftLeft || keys.ShiftRight ? 0.46 : 0.22;
  const next = camera.position.clone().addScaledVector(direction, speed * dt * 60);
  next.y = terrainHeight(next.x, next.z) + 7.2;
  const hit = collisionBoxes.some((box) => box.distanceToPoint(next) < 2.6);
  if (!hit && Math.abs(next.x) < 68 && Math.abs(next.z) < 65) camera.position.copy(next);
}

function setToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(setToast.timer);
  setToast.timer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

function formatHour(value) {
  const h = Math.floor(value) % 24;
  const m = Math.round((value - Math.floor(value)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function bindUI() {
  const timeSlider = document.querySelector('#time-slider');
  timeSlider.addEventListener('input', () => { timeOfDay = Number(timeSlider.value); const text = formatHour(timeOfDay); document.querySelector('#time-value').textContent = text; document.querySelector('#clock-readout').textContent = text; });
  document.querySelector('#terrain-slider').addEventListener('input', (e) => { terrainScale = Number(e.target.value); document.querySelector('#terrain-value').textContent = terrainScale.toFixed(2); rebuildTerrain(); });
  document.querySelector('#water-slider').addEventListener('input', (e) => { waterSpeed = Number(e.target.value); lake.material.uniforms.uSpeed.value = waterSpeed; document.querySelector('#water-value').textContent = waterSpeed.toFixed(2); });
  document.querySelector('#particle-slider').addEventListener('input', (e) => { particleTarget = Number(e.target.value); document.querySelector('#particle-value').textContent = particleTarget; });
  document.querySelectorAll('[data-weather]').forEach((button) => button.addEventListener('click', () => { weatherType = button.dataset.weather; document.querySelectorAll('[data-weather]').forEach((b) => b.classList.toggle('active', b === button)); setToast(`天气已切换为${button.textContent}`); }));
  document.querySelector('#wireframe-toggle').addEventListener('change', (e) => terrain.wire.visible = e.target.checked);
  document.querySelector('#path-toggle').addEventListener('change', updatePath);
  document.querySelector('#collision-toggle').addEventListener('change', (e) => debugGroup.children.filter((child) => child.type === 'Box3Helper').forEach((helper) => helper.visible = e.target.checked));
  document.querySelector('#reset-camera').addEventListener('click', () => { camera.position.set(38, 18, 48); orbit.target.set(0, 5, 0); orbit.update(); setToast('已回到湖畔观景台'); });
  document.querySelector('#camera-mode').addEventListener('click', toggleCameraMode);
  document.querySelector('#panel-toggle').addEventListener('click', () => { document.querySelector('.control-panel').classList.toggle('collapsed'); document.querySelector('#panel-toggle').textContent = document.querySelector('.control-panel').classList.contains('collapsed') ? '+' : '−'; });
  window.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'KeyF') toggleCameraMode(); });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  renderer.domElement.addEventListener('click', () => { if (roamMode && !pointer.isLocked) pointer.lock(); });
}

function toggleCameraMode() {
  roamMode = !roamMode;
  orbit.enabled = !roamMode;
  document.querySelector('#camera-mode-label').textContent = roamMode ? '观察模式' : '漫游模式';
  document.querySelector('#mode-readout').textContent = roamMode ? '自由' : '漫游';
  if (!roamMode && pointer.isLocked) pointer.unlock();
  setToast(roamMode ? '已进入第一人称漫游，点击画面锁定鼠标' : '已回到轨道观察模式');
}

function rebuildTerrain() {
  const old = terrainGroup.getObjectByName('procedural-terrain');
  const oldWire = debugGroup.getObjectByName('terrain-wireframe');
  const fresh = createTerrain();
  const freshGeometry = fresh.mesh.geometry;
  const freshWireGeometry = fresh.wire.geometry;
  terrainGroup.remove(fresh.mesh);
  debugGroup.remove(fresh.wire);
  old.geometry.dispose();
  old.geometry = freshGeometry;
  oldWire.geometry.dispose();
  oldWire.geometry = freshWireGeometry;
}

bindUI();
updateEnvironment();
document.querySelector('#object-readout').textContent = String(objects.length + 1);
setTimeout(() => document.querySelector('#loading-screen').classList.add('hidden'), 650);

let frameSamples = [];
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  updateEnvironment();
  lake.material.uniforms.uTime.value = elapsed;
  updateParticles(dt);
  updatePath();
  updateRoaming(dt);
  orbit.update();
  renderer.render(scene, camera);
  frameSamples.push(1 / Math.max(dt, 0.001));
  if (frameSamples.length > 30) frameSamples.shift();
  document.querySelector('#fps-readout').textContent = Math.round(frameSamples.reduce((a, b) => a + b, 0) / frameSamples.length);
}
animate();

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
