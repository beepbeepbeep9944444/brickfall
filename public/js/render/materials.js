// Shared materials (kept in one place so video settings like brightness can adjust them).
import * as THREE from '../vendor/three.js';
import { atlasTex } from './textures.js';

/** Terrain: atlas texture with baked face shading + ambient occlusion in vertex colors. */
export const worldMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true });

/** Extruded pixel-art items (colors are baked per vertex). */
export const itemMat = new THREE.MeshBasicMaterial({ vertexColors: true });
