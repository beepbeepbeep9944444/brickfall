// Renderer, scene, camera, lighting, sky and clouds.
import * as THREE from '../vendor/three.js';
import { rand } from '../core/util.js';
import { settings } from '../core/settings.js';
import { worldMat, itemMat } from './materials.js';

export const canvas = document.getElementById('game');

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.autoClear = false;

export const scene = new THREE.Scene();
const FOG_COLOR = 0xc9d6f4;
scene.fog = new THREE.Fog(FOG_COLOR, 45, 125);

export const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 600);
camera.rotation.order = 'YXZ';

const hemi = new THREE.HemisphereLight(0xffffff, 0x5a6650, 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 0.55);
sun.position.set(30, 50, 20);
scene.add(sun);

// Gradient sky dome that follows the camera.
const sky = (() => {
  const g = new THREE.SphereGeometry(400, 24, 16), p = g.attributes.position, col = [];
  const top = new THREE.Color(0x3f63c9), hor = new THREE.Color(FOG_COLOR), bot = new THREE.Color(0xa9b5d8);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 400;
    const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.55)) : hor.clone().lerp(bot, Math.min(1, -y * 3));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -1;
  scene.add(m);
  return m;
})();

const clouds = [];
{
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(rand(8, 20), 2, rand(6, 14)), mat);
    m.position.set(rand(-80, 140), rand(40, 48), rand(-80, 140));
    scene.add(m);
    clouds.push(m);
  }
}

/** Drift clouds and keep the sky centered on the camera. */
export function updateSky(dt) {
  for (const c of clouds) { c.position.x += dt * 1.2; if (c.position.x > 150) c.position.x = -90; }
  sky.position.copy(camera.position);
}

/** Apply video settings that live in the 3D scene. */
export function applyVideoSettings() {
  scene.fog.far = settings.renderDist;
  scene.fog.near = settings.renderDist * 0.38;
  for (const c of clouds) c.visible = settings.clouds;
  const b = 0.8 + settings.brightness * 0.004;
  worldMat.color.setScalar(b);
  itemMat.color.setScalar(b);
  hemi.intensity = 0.8 * b;
  renderer.setPixelRatio(Math.min(devicePixelRatio * settings.quality, 2));
  renderer.setSize(innerWidth, innerHeight);
}

const resizeHandlers = [];
/** Register extra cameras etc. that must react to window resizes. */
export function onResize(fn) { resizeHandlers.push(fn); }
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  for (const fn of resizeHandlers) fn();
});
