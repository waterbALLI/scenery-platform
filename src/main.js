import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { StreamingWorld } from './world/world.js';
import './style.css';

const canvas = document.querySelector('#scene-canvas');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x72847f, 0.0026);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 800);
camera.position.set(38, 24, 48);
camera.lookAt(0, 6, 0);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 5, 0);
orbit.minDistance = 10;
orbit.maxDistance = 180;
orbit.maxPolarAngle = Math.PI * 0.47;
const pointer = new PointerLockControls(camera, renderer.domElement);
pointer.pointerSpeed = 0.6;

const world = new StreamingWorld(scene);
let terrainScale = 1;
let terrainAlgorithm = 'waves';
let terrainSegments = 64;
let timeOfDay = 12;
let waterSpeed = 1;
let weatherType = 'clear';
let particleTarget = 620;
let roamMode = false;
let overviewMode = false;
let elapsed = 0;
const clock = new THREE.Clock();
const keys = {};

const ambient = new THREE.HemisphereLight(0xc9dfdb, 0x334239, 1.1);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffd9a0, 3.5);
sun.position.set(-50, 80, 35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -160; sun.shadow.camera.right = 160; sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
scene.add(sun);
const moon = new THREE.DirectionalLight(0x85a9d1, 0);
moon.position.set(30, 60, -40);
scene.add(moon);

const sky = new THREE.Mesh(new THREE.SphereGeometry(360, 32, 20), new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: { uTop: { value: new THREE.Color(0x91b6b0) }, uBottom: { value: new THREE.Color(0xf0cf9f) } },
  vertexShader: 'varying vec3 vP; void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: 'uniform vec3 uTop; uniform vec3 uBottom; varying vec3 vP; void main(){float h=normalize(vP).y*0.5+0.5; gl_FragColor=vec4(mix(uBottom,uTop,smoothstep(0.12,0.82,h)),1.0);}',
}));
scene.add(sky);

const particles = createParticles();
scene.add(particles.points);
const pathGroup = new THREE.Group();
const pathCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-75, 2, 72), new THREE.Vector3(-35, 2, 38), new THREE.Vector3(-8, 2, 8), new THREE.Vector3(18, 2, -20), new THREE.Vector3(62, 2, -60),
]);
const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe4b575, transparent: true, opacity: 0.8 }));
const pathMarker = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffcf86 }));
pathGroup.add(pathLine, pathMarker);
scene.add(pathGroup);

function createParticles() {
  const count = 1400;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) resetParticle(i, positions, velocities, true);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xaed3df, size: 0.1, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, geometry, material, positions, velocities, count };
}

function resetParticle(i, positions, velocities, initial = false) {
  const k = i * 3;
  positions[k] = (Math.random() - 0.5) * 120;
  positions[k + 1] = initial ? Math.random() * 42 : 34 + Math.random() * 8;
  positions[k + 2] = (Math.random() - 0.5) * 120;
  velocities[k] = (Math.random() - 0.5) * 0.06;
  velocities[k + 1] = -(0.07 + Math.random() * 0.13);
  velocities[k + 2] = (Math.random() - 0.5) * 0.04;
}

function updateParticles(dt) {
  const active = weatherType === 'clear' ? 0 : Math.min(particles.count, Math.round(particleTarget));
  particles.points.visible = active > 0;
  particles.points.position.set(camera.position.x, 0, camera.position.z);
  particles.material.color.set(weatherType === 'snow' ? 0xe9f3f1 : 0xaed3df);
  particles.material.size = weatherType === 'snow' ? 0.28 : 0.1;
  particles.material.opacity = weatherType === 'snow' ? 0.88 : 0.58;
  for (let i = 0; i < particles.count; i++) {
    const k = i * 3;
    if (i >= active) { particles.positions[k + 1] = -100; continue; }
    particles.positions[k] += particles.velocities[k] + (weatherType === 'snow' ? Math.sin(elapsed * .9 + i) * .012 : 0);
    particles.positions[k + 1] += particles.velocities[k + 1] * (weatherType === 'snow' ? .45 : 1.15) * dt * 60;
    particles.positions[k + 2] += particles.velocities[k + 2];
    if (particles.positions[k + 1] < 1) resetParticle(i, particles.positions, particles.velocities);
  }
  particles.geometry.attributes.position.needsUpdate = true;
}

function formatHour(value) {
  const h = Math.floor(value) % 24;
  const m = Math.round((value - Math.floor(value)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function updateEnvironment() {
  const daylight = Math.max(0, Math.sin(((timeOfDay - 6) / 12) * Math.PI));
  const sunset = Math.max(0, 1 - Math.abs(timeOfDay - 17) / 3);
  sun.intensity = .25 + daylight * 3.7;
  sun.position.set(Math.cos(timeOfDay / 24 * Math.PI * 2) * 70, 18 + daylight * 72, Math.sin(timeOfDay / 24 * Math.PI * 2) * 70);
  sun.color.setHSL(.08 + daylight * .03, .66, .65 + sunset * .12);
  moon.intensity = daylight < .12 ? .72 : 0;
  ambient.intensity = .38 + daylight * .9;
  sky.material.uniforms.uTop.value.set(daylight < .15 ? 0x172b43 : sunset > .55 ? 0xa05b58 : 0x91b6b0);
  sky.material.uniforms.uBottom.value.set(daylight < .15 ? 0x111b2b : sunset > .55 ? 0xf0a56e : 0xf0cf9f);
  scene.fog.color.set(daylight < .15 ? 0x1a2931 : sunset > .55 ? 0x916d66 : 0x72847f);
  scene.fog.density = weatherType === 'rain' ? .0045 : weatherType === 'snow' ? .0055 : daylight < .15 ? .004 : .0026;
  world.waterMat.uniforms.uLight.value = .28 + daylight * .72;
}

function updatePath() {
  pathGroup.visible = document.querySelector('#path-toggle').checked;
  pathCurve.points.forEach((point) => { const h = world.height(point.x, point.z); point.y = h === null ? 1.8 : h + .25; });
  pathLine.geometry.dispose();
  pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pathCurve.getPoints(100));
  pathMarker.position.copy(pathCurve.getPoint((Math.sin(elapsed * .18) + 1) / 2));
  pathMarker.position.y += .7;
}

function updateRoaming(dt) {
  if (!roamMode || overviewMode) return;
  const direction = new THREE.Vector3(Number(keys.KeyD) - Number(keys.KeyA), 0, Number(keys.KeyS) - Number(keys.KeyW));
  if (!direction.lengthSq()) return;
  direction.normalize().applyQuaternion(camera.quaternion); direction.y = 0;
  const speed = keys.ShiftLeft || keys.ShiftRight ? .48 : .23;
  const next = camera.position.clone().addScaledVector(direction, speed * dt * 60);
  const ground = world.height(next.x, next.z);
  if (ground !== null) next.y = ground + 7.2;
  if (world.canWalk(next.x, next.z)) camera.position.copy(next);
}

function toast(message) {
  const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 2400);
}

function setOverviewCamera() {
  overviewMode = true; roamMode = false; orbit.enabled = true;
  if (pointer.isLocked) pointer.unlock();
  camera.position.set(0, 132, 150); orbit.target.set(0, 0, 0); orbit.update();
  document.querySelector('#mode-readout').textContent = '俯视';
  toast('已切换至高空倾角俯视视角，周围地形将持续加载');
}

function toggleCameraMode() {
  overviewMode = false; roamMode = !roamMode; orbit.enabled = !roamMode;
  document.querySelector('#camera-mode-label').textContent = roamMode ? '观察模式' : '漫游模式';
  document.querySelector('#mode-readout').textContent = roamMode ? '自由' : '漫游';
  if (!roamMode && pointer.isLocked) pointer.unlock();
  toast(roamMode ? '已进入第一人称漫游，点击画面锁定鼠标' : '已回到轨道观察模式');
}

function bindUI() {
  document.querySelector('#time-slider').addEventListener('input', (e) => { timeOfDay = Number(e.target.value); const value = formatHour(timeOfDay); document.querySelector('#time-value').textContent = value; document.querySelector('#clock-readout').textContent = value; });
  document.querySelector('#terrain-slider').addEventListener('input', (e) => { terrainScale = Number(e.target.value); document.querySelector('#terrain-value').textContent = terrainScale.toFixed(2); world.configure({ scale: terrainScale }); });
  document.querySelector('#terrain-algorithm').addEventListener('change', (e) => { terrainAlgorithm = e.target.value; world.configure({ algorithm: terrainAlgorithm }); toast(`地形算法已切换为${e.target.options[e.target.selectedIndex].text}`); });
  document.querySelector('#terrain-density').addEventListener('change', (e) => { terrainSegments = Number(e.target.value); world.maxSegments = terrainSegments; world.configure({}); toast(`近景网格已调整为${terrainSegments}×${terrainSegments}，远景将自动降采样`); });
  document.querySelector('#water-slider').addEventListener('input', (e) => { waterSpeed = Number(e.target.value); world.waterMat.uniforms.uSpeed.value = waterSpeed; document.querySelector('#water-value').textContent = waterSpeed.toFixed(2); });
  document.querySelector('#particle-slider').addEventListener('input', (e) => { particleTarget = Number(e.target.value); document.querySelector('#particle-value').textContent = particleTarget; });
  document.querySelectorAll('[data-weather]').forEach((button) => button.addEventListener('click', () => { weatherType = button.dataset.weather; document.querySelectorAll('[data-weather]').forEach((b) => b.classList.toggle('active', b === button)); toast(`天气已切换为${button.textContent}`); }));
  document.querySelector('#wireframe-toggle').addEventListener('change', (e) => world.setWireframe(e.target.checked));
  document.querySelector('#collision-toggle').addEventListener('change', (e) => world.setCollisions(e.target.checked));
  document.querySelector('#path-toggle').addEventListener('change', updatePath);
  document.querySelector('#camera-mode').addEventListener('click', toggleCameraMode);
  document.querySelector('#overview-camera').addEventListener('click', setOverviewCamera);
  document.querySelector('#reset-camera').addEventListener('click', () => { overviewMode = false; roamMode = false; orbit.enabled = true; camera.position.set(38, 24, 48); orbit.target.set(0, 5, 0); orbit.update(); document.querySelector('#mode-readout').textContent = '漫游'; toast('已回到湖畔观景台'); });
  document.querySelector('#panel-toggle').addEventListener('click', () => { const panel = document.querySelector('.control-panel'); panel.classList.toggle('collapsed'); document.querySelector('#panel-toggle').textContent = panel.classList.contains('collapsed') ? '+' : '−'; });
  addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'KeyF') toggleCameraMode(); });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  renderer.domElement.addEventListener('click', () => { if (roamMode && !pointer.isLocked) pointer.lock(); });
}

bindUI();
world.maxSegments = terrainSegments;
world.plan(camera, 0);
updateEnvironment();
setTimeout(() => document.querySelector('#loading-screen').classList.add('hidden'), 900);

const fpsSamples = [];
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05); elapsed += dt;
  updateEnvironment(); updateParticles(dt); updateRoaming(dt); orbit.update();
  world.update(camera, elapsed); updatePath();
  const stats = world.stats();
  document.querySelector('#object-readout').textContent = `${stats.chunks}块 / ${stats.instances}`;
  document.querySelector('#location-readout').textContent = stats.queued ? '周围地形加载中' : overviewMode ? '高空俯视范围' : '流式漫游区域';
  const fps = 1 / Math.max(dt, .001); fpsSamples.push(fps); if (fpsSamples.length > 30) fpsSamples.shift();
  document.querySelector('#fps-readout').textContent = Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length);
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
